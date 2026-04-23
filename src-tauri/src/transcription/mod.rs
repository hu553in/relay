use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Context, Result};
use tracing::info;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Clone)]
pub struct WhisperEngine {
    model_path: String,
    context: Arc<Mutex<Option<WhisperContext>>>,
}

impl WhisperEngine {
    pub fn new(model_path: impl Into<String>) -> Self {
        Self {
            model_path: model_path.into(),
            context: Arc::new(Mutex::new(None)),
        }
    }

    pub fn is_configured(&self) -> bool {
        !self.model_path.trim().is_empty()
    }

    pub fn model_path(&self) -> &str {
        &self.model_path
    }

    pub fn ensure_ready(&self) -> Result<()> {
        self.ensure_context().map(|_| ())
    }

    pub fn transcribe(&self, pcm: &[f32]) -> Result<String> {
        if pcm.is_empty() {
            return Ok(String::new());
        }

        let mut guard = self
            .context
            .lock()
            .map_err(|_| anyhow!("whisper context lock poisoned"))?;
        if guard.is_none() {
            let path = Path::new(self.model_path.trim());
            if !path.exists() {
                return Err(anyhow!("Whisper model is missing at {}", path.display()));
            }
            info!("loading whisper model from {}", path.display());
            let params = WhisperContextParameters::default();
            let context = WhisperContext::new_with_params(path.to_string_lossy().as_ref(), params)
                .with_context(|| format!("load whisper model {}", path.display()))?;
            *guard = Some(context);
        }

        let context = guard.as_ref().expect("whisper context initialized");
        let mut state = context.create_state()?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(4);
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
        let _ = self.transcribe(&[0.0_f32; 1600])?;
        Ok(())
    }
}
