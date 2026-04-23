use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tracing::{info, warn};
use uuid::Uuid;

use crate::app::RelayApp;
use crate::audio::{
    system_audio_unavailable_detail, MicrophoneInputHandle, RawAudioChunk, SystemAudioInputHandle,
};
use crate::domain::{InputSource, ListeningState, SegmentRecord, SegmentStatus, ServiceHealth};
use crate::transcription::WhisperEngine;
use crate::translation::{build_provider, TranslationRequest};

const TARGET_SAMPLE_RATE: u32 = 16_000;
const WINDOW_SECONDS: usize = 4;
const HOP_SECONDS: usize = 2;
const SILENCE_RMS_THRESHOLD: f32 = 0.008;
const MIN_SENTENCE_WORDS_ON_SILENCE: usize = 4;
const MIN_SENTENCE_WORDS_ON_TIMEOUT: usize = 6;
const MAX_PENDING_SENTENCE_MS: u64 = 9_000;

pub struct PipelineHandle {
    audio_tx: mpsc::UnboundedSender<RawAudioChunk>,
    audio_task: JoinHandle<()>,
    translation_task: JoinHandle<()>,
    microphone: Option<MicrophoneInputHandle>,
    system_audio: Option<SystemAudioInputHandle>,
}

impl PipelineHandle {
    pub fn stop(self) {
        drop(self.microphone);
        drop(self.system_audio);
        drop(self.audio_tx);
        self.audio_task.abort();
        self.translation_task.abort();
    }
}

