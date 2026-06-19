use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Context, Result};
use tracing::info;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::constants::{MAX_WORKER_THREADS, MIN_WORKER_THREADS, WHISPER_MODEL_EXTENSIONS};
use crate::ggml;
use crate::models::validate_model_file_extension;

#[derive(Clone)]
pub(crate) struct WhisperEngine {
    model_path: String,
    threads: u32,
    context: Arc<Mutex<Option<WhisperContext>>>,
}

impl WhisperEngine {
    pub(crate) fn new(model_path: impl Into<String>, threads: u32) -> Self {
        Self {
            model_path: model_path.into(),
            threads: threads.clamp(MIN_WORKER_THREADS, MAX_WORKER_THREADS),
            context: Arc::new(Mutex::new(None)),
        }
    }

    pub(crate) fn is_configured(&self) -> bool {
        !self.model_path.trim().is_empty()
    }

    pub(crate) fn model_path(&self) -> &str {
        &self.model_path
    }

    pub(crate) fn ensure_ready(&self) -> Result<()> {
        // Loading a Whisper context allocates ggml backend state — gate it
        // through the ggml guard so a quit racing this load makes the drain
        // wait.
        let Some(_guard) = ggml::try_enter() else {
            return Err(anyhow!("Whisper is shutting down; skipping model load"));
        };
        self.ensure_context().map(|_| ())
    }

    pub(crate) fn transcribe(&self, pcm: &[f32]) -> Result<String> {
        if pcm.is_empty() {
            return Ok(String::new());
        }

        // Hold the ggml guard for the entire scope: model load (in
        // ensure_context_locked) AND `state.full` decode both touch the
        // ggml backend device. Drop happens on return — natural OR error path.
        let Some(_guard) = ggml::try_enter() else {
            return Err(anyhow!(
                "Whisper is shutting down; skipping in-flight transcribe"
            ));
        };

        let mut guard = self
            .context
            .lock()
            .map_err(|_| anyhow!("whisper context lock poisoned"))?;
        self.ensure_context_locked(&mut guard)?;

        let context = guard
            .as_ref()
            .ok_or_else(|| anyhow!("whisper context was not initialized"))?;
        let mut state = context.create_state()?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(self.threads as i32);
        params.set_translate(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_no_context(true);
        params.set_language(Some("auto"));

        state.full(params, pcm)?;

        let count = state.full_n_segments();
        let mut transcript = String::new();
        for index in 0..count {
            if let Some(segment) = state.get_segment(index) {
                transcript.push_str(&segment.to_string());
            }
        }

        Ok(transcript.trim().to_string())
    }

    fn ensure_context(&self) -> Result<()> {
        let mut guard = self
            .context
            .lock()
            .map_err(|_| anyhow!("whisper context lock poisoned"))?;
        self.ensure_context_locked(&mut guard)
    }

    fn ensure_context_locked(&self, context: &mut Option<WhisperContext>) -> Result<()> {
        if context.is_some() {
            return Ok(());
        }

        let path = Path::new(self.model_path.trim());
        if !path.exists() {
            return Err(anyhow!("Whisper model is missing at {}", path.display()));
        }
        validate_model_file_extension(path, "Whisper", WHISPER_MODEL_EXTENSIONS)
            .map_err(|error| anyhow!(error))?;

        info!("loading whisper model from {}", path.display());
        let params = WhisperContextParameters::default();
        let loaded = WhisperContext::new_with_params(path.to_string_lossy().as_ref(), params)
            .with_context(|| format!("load whisper model {}", path.display()))?;
        *context = Some(loaded);
        Ok(())
    }
}
