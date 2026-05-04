use std::num::NonZeroU32;
use std::path::Path;
use std::sync::{Mutex, OnceLock, TryLockError};

use anyhow::{anyhow, Context, Result};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::openai::OpenAIChatTemplateParams;
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;
use serde_json::json;

use crate::constants::{
    MAX_GENERATION_TOKENS, MAX_TRANSLATION_CONTEXT_TOKENS, MAX_WORKER_THREADS,
    MIN_GENERATION_TOKENS, MIN_TRANSLATION_CONTEXT_TOKENS, MIN_WORKER_THREADS,
    TRANSLATION_MODEL_EXTENSIONS,
};
use crate::domain::{ServiceHealth, TranslationSettings, UserMessage};
use crate::ggml;
use crate::models::validate_model_file_extension;

#[derive(Debug, Clone)]
pub(crate) struct TranslationHealthReport {
    pub(crate) health: ServiceHealth,
    pub(crate) detail: UserMessage,
}

#[derive(Debug, Clone)]
pub(crate) struct TranslationRequest {
    pub(crate) text: String,
    pub(crate) target_language: String,
}

#[derive(Debug, Clone)]
pub(crate) struct TranslationProvider {
    settings: TranslationSettings,
}

impl TranslationProvider {
    fn new(settings: TranslationSettings) -> Self {
        Self { settings }
    }

    pub(crate) async fn translate(&self, request: TranslationRequest) -> Result<String> {
        let settings = self.settings.clone();
        tokio::task::spawn_blocking(move || translate_blocking(settings, request))
            .await
            .context("join llama.cpp translation worker")?
    }

    pub(crate) async fn check(&self) -> TranslationHealthReport {
        let settings = self.settings.clone();
        match tokio::task::spawn_blocking(move || check_settings_blocking(&settings)).await {
            Ok(report) => report,
            Err(error) => TranslationHealthReport {
                health: ServiceHealth::Unavailable,
                detail: UserMessage::new("runtime:llamaHealthWorkerFailed")
                    .param("error", format!("{error:#}")),
            },
        }
    }

    pub(crate) fn check_blocking(&self) -> TranslationHealthReport {
        check_settings_blocking(&self.settings)
    }
}

pub(crate) fn build_provider(settings: &TranslationSettings) -> TranslationProvider {
    TranslationProvider::new(settings.clone())
}

fn translate_blocking(
    settings: TranslationSettings,
    request: TranslationRequest,
) -> Result<String> {
    // Empty input means upstream produced no transcript to translate; do not
    // pay the cost of locking the runtime, decoding a prompt, or waking the
    // model. Returning an empty string keeps the contract of "translation of
    // nothing is nothing" without surfacing a misleading error. This check
    // happens before the ggml guard because empty input does not touch the
    // ggml backend at all.
    if request.text.trim().is_empty() {
        return Ok(String::new());
    }

    // Hold the ggml guard for the entire scope: model load (inside
    // ensure_loaded) and decode both touch the ggml backend device.
    let Some(_guard) = ggml::try_enter() else {
        return Err(anyhow!(
            "Translation is shutting down; skipping in-flight translate"
        ));
    };

    let runtime_lock = runtime_state()
        .lock()
        .map_err(|_| anyhow!("llama.cpp runtime lock poisoned"))?;
    let mut runtime = runtime_lock;
    let runtime = runtime.ensure_loaded(&settings)?;
    let prompt = build_translation_prompt(runtime.model, &request)?;
    generate_translation(runtime, &settings, &prompt)
}