pub async fn start_pipeline(
    app: Arc<RelayApp>,
    session_id: Uuid,
) -> anyhow::Result<PipelineHandle> {
    let settings = app.snapshot().settings;
    let engine = WhisperEngine::new(
        settings
            .selected_stt_model_path()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
    );
    let provider = build_provider(&settings.translation);
    let provider = Arc::from(provider);

    if !engine.is_configured() {
        app.update_stt_health(
            ServiceHealth::Degraded,
            "Whisper model is not configured. Set a local model directory and choose a .bin model in Settings."
                .to_string(),
        )?;
    } else if let Err(error) = engine.ensure_ready() {
        app.update_stt_health(ServiceHealth::Degraded, error.to_string())?;
    } else {
        app.update_stt_health(
            ServiceHealth::Ready,
            format!("Whisper ready with model {}", engine.model_path()),
        )?;
    }

    let check = provider.check().await;
    app.update_translation_health(check.health, check.detail)?;

    let (audio_tx, mut audio_rx) = mpsc::unbounded_channel::<RawAudioChunk>();
    let (translation_tx, mut translation_rx) = mpsc::unbounded_channel::<(Uuid, String)>();

    let processor_app = Arc::clone(&app);
    let translation_app = Arc::clone(&app);
    let translation_target = settings.translation.target_language.clone();

    let audio_task = tokio::spawn(async move {
        let mut chunkers = HashMap::from([
            (InputSource::Microphone, StreamingChunker::new()),
            (InputSource::SystemAudio, StreamingChunker::new()),
        ]);
        let mut assemblers = HashMap::from([
            (InputSource::Microphone, TranscriptAssembler::default()),
            (InputSource::SystemAudio, TranscriptAssembler::default()),
        ]);

        while let Some(chunk) = audio_rx.recv().await {
            let _ = processor_app
                .update_source_level(chunk.source, normalize_level(rms(&chunk.samples)));
            let Some(chunker) = chunkers.get_mut(&chunk.source) else {
                continue;
            };
            let windows = chunker.push(chunk.sample_rate, chunk.captured_at_ms, chunk.samples);
            for window in windows {
                if !engine.is_configured() {
                    continue;
                }

                let transcript = match engine.transcribe(&window.samples) {
                    Ok(text) => text,
                    Err(error) => {
                        warn!("stt failed: {error:#}");
                        let _ = processor_app
                            .update_stt_health(ServiceHealth::Degraded, error.to_string());
                        continue;
                    }
                };

                let cleaned = transcript.trim().to_string();
                if cleaned.is_empty() {
                    continue;
                }

                let Some(assembler) = assemblers.get_mut(&chunk.source) else {
                    continue;
                };

                let is_low_energy = window.rms <= SILENCE_RMS_THRESHOLD;
                let Some(finalized) =
                    assembler.ingest(&cleaned, window.captured_at_ms, is_low_energy)
                else {
                    continue;
                };

                let segment = SegmentRecord {
                    id: Uuid::new_v4(),
                    source: chunk.source,
                    created_at_ms: window.captured_at_ms,
                    transcript: finalized.clone(),
                    translation: None,
                    status: SegmentStatus::Translating,
                };
                let segment_id = segment.id;
                let _ = processor_app.push_segment(segment);
                let _ = translation_tx.send((segment_id, finalized));
            }
        }
    });

    let translation_task = tokio::spawn(async move {
        while let Some((segment_id, text)) = translation_rx.recv().await {
            let result = provider
                .translate(TranslationRequest {
                    text,
                    target_language: translation_target.clone(),
                })
                .await;

            let _ = translation_app.update_segment_translation(segment_id, result);
        }
    });

    let on_error = {
        let app = Arc::clone(&app);
        Arc::new(move |source: InputSource, message: String| {
            let _ = app.push_diagnostic("warning", message);
            let _ = app.mark_source_error(
                source,
                "Audio stream error. Check the selected device and permissions.",
            );
        })
    };

    let microphone = if settings.microphone_enabled {
        let handle = MicrophoneInputHandle::start(audio_tx.clone(), on_error.clone())?;
        let _ = app.set_source_runtime(
            InputSource::Microphone,
            true,
            "Active on the default input device",
        );
        let _ = app.push_diagnostic("info", "Audio: microphone capture started");
        Some(handle)
    } else {
        let _ = app.set_source_runtime(
            InputSource::Microphone,
            false,
            "Microphone disabled in settings",
        );
        None
    };

    let system_audio = if settings.system_audio_enabled {
        match SystemAudioInputHandle::start(audio_tx.clone(), on_error.clone()) {
            Ok(handle) => {
                let _ = app.set_source_runtime(
                    InputSource::SystemAudio,
                    true,
                    "Active on the default output device loopback",
                );
                let _ = app.push_diagnostic("info", "Audio: system output loopback started");
                Some(handle)
            }
            Err(error) => {
                let detail = format!("{} ({error})", system_audio_unavailable_detail());
                let _ = app.set_source_runtime(InputSource::SystemAudio, false, detail.clone());
                let _ = app.push_diagnostic("warning", detail);
                None
            }
        }
    } else {
        let _ = app.set_source_runtime(
            InputSource::SystemAudio,
            false,
            "System audio disabled in settings",
        );
        None
    };

    let active_sources = usize::from(microphone.is_some()) + usize::from(system_audio.is_some());

    if active_sources == 0 {
        return Err(anyhow::anyhow!(
            "No active capture source could be started. Enable the microphone or make sure the system-audio loopback path is available."
        ));
    }

    app.set_listening_state(ListeningState::Listening, Some(session_id))?;
    info!("pipeline started for session {session_id}");

    Ok(PipelineHandle {
        audio_tx,
        audio_task,
        translation_task,
        microphone,
        system_audio,
    })
}

fn normalize_level(rms: f32) -> f32 {
    (rms * 8.0).clamp(0.0, 1.0)
}

struct StreamingChunker {
    buffer: Vec<f32>,
}

struct WindowFrame {
    samples: Vec<f32>,
    captured_at_ms: u64,
    rms: f32,
}

