use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tracing::{info, warn};
use uuid::Uuid;

use crate::app::RelayApp;
use crate::audio::{MicrophoneInputHandle, RawAudioChunk, SystemAudioInputHandle};
use crate::constants::{
    MAX_TRANSCRIPTION_HOP_SECONDS, MAX_TRANSCRIPTION_SENTENCE_TIMEOUT_MS,
    MAX_TRANSCRIPTION_WINDOW_SECONDS, MIN_TRANSCRIPTION_HOP_SECONDS,
    MIN_TRANSCRIPTION_SENTENCE_TIMEOUT_MS, MIN_TRANSCRIPTION_WINDOW_SECONDS,
};
use crate::domain::{InputSource, RelaySettings, SegmentRecord, SegmentStatus, ServiceHealth};
use crate::transcription::WhisperEngine;
use crate::translation::{build_provider, TranslationRequest};

const TARGET_SAMPLE_RATE: u32 = 16_000;
const SILENCE_RMS_THRESHOLD: f32 = 0.008;
const MIN_SENTENCE_WORDS_ON_SILENCE: usize = 4;
const MIN_SENTENCE_WORDS_ON_TIMEOUT: usize = 6;
const AUDIO_QUEUE_CAPACITY: usize = 24;
const TRANSLATION_QUEUE_CAPACITY: usize = 64;

pub(crate) struct PipelineHandle {
    audio_tx: mpsc::Sender<RawAudioChunk>,
    audio_task: JoinHandle<()>,
    translation_task: JoinHandle<()>,
    microphone: Option<MicrophoneInputHandle>,
    system_audio: Option<SystemAudioInputHandle>,
}

impl PipelineHandle {
    /// Fire-and-forget teardown. cpal Stream Drop is blocking on macOS, so we move the
    /// whole shutdown onto the async runtime so the caller does not stall.
    pub(crate) fn stop(self) {
        tauri::async_runtime::spawn(self.shutdown());
    }

    /// Awaitable teardown. Drops cpal streams on the blocking pool, then drains
    /// the async tasks *naturally* (no abort) so any in-flight `spawn_blocking`
    /// — Whisper transcribe or llama.cpp translate — actually finishes before
    /// this returns. Required before `app.exit` to avoid racing ggml backend
    /// teardown against an in-flight ggml compute graph.
    ///
    /// Why not `JoinHandle::abort`: abort cancels the *outer* future at its
    /// next `.await`, but the blocking thread spawned by `tokio::task::spawn_blocking`
    /// is uncancellable. After abort, `audio_task.await` resolves immediately
    /// while the whisper worker keeps running on a tokio blocking thread. If
    /// `app.exit(0)` then triggers libc cleanup, the C++ static destructors
    /// free the ggml backend's global device state out from under that
    /// still-running worker → device-state-after-free crash in
    /// `whisper_full_with_state` (observed as SIGBUS on macOS Metal; equivalent
    /// crashes are possible on CUDA / Vulkan backends). Closing the channel
    /// instead lets each loop finish its current blocking step, observe the
    /// channel close, and return cleanly.
    pub(crate) async fn shutdown(self) {
        tracing::info!("pipeline teardown started");
        let PipelineHandle {
            audio_tx,
            audio_task,
            translation_task,
            microphone,
            system_audio,
        } = self;

        // cpal Stream::drop is blocking on macOS — keep it off the runtime.
        // Dropping `audio_tx` here is also what signals the audio loop to exit.
        let _ = tauri::async_runtime::spawn_blocking(move || {
            drop(microphone);
            drop(system_audio);
            drop(audio_tx);
        })
        .await;

        // Audio task drops its translation_tx clone when it returns, which
        // cascades the close into translation_task. Order matters: await
        // audio_task first so translation_tx is released, then await
        // translation_task.
        let _ = audio_task.await;
        let _ = translation_task.await;
        tracing::info!("pipeline teardown finished");
    }
}