fn check_settings_blocking(settings: &TranslationSettings) -> TranslationHealthReport {
    if settings.model_path.trim().is_empty() {
        return TranslationHealthReport {
            health: ServiceHealth::Unavailable,
            detail: UserMessage::new("runtime:modelDirectoryEmpty").param("label", "Translation"),
        };
    }

    let path = Path::new(settings.model_path.trim());
    if !path.exists() {
        return TranslationHealthReport {
            health: ServiceHealth::Unavailable,
            detail: UserMessage::new("runtime:modelDirectoryMissing")
                .param("label", "Translation")
                .param("path", path.display()),
        };
    }
    if !path.is_dir() {
        return TranslationHealthReport {
            health: ServiceHealth::Unavailable,
            detail: UserMessage::new("runtime:modelDirectoryMustBeFolder")
                .param("label", "Translation"),
        };
    }
    if settings.selected_model_path().is_none() {
        return TranslationHealthReport {
            health: ServiceHealth::Unavailable,
            detail: UserMessage::new("runtime:chooseTranslationModel"),
        };
    }

    // Refuse to touch the ggml backend if a graceful shutdown is in
    // progress. Without this, a settings refresh racing Cmd+Q would call
    // `ensure_loaded` (which initializes LlamaBackend → ggml backend) on a
    // tokio worker thread that the drainer cannot see.
    let Some(_ggml_guard) = ggml::try_enter() else {
        return TranslationHealthReport {
            health: ServiceHealth::Unavailable,
            detail: UserMessage::new("runtime:translationRuntimeShuttingDown"),
        };
    };

    let runtime_lock = match runtime_state().try_lock() {
        Ok(lock) => lock,
        Err(TryLockError::WouldBlock) => {
            return TranslationHealthReport {
                health: ServiceHealth::Degraded,
                detail: UserMessage::new("runtime:translationRuntimeBusy"),
            };
        }
        Err(TryLockError::Poisoned(_)) => {
            return TranslationHealthReport {
                health: ServiceHealth::Unavailable,
                detail: UserMessage::new("runtime:llamaRuntimeLockPoisoned"),
            };
        }
    };

    let mut runtime = runtime_lock;
    match runtime.ensure_loaded(settings) {
        Ok(runtime) => TranslationHealthReport {
            health: ServiceHealth::Ready,
            detail: UserMessage::new("runtime:modelPath").param("path", runtime.model_path),
        },
        Err(error) => TranslationHealthReport {
            health: ServiceHealth::Degraded,
            detail: UserMessage::new("runtime:translationModelLoadFailed")
                .param("error", format!("{error:#}")),
        },
    }
}

#[derive(Debug)]
struct LlamaRuntimeState {
    backend: Option<LlamaBackend>,
    model_path: Option<String>,
    model: Option<LlamaModel>,
}

impl LlamaRuntimeState {
    fn ensure_loaded(&mut self, settings: &TranslationSettings) -> Result<LlamaRuntimeRef<'_>> {
        let Some(path) = settings.selected_model_path() else {
            return Err(anyhow!(
                "translation model is not selected; choose one from the configured directory"
            ));
        };

        if !path.exists() {
            return Err(anyhow!(
                "translation model is missing at {}",
                path.display()
            ));
        }
        validate_model_file_extension(&path, "Translation", TRANSLATION_MODEL_EXTENSIONS)
            .map_err(|error| anyhow!(error))?;

        let path_string = path.to_string_lossy().to_string();

        if self.backend.is_none() {
            self.backend = Some(LlamaBackend::init().context("initialize llama.cpp backend")?);
        }

        let needs_reload =
            self.model_path.as_deref() != Some(path_string.as_str()) || self.model.is_none();
        if needs_reload {
            let params = LlamaModelParams::default().with_n_gpu_layers(u32::MAX);
            let backend = self
                .backend
                .as_ref()
                .ok_or_else(|| anyhow!("llama.cpp backend was not initialized"))?;
            let model = LlamaModel::load_from_file(backend, path.as_path(), &params)
                .with_context(|| format!("load local translation model {}", path.display()))?;
            self.model = Some(model);
            self.model_path = Some(path_string);
        }

        Ok(LlamaRuntimeRef {
            backend: self
                .backend
                .as_ref()
                .ok_or_else(|| anyhow!("llama.cpp backend was not initialized"))?,
            model: self
                .model
                .as_ref()
                .ok_or_else(|| anyhow!("llama.cpp model was not loaded"))?,
            model_path: self
                .model_path
                .as_deref()
                .ok_or_else(|| anyhow!("llama.cpp model path was not recorded"))?,
        })
    }
}

struct LlamaRuntimeRef<'a> {
    backend: &'a LlamaBackend,
    model: &'a LlamaModel,
    model_path: &'a str,
}

fn runtime_state() -> &'static Mutex<LlamaRuntimeState> {
    static RUNTIME: OnceLock<Mutex<LlamaRuntimeState>> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        Mutex::new(LlamaRuntimeState {
            backend: None,
            model_path: None,
            model: None,
        })
    })
}