impl StreamingChunker {
    fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    fn push(
        &mut self,
        input_rate: u32,
        captured_at_ms: u64,
        samples: Vec<f32>,
    ) -> Vec<WindowFrame> {
        let window_size = TARGET_SAMPLE_RATE as usize * WINDOW_SECONDS;
        let hop_size = TARGET_SAMPLE_RATE as usize * HOP_SECONDS;

        self.buffer
            .extend(resample_linear(&samples, input_rate, TARGET_SAMPLE_RATE));
        let mut windows = Vec::new();

        while self.buffer.len() >= window_size {
            let window = self.buffer[..window_size].to_vec();
            windows.push(WindowFrame {
                rms: rms(&window),
                samples: window,
                captured_at_ms,
            });
            self.buffer.drain(..hop_size);
        }

        windows
    }
}

#[derive(Default)]
struct TranscriptAssembler {
    pending: String,
    last_emitted: String,
    started_at_ms: Option<u64>,
}

impl TranscriptAssembler {
    fn ingest(&mut self, fragment: &str, captured_at_ms: u64, low_energy: bool) -> Option<String> {
        if self.pending.is_empty() {
            self.pending = fragment.to_string();
            self.started_at_ms = Some(captured_at_ms);
        } else {
            self.pending = merge_transcripts(&self.pending, fragment);
        }

        let pending = self.pending.trim();
        if pending.is_empty() {
            return None;
        }

        let word_count = count_words(pending);
        let should_flush = has_terminal_punctuation(pending)
            || (low_energy && word_count >= MIN_SENTENCE_WORDS_ON_SILENCE)
            || (self.started_at_ms.is_some_and(|started_at_ms| {
                captured_at_ms.saturating_sub(started_at_ms) >= MAX_PENDING_SENTENCE_MS
            }) && word_count >= MIN_SENTENCE_WORDS_ON_TIMEOUT);

        if !should_flush {
            return None;
        }

        let finalized = pending.to_string();
        self.pending.clear();
        self.started_at_ms = None;

        if finalized == self.last_emitted {
            return None;
        }

        self.last_emitted = finalized.clone();
        Some(finalized)
    }
}

fn merge_transcripts(current: &str, incoming: &str) -> String {
    let current = normalize_transcript(current);
    let incoming = normalize_transcript(incoming);

    if current.is_empty() {
        return incoming;
    }
    if incoming.is_empty() {
        return current;
    }
    if current == incoming || current.ends_with(&incoming) {
        return current;
    }
    if incoming.contains(&current) {
        return incoming;
    }

    let current_words: Vec<&str> = current.split_whitespace().collect();
    let incoming_words: Vec<&str> = incoming.split_whitespace().collect();
    let max_overlap = current_words.len().min(incoming_words.len());

    for overlap in (1..=max_overlap).rev() {
        if normalize_token_slice(&current_words[current_words.len() - overlap..])
            == normalize_token_slice(&incoming_words[..overlap])
        {
            let suffix = incoming_words[overlap..].join(" ");
            if suffix.is_empty() {
                return current;
            }
            return format!("{current} {suffix}");
        }
    }

    format!("{current} {incoming}")
}

fn normalize_transcript(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn normalize_token_slice(tokens: &[&str]) -> String {
    tokens
        .iter()
        .map(|token| {
            token
                .trim_matches(|char: char| !char.is_alphanumeric())
                .to_lowercase()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn count_words(value: &str) -> usize {
    value.split_whitespace().count()
}

fn has_terminal_punctuation(value: &str) -> bool {
    value.ends_with('.') || value.ends_with('!') || value.ends_with('?') || value.ends_with('…')
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    let power = samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32;
    power.sqrt()
}

fn resample_linear(samples: &[f32], input_rate: u32, output_rate: u32) -> Vec<f32> {
    if input_rate == output_rate || samples.len() < 2 {
        return samples.to_vec();
    }

    let ratio = output_rate as f64 / input_rate as f64;
    let output_len = (samples.len() as f64 * ratio).round() as usize;
    let mut out = Vec::with_capacity(output_len);

    for index in 0..output_len {
        let source_position = index as f64 / ratio;
        let lower = source_position.floor() as usize;
        let upper = (lower + 1).min(samples.len() - 1);
        let factor = (source_position - lower as f64) as f32;
        let value = samples[lower] + (samples[upper] - samples[lower]) * factor;
        out.push(value);
    }

    out
}