pub(crate) async fn start_pipeline(
    app: Arc<RelayApp>,
    session_id: Uuid,
) -> anyhow::Result<PipelineHandle> {
    let snapshot = app.snapshot_result()?;
    let settings = snapshot.settings;
    let microphone_available = snapshot.microphone.available;
    let microphone_detail = snapshot
        .microphone
        .detail
        .unwrap_or_else(|| "Microphone capture is unavailable".to_string());
    let system_audio_available = snapshot.system_audio.available;
    let system_audio_detail = snapshot
        .system_audio
        .detail
        .unwrap_or_else(|| "System audio capture is unavailable".to_string());
    let engine = WhisperEngine::new(
        settings
            .selected_stt_model_path()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        settings.stt_threads,
    );
    let provider = build_provider(&settings.translation);
    let provider = Arc::from(provider);

    ensure_session_current(&app, session_id, "before model validation")?;

    if !engine.is_configured() {
        app.update_stt_health(
            ServiceHealth::Degraded,
            "Whisper model is not configured. Set a local model directory and choose a .bin model in Settings."
                .to_string(),
        )?;
        anyhow::bail!("Whisper model is not configured");
    } else if let Err(error) = engine.ensure_ready() {
        app.update_stt_health(ServiceHealth::Degraded, error.to_string())?;
        anyhow::bail!("Whisper model is not ready: {error:#}");
    } else {
        app.update_stt_health(
            ServiceHealth::Ready,
            format!("Whisper ready with model {}", engine.model_path()),
        )?;
    }

    ensure_session_current(&app, session_id, "before translation validation")?;

    let check = provider.check().await;
    let translation_ready = matches!(check.health, ServiceHealth::Ready);
    app.update_translation_health(check.health, check.detail)?;

    ensure_session_current(&app, session_id, "before capture startup")?;

    let (audio_tx, mut audio_rx) = mpsc::channel::<RawAudioChunk>(AUDIO_QUEUE_CAPACITY);
    let (translation_tx, mut translation_rx) =
        mpsc::channel::<(Uuid, String)>(TRANSLATION_QUEUE_CAPACITY);

    let processor_app = Arc::clone(&app);
    let translation_app = Arc::clone(&app);
    let translation_target = settings.translation.target_language.clone();
    let timing = TranscriptionTiming::from_settings(&settings);

    let audio_session_id = session_id;
    let audio_task = tokio::spawn(async move {
        let mut chunkers = HashMap::from([
            (InputSource::Microphone, StreamingChunker::new(timing)),
            (InputSource::SystemAudio, StreamingChunker::new(timing)),
        ]);
        let mut assemblers = HashMap::from([
            (InputSource::Microphone, TranscriptAssembler::new(timing)),
            (InputSource::SystemAudio, TranscriptAssembler::new(timing)),
        ]);

        while let Some(chunk) = audio_rx.recv().await {
            if !processor_app.is_session_current(audio_session_id) {
                break;
            }

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

                let captured_at_ms = window.captured_at_ms;
                let is_low_energy = window.rms <= SILENCE_RMS_THRESHOLD;
                let samples = window.samples;
                let engine_for_window = engine.clone();
                let transcript = match tokio::task::spawn_blocking(move || {
                    engine_for_window.transcribe(&samples)
                })
                .await
                {
                    Ok(Ok(text)) => text,
                    Ok(Err(error)) => {
                        warn!("stt failed: {error:#}");
                        let _ = processor_app
                            .update_stt_health(ServiceHealth::Degraded, error.to_string());
                        continue;
                    }
                    Err(error) => {
                        warn!("stt worker failed: {error:#}");
                        let _ = processor_app.update_stt_health(
                            ServiceHealth::Degraded,
                            format!("Whisper worker failed: {error}"),
                        );
                        continue;
                    }
                };

                if !processor_app.is_session_current(audio_session_id) {
                    break;
                }

                let cleaned = transcript.trim().to_string();
                if cleaned.is_empty() {
                    continue;
                }

                let Some(assembler) = assemblers.get_mut(&chunk.source) else {
                    continue;
                };

                let Some(finalized) = assembler.ingest(&cleaned, captured_at_ms, is_low_energy)
                else {
                    continue;
                };

                let segment = SegmentRecord {
                    id: Uuid::new_v4(),
                    source: chunk.source,
                    created_at_ms: captured_at_ms,
                    transcript: finalized.clone(),
                    translation: None,
                    status: if translation_ready {
                        SegmentStatus::Translating
                    } else {
                        SegmentStatus::Transcribed
                    },
                };
                let segment_id = segment.id;
                let _ = processor_app.push_segment(segment);
                if translation_ready && translation_tx.try_send((segment_id, finalized)).is_err() {
                    let _ = processor_app.update_segment_translation(
                        segment_id,
                        Err(anyhow::anyhow!(
                            "Translation queue is full; segment was dropped before translation"
                        )),
                    );
                }
            }
        }
    });

    let translation_session_id = session_id;
    let translation_task = tokio::spawn(async move {
        while let Some((segment_id, text)) = translation_rx.recv().await {
            if !translation_app.is_session_current(translation_session_id) {
                break;
            }

            let result = provider
                .translate(TranslationRequest {
                    text,
                    target_language: translation_target.clone(),
                })
                .await;

            if !translation_app.is_session_current(translation_session_id) {
                break;
            }

            let _ = translation_app.update_segment_translation(segment_id, result);
        }
    });

    let on_error = {
        let app = Arc::clone(&app);
        let error_session_id = session_id;
        Arc::new(move |source: InputSource, message: String| {
            if !app.is_session_current(error_session_id) {
                return;
            }
            let _ = app.push_diagnostic("warning", message);
            let _ = app.mark_source_error(
                source,
                "Audio stream error. Check the selected device and permissions.",
            );
        })
    };

    let microphone = if settings.microphone_enabled && !microphone_available {
        let _ = app.set_source_runtime(InputSource::Microphone, false, microphone_detail.clone());
        let _ = app.push_diagnostic("warning", microphone_detail);
        None
    } else if settings.microphone_enabled {
        let handle = MicrophoneInputHandle::start(audio_tx.clone(), on_error.clone())?;
        ensure_session_current(&app, session_id, "after microphone startup")?;
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

    let system_audio = if settings.system_audio_enabled && !system_audio_available {
        let _ =
            app.set_source_runtime(InputSource::SystemAudio, false, system_audio_detail.clone());
        let _ = app.push_diagnostic("warning", system_audio_detail);
        None
    } else if settings.system_audio_enabled {
        match SystemAudioInputHandle::start(audio_tx.clone(), on_error.clone()) {
            Ok(handle) => {
                ensure_session_current(&app, session_id, "after system audio startup")?;
                let _ = app.set_source_runtime(InputSource::SystemAudio, true, handle.detail());
                let _ = app.push_diagnostic("info", "Audio: system output loopback started");
                Some(handle)
            }
            Err(error) => {
                ensure_session_current(&app, session_id, "after system audio startup")?;
                let detail = format!("System audio capture failed: {error}");
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

    let handle = PipelineHandle {
        audio_tx,
        audio_task,
        translation_task,
        microphone,
        system_audio,
    };

    if !app.activate_pipeline_session(session_id)? {
        handle.stop();
        anyhow::bail!("Pipeline start was superseded before activation");
    }

    info!("pipeline started for session {session_id}");

    Ok(handle)
}

fn ensure_session_current(app: &RelayApp, session_id: Uuid, stage: &str) -> anyhow::Result<()> {
    if app.is_session_current(session_id) {
        Ok(())
    } else {
        anyhow::bail!("Pipeline start was superseded {stage}");
    }
}

fn normalize_level(rms: f32) -> f32 {
    (rms * 8.0).clamp(0.0, 1.0)
}

#[derive(Debug, Clone, Copy)]
struct TranscriptionTiming {
    window_seconds: u32,
    hop_seconds: u32,
    sentence_timeout_ms: u32,
}

impl TranscriptionTiming {
    fn from_settings(settings: &RelaySettings) -> Self {
        let window_seconds = settings.stt_window_seconds.clamp(
            MIN_TRANSCRIPTION_WINDOW_SECONDS,
            MAX_TRANSCRIPTION_WINDOW_SECONDS,
        );
        let hop_seconds = settings
            .stt_hop_seconds
            .clamp(MIN_TRANSCRIPTION_HOP_SECONDS, MAX_TRANSCRIPTION_HOP_SECONDS)
            .min(window_seconds);
        let sentence_timeout_ms = settings.stt_sentence_timeout_ms.clamp(
            MIN_TRANSCRIPTION_SENTENCE_TIMEOUT_MS,
            MAX_TRANSCRIPTION_SENTENCE_TIMEOUT_MS,
        );

        Self {
            window_seconds,
            hop_seconds,
            sentence_timeout_ms,
        }
    }
}

impl Default for TranscriptionTiming {
    fn default() -> Self {
        Self::from_settings(&RelaySettings::default())
    }
}

struct StreamingChunker {
    buffer: Vec<f32>,
    timing: TranscriptionTiming,
}

struct WindowFrame {
    samples: Vec<f32>,
    captured_at_ms: u64,
    rms: f32,
}

impl StreamingChunker {
    fn new(timing: TranscriptionTiming) -> Self {
        Self {
            buffer: Vec::new(),
            timing,
        }
    }

    fn push(
        &mut self,
        input_rate: u32,
        captured_at_ms: u64,
        samples: Vec<f32>,
    ) -> Vec<WindowFrame> {
        let window_size = TARGET_SAMPLE_RATE as usize * self.timing.window_seconds as usize;
        let hop_size = TARGET_SAMPLE_RATE as usize * self.timing.hop_seconds as usize;

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

struct TranscriptAssembler {
    pending: String,
    last_emitted: String,
    started_at_ms: Option<u64>,
    timing: TranscriptionTiming,
}

impl TranscriptAssembler {
    fn new(timing: TranscriptionTiming) -> Self {
        Self {
            pending: String::new(),
            last_emitted: String::new(),
            started_at_ms: None,
            timing,
        }
    }

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
                captured_at_ms.saturating_sub(started_at_ms)
                    >= u64::from(self.timing.sentence_timeout_ms)
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

impl Default for TranscriptAssembler {
    fn default() -> Self {
        Self::new(TranscriptionTiming::default())
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

#[cfg(test)]
impl PipelineHandle {
    /// Constructor for tests that does not require real cpal streams. The
    /// audio/system_audio handles are intentionally `None`.
    fn for_tests(
        audio_tx: mpsc::Sender<RawAudioChunk>,
        audio_task: JoinHandle<()>,
        translation_task: JoinHandle<()>,
    ) -> Self {
        Self {
            audio_tx,
            audio_task,
            translation_task,
            microphone: None,
            system_audio: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::sync::mpsc;

    use super::{
        merge_transcripts, PipelineHandle, RawAudioChunk, StreamingChunker, TranscriptAssembler,
        TranscriptionTiming, TARGET_SAMPLE_RATE,
    };
    use crate::domain::RelaySettings;

    #[test]
    fn merges_overlapping_transcript_fragments() {
        let merged = merge_transcripts(
            "video on YouTube? Go to the comments",
            "Go to the comments section and share",
        );

        assert_eq!(
            merged,
            "video on YouTube? Go to the comments section and share"
        );
    }

    #[test]
    fn assembler_waits_for_sentence_boundary() {
        let mut assembler = TranscriptAssembler::default();

        assert_eq!(assembler.ingest("Try to write", 1_000, false), None);
        assert_eq!(
            assembler.ingest("Try to write at least one comment", 2_000, true),
            Some("Try to write at least one comment".to_string())
        );
    }

    #[test]
    fn timing_settings_clamp_hop_to_window_and_sentence_timeout_bounds() {
        let settings = RelaySettings {
            stt_window_seconds: 2,
            stt_hop_seconds: 12,
            stt_sentence_timeout_ms: 1,
            ..RelaySettings::default()
        };

        let timing = TranscriptionTiming::from_settings(&settings);

        assert_eq!(timing.window_seconds, 2);
        assert_eq!(timing.hop_seconds, 2);
        assert_eq!(timing.sentence_timeout_ms, 2_000);
    }

    #[test]
    fn chunker_uses_configured_window_and_hop() {
        let timing = TranscriptionTiming {
            window_seconds: 2,
            hop_seconds: 1,
            sentence_timeout_ms: 9_000,
        };
        let mut chunker = StreamingChunker::new(timing);
        let samples = vec![0.0; TARGET_SAMPLE_RATE as usize * 3];

        let windows = chunker.push(TARGET_SAMPLE_RATE, 1_000, samples);

        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].samples.len(), TARGET_SAMPLE_RATE as usize * 2);
    }

    /// Critical scenario: shutdown must complete when both tasks are idle on
    /// their `recv().await` points (no in-flight blocking work). Tasks must
    /// observe channel close and return cleanly — without the abort path that
    /// would otherwise have masked any close-cascade bug.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn shutdown_completes_when_tasks_are_idle() {
        let (audio_tx, mut audio_rx) = mpsc::channel::<RawAudioChunk>(1);
        let (translation_tx, mut translation_rx) = mpsc::channel::<()>(1);
        let audio_task = tokio::spawn(async move {
            // Mirrors the real audio loop: holds translation_tx, exits on close.
            while audio_rx.recv().await.is_some() {}
            drop(translation_tx);
        });
        let translation_task =
            tokio::spawn(async move { while translation_rx.recv().await.is_some() {} });

        let handle = PipelineHandle::for_tests(audio_tx, audio_task, translation_task);
        tokio::time::timeout(Duration::from_secs(2), handle.shutdown())
            .await
            .expect("shutdown must complete in finite time");
    }

    /// Shutdown must not stall when one or both tasks have already finished on
    /// their own (e.g. translation task exited because the channel closed
    /// during a clean stop). `.await` on a finished JoinHandle resolves
    /// immediately — verify the order in `shutdown` does not regress this.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn shutdown_is_idempotent_for_finished_tasks() {
        let (audio_tx, _audio_rx) = mpsc::channel::<RawAudioChunk>(1);
        let audio_task = tokio::spawn(async {});
        let translation_task = tokio::spawn(async {});
        // Allow both spawns to actually complete before we shut down.
        tokio::time::sleep(Duration::from_millis(20)).await;

        let handle = PipelineHandle::for_tests(audio_tx, audio_task, translation_task);
        tokio::time::timeout(Duration::from_secs(2), handle.shutdown())
            .await
            .expect("shutdown must not stall on already-finished tasks");
    }

    /// Regression guard for the macOS SIGBUS at exit (and analogous
    /// device-state-after-free crashes on other ggml backends): shutdown
    /// MUST wait for an in-flight `spawn_blocking` (simulating whisper
    /// transcribe) to return before resolving. If shutdown returned early
    /// — as it would with `JoinHandle::abort` — `app.exit(0)` would race
    /// ggml backend teardown against the still-running worker thread.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn shutdown_waits_for_in_flight_blocking_work() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        let (audio_tx, mut audio_rx) = mpsc::channel::<RawAudioChunk>(1);
        let (translation_tx, mut translation_rx) = mpsc::channel::<()>(1);
        let blocking_done = Arc::new(AtomicBool::new(false));
        let blocking_done_inner = Arc::clone(&blocking_done);

        let audio_task = tokio::spawn(async move {
            // Drain at least once so we observe the close, but with an
            // in-flight blocking call that must complete before we exit.
            let _ = audio_rx.recv().await;
            let flag = Arc::clone(&blocking_done_inner);
            let _ = tokio::task::spawn_blocking(move || {
                std::thread::sleep(Duration::from_millis(400));
                flag.store(true, Ordering::Release);
            })
            .await;
            // After blocking work finishes, drain the (now closed) channel.
            while audio_rx.recv().await.is_some() {}
            drop(translation_tx);
        });
        let translation_task =
            tokio::spawn(async move { while translation_rx.recv().await.is_some() {} });

        // Push one chunk so the audio task enters the blocking phase before
        // shutdown closes the sender.
        audio_tx
            .send(RawAudioChunk {
                source: crate::domain::InputSource::Microphone,
                captured_at_ms: 0,
                sample_rate: 16_000,
                samples: Vec::new(),
            })
            .await
            .expect("seed audio task with one chunk");
        tokio::time::sleep(Duration::from_millis(50)).await;

        let handle = PipelineHandle::for_tests(audio_tx, audio_task, translation_task);
        tokio::time::timeout(Duration::from_secs(2), handle.shutdown())
            .await
            .expect("shutdown must complete");
        assert!(
            blocking_done.load(Ordering::Acquire),
            "shutdown returned before in-flight spawn_blocking finished — \
             this regresses the macOS exit-time SIGBUS fix"
        );
    }
}