fn build_translation_prompt(model: &LlamaModel, request: &TranslationRequest) -> Result<String> {
    let template = model
        .chat_template(None)
        .context("translation model does not expose a chat template")?;
    let messages_json = json!([
        {
            "role": "system",
            "content": format!(
                "You are a precise translation engine. Translate the user's spoken transcript into {}. Return only the translated text with no commentary, labels, or quotes.",
                request.target_language
            )
        },
        {
            "role": "user",
            "content": request.text.trim()
        }
    ])
    .to_string();
    let params = OpenAIChatTemplateParams {
        messages_json: &messages_json,
        tools_json: None,
        tool_choice: None,
        json_schema: None,
        grammar: None,
        reasoning_format: None,
        chat_template_kwargs: Some("{}"),
        add_generation_prompt: true,
        use_jinja: true,
        parallel_tool_calls: false,
        enable_thinking: false,
        add_bos: false,
        add_eos: false,
        parse_tool_calls: false,
    };

    let rendered = model
        .apply_chat_template_oaicompat(&template, &params)
        .context("render translation chat template")?;
    Ok(rendered.prompt)
}

fn generate_translation(
    runtime: LlamaRuntimeRef<'_>,
    settings: &TranslationSettings,
    prompt: &str,
) -> Result<String> {
    let config = translation_runtime_config(settings);
    let context_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(config.context_tokens))
        .with_n_batch(config.context_tokens)
        .with_n_ubatch(512)
        .with_n_threads(config.threads as i32)
        .with_n_threads_batch(config.threads as i32);
    let mut context = runtime.model.new_context(runtime.backend, context_params)?;
    let prompt_tokens = runtime.model.str_to_token(prompt, AddBos::Always)?;
    let mut batch = LlamaBatch::new(
        prompt_tokens
            .len()
            .saturating_add(config.max_tokens as usize),
        1,
    );
    batch.add_sequence(&prompt_tokens, 0, false)?;
    context.decode(&mut batch)?;

    let mut sampler = LlamaSampler::chain_simple([LlamaSampler::greedy()]);
    let mut generated = String::new();
    for (next_position, _) in ((prompt_tokens.len() as i32)..).zip(0..config.max_tokens) {
        // llama.cpp only exposes logits for the last prompt token on the initial decode when
        // `logits_all` is false. Sampling from index 0 can therefore hit a native assert on
        // non-trivial prompts; `-1` means "use the last available output", which is the
        // autoregressive path we want here.
        let token = sampler.sample(&context, -1);
        sampler.accept(token);

        if runtime.model.is_eog_token(token) {
            break;
        }

        let piece = decode_token_piece(runtime.model, token)?;
        generated.push_str(&piece);

        batch.clear();
        batch.add(token, next_position, &[0], true)?;
        context.decode(&mut batch)?;
    }

    let cleaned = generated.trim().trim_matches('"').to_string();
    if cleaned.is_empty() {
        return Err(anyhow!(
            "local llama.cpp model returned an empty translation"
        ));
    }

    Ok(cleaned)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TranslationRuntimeConfig {
    max_tokens: u32,
    context_tokens: u32,
    threads: u32,
}

fn translation_runtime_config(settings: &TranslationSettings) -> TranslationRuntimeConfig {
    TranslationRuntimeConfig {
        // Clamp on both ends using the central constants. MIN_GENERATION_TOKENS
        // (1) rejects 0-token requests that would always produce the empty-
        // translation error below; MAX_GENERATION_TOKENS bounds memory/latency
        // regardless of what's in settings.toml.
        max_tokens: settings
            .max_tokens
            .clamp(MIN_GENERATION_TOKENS, MAX_GENERATION_TOKENS),
        context_tokens: settings.context_tokens.clamp(
            MIN_TRANSLATION_CONTEXT_TOKENS,
            MAX_TRANSLATION_CONTEXT_TOKENS,
        ),
        threads: settings
            .threads
            .clamp(MIN_WORKER_THREADS, MAX_WORKER_THREADS),
    }
}

fn decode_token_piece(model: &LlamaModel, token: LlamaToken) -> Result<String> {
    let bytes = match model.token_to_piece_bytes(token, 8, true, None) {
        Ok(bytes) => bytes,
        Err(llama_cpp_2::TokenToStringError::InsufficientBufferSpace(size)) => {
            let buffer_size = size
                .checked_abs()
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(8)
                .max(8);
            model
                .token_to_piece_bytes(token, buffer_size, true, None)
                .context("decode translation token with resized buffer")?
        }
        Err(error) => return Err(anyhow!(error)).context("decode translation token"),
    };

    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use uuid::Uuid;

    use super::{
        check_settings_blocking, runtime_state, translate_blocking, translation_runtime_config,
        TranslationRequest,
    };
    use crate::constants::{
        DEFAULT_TARGET_LANGUAGE, MAX_TRANSLATION_CONTEXT_TOKENS, MIN_GENERATION_TOKENS,
        MIN_WORKER_THREADS,
    };
    use crate::domain::{ServiceHealth, TranslationSettings};

    /// Acquire the cross-module ggml test lock and reset the shutdown flag
    /// so this test does not race ggml-module tests that flip the flag.
    fn acquire_ggml_lock() -> std::sync::MutexGuard<'static, ()> {
        let guard = crate::ggml::test_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        crate::ggml::reset_for_tests();
        guard
    }

    #[test]
    fn health_check_degrades_when_runtime_is_busy() {
        let _ggml_guard = acquire_ggml_lock();
        let root = std::env::temp_dir().join(format!("relay-translation-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp translation dir");
        let _runtime_guard = runtime_state().lock().expect("lock translation runtime");
        let settings = TranslationSettings {
            model_path: root.to_string_lossy().to_string(),
            selected_model: "missing.gguf".to_string(),
            ..TranslationSettings::default()
        };

        let report = check_settings_blocking(&settings);

        assert_eq!(report.health, ServiceHealth::Degraded);
        assert_eq!(report.detail.code, "runtime:translationRuntimeBusy");

        fs::remove_dir_all(root).ok();
    }

    /// Empty / whitespace-only input must short-circuit before touching the
    /// llama.cpp runtime. Otherwise an empty transcript would acquire the
    /// runtime lock, attempt to load the (likely missing) model, and surface
    /// a misleading "model not selected" error to the user.
    #[test]
    fn empty_input_short_circuits_without_loading_runtime() {
        let _ggml_guard = acquire_ggml_lock();
        let request = TranslationRequest {
            text: "   \n\t".to_string(),
            target_language: DEFAULT_TARGET_LANGUAGE.to_string(),
        };
        // Settings with an unselected model would normally error out; this
        // test passes only because we never reach the runtime path.
        let settings = TranslationSettings::default();

        let result = translate_blocking(settings, request).expect("empty input is Ok");
        assert!(result.is_empty());
    }

    #[test]
    fn runtime_config_clamps_manual_settings_file_values() {
        let settings = TranslationSettings {
            max_tokens: 0,
            context_tokens: u32::MAX,
            threads: 0,
            ..TranslationSettings::default()
        };

        let config = translation_runtime_config(&settings);

        assert_eq!(config.max_tokens, MIN_GENERATION_TOKENS);
        assert_eq!(config.context_tokens, MAX_TRANSLATION_CONTEXT_TOKENS);
        assert_eq!(config.threads, MIN_WORKER_THREADS);
    }

    #[test]
    fn health_check_without_selected_model_stays_unavailable_without_runtime_lock() {
        let _ggml_guard = acquire_ggml_lock();
        let root = std::env::temp_dir().join(format!("relay-translation-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp translation dir");
        let _runtime_guard = runtime_state().lock().expect("lock translation runtime");
        let settings = TranslationSettings {
            model_path: root.to_string_lossy().to_string(),
            selected_model: String::new(),
            ..TranslationSettings::default()
        };

        let report = check_settings_blocking(&settings);

        assert_eq!(report.health, ServiceHealth::Unavailable);
        assert_eq!(report.detail.code, "runtime:chooseTranslationModel");

        fs::remove_dir_all(root).ok();
    }

    /// Once the ggml shutdown latch is set, both translate and check must
    /// refuse to touch the runtime. This is the contract that
    /// `spawn_graceful_shutdown` relies on to prevent races between
    /// in-flight settings refreshes / translations and `app.exit(0)`.
    #[test]
    fn translate_and_check_refuse_after_ggml_shutdown() {
        let _ggml_guard = acquire_ggml_lock();
        crate::ggml::begin_shutdown();
        let root = std::env::temp_dir().join(format!("relay-translation-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp translation dir");
        let settings = TranslationSettings {
            model_path: root.to_string_lossy().to_string(),
            selected_model: "missing.gguf".to_string(),
            ..TranslationSettings::default()
        };

        let report = check_settings_blocking(&settings);
        assert_eq!(report.health, ServiceHealth::Unavailable);
        assert_eq!(report.detail.code, "runtime:translationRuntimeShuttingDown");

        let result = translate_blocking(
            settings,
            TranslationRequest {
                text: "hello".to_string(),
                target_language: DEFAULT_TARGET_LANGUAGE.to_string(),
            },
        );
        let error = result.expect_err("translate must fail during shutdown");
        assert!(error.to_string().to_lowercase().contains("shutting down"));

        fs::remove_dir_all(root).ok();
    }
}
