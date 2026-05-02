use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use sysinfo::{get_current_pid, Components, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

use crate::constants::{EVENT_SETTINGS_NAVIGATE, EVENT_SNAPSHOT};
use crate::domain::{
    AppPaths, AppSnapshot, DiagnosticsEntry, ListeningState, ModelKind, RelaySettings,
    SegmentRecord, SegmentStatus, ServiceHealth, SourceCapability, SourceState, SystemMetrics,
    TemperatureReading,
};
use crate::models::{collect_models, download_recommended_model_file, validate_model_directory};
use crate::pipeline::{start_pipeline, PipelineHandle};
use crate::settings::SettingsStore;
use crate::shortcuts::normalize_shortcuts;
use crate::transcription::WhisperEngine;
use crate::translation::build_provider;

const MAX_SEGMENTS: usize = 120;
const MAX_DIAGNOSTICS: usize = 60;

pub(crate) fn init_logging() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_env_filter(EnvFilter::from_default_env())
        .compact()
        .try_init();
}

#[derive(Clone)]
pub(crate) struct RelayApp {
    inner: Arc<RelayAppInner>,
}

struct RelayAppInner {
    app_handle: AppHandle,
    settings: SettingsStore,
    state: Mutex<RuntimeState>,
    metrics: Mutex<SystemProbe>,
}

struct RuntimeState {
    snapshot: AppSnapshot,
    pipeline: Option<PipelineHandle>,
    last_level_emit_at: Option<Instant>,
}

struct SystemProbe {
    system: System,
    components: Components,
    pid: Option<sysinfo::Pid>,
    initialized: bool,
}

impl RelayApp {
    pub(crate) fn bootstrap(app_handle: AppHandle) -> Result<Self> {
        let settings_store = SettingsStore::new();
        settings_store.ensure_app_dirs()?;
        let loaded_settings = settings_store.load();
        let mut settings = loaded_settings.settings;
        settings.normalize_model_locations();
        settings_store.apply_default_model_dirs(&mut settings);
        let shortcut_warnings = normalize_shortcuts(&mut settings.shortcuts);
        let mut snapshot = AppSnapshot {
            settings,
            shortcut_warnings,
            ..AppSnapshot::default()
        };
        snapshot.microphone.enabled = snapshot.settings.microphone_enabled;
        snapshot.system_audio.enabled = snapshot.settings.system_audio_enabled;
        apply_input_capabilities(&mut snapshot);
        snapshot.models = collect_models(&snapshot.settings);

        let app = Self {
            inner: Arc::new(RelayAppInner {
                app_handle,
                settings: settings_store,
                state: Mutex::new(RuntimeState {
                    snapshot,
                    pipeline: None,
                    last_level_emit_at: None,
                }),
                metrics: Mutex::new(SystemProbe::new()),
            }),
        };

        if !app.inner.settings.path().exists() {
            app.persist_settings()?;
        }

        if let Some(warning) = loaded_settings.warning {
            app.push_diagnostic("warning", warning)?;
        }

        app.refresh_runtime_healths()?;

        Ok(app)
    }

    pub(crate) fn snapshot_result(&self) -> Result<AppSnapshot> {
        self.inner
            .state
            .lock()
            .map(|guard| guard.snapshot.clone())
            .map_err(|_| anyhow!("relay state lock poisoned"))
    }

    pub(crate) fn emit_snapshot(&self) -> Result<()> {
        let snapshot = self.snapshot_result()?;
        crate::tray::sync(&self.inner.app_handle, &snapshot);
        self.inner.app_handle.emit(EVENT_SNAPSHOT, snapshot)?;
        Ok(())
    }

    pub(crate) fn update_settings(&self, settings: RelaySettings) -> Result<AppSnapshot> {
        // During graceful shutdown the snapshot is about to be discarded
        // anyway and `refresh_runtime_healths` would touch the ggml backend
        // through `check_blocking`. Reject without writing to disk —
        // settings are persisted on every prior change, so the user does
        // not lose anything by ignoring this last in-flight request.
        if crate::ggml::is_shutting_down() {
            return self.snapshot_result();
        }

        let previous_settings = self.snapshot_result()?.settings;
        let mut settings = settings;
        settings.normalize_model_locations();
        self.inner.settings.apply_default_model_dirs(&mut settings);
        clear_selected_models_after_directory_change(&previous_settings, &mut settings);
        let shortcut_warnings = normalize_shortcuts(&mut settings.shortcuts);
        let shortcuts_changed = previous_settings.shortcuts != settings.shortcuts;

        let should_restart = {
            let mut guard = self.lock_state()?;
            guard.snapshot.settings = settings.clone();
            guard.snapshot.shortcut_warnings = shortcut_warnings;
            guard.snapshot.microphone.enabled = settings.microphone_enabled;
            guard.snapshot.system_audio.enabled = settings.system_audio_enabled;
            apply_input_capabilities(&mut guard.snapshot);
            guard.snapshot.models = collect_models(&settings);
            guard.pipeline.is_some() || guard.snapshot.can_stop_listening()
        };

        self.persist_settings()?;
        if shortcuts_changed {
            if let Err(error) =
                crate::shortcuts::refresh_global_shortcuts(&self.inner.app_handle, self)
            {
                self.push_diagnostic(
                    "warning",
                    format!("Global shortcuts saved but could not be registered: {error:#}"),
                )?;
            }
        }
        self.refresh_runtime_healths()?;
        self.sync_overlay_window()?;
        self.emit_snapshot()?;

        if should_restart {
            let snapshot = self.snapshot_result()?;
            if !snapshot.has_available_input() || !snapshot.stt_is_ready() {
                self.push_diagnostic(
                    "warning",
                    "Settings changed. Listening stopped because the new input or transcription configuration is not ready.",
                )?;
                self.stop_listening()?;
                return self.snapshot_result();
            }

            self.restart_listening(
                "Settings changed. Restarting audio pipeline with the new configuration.",
            )?;
        }

        self.snapshot_result()
    }

    pub(crate) fn start_listening(&self) -> Result<()> {
        // Shutdown is one-way: refuse to spawn fresh ggml backend work that
        // the global drainer would have to chase. Returning Ok keeps the
        // Tauri command surface uniform — the user-visible behavior is
        // simply "nothing happens" while the app is dying.
        if crate::ggml::is_shutting_down() {
            return Ok(());
        }

        enum StartBlocker {
            NoInput,
            SttUnavailable,
            AlreadyActive,
        }

        let session_id = Uuid::new_v4();
        let blocker = {
            let mut guard = self.lock_state()?;
            apply_input_capabilities(&mut guard.snapshot);
            if !guard.snapshot.has_available_input() {
                Some(StartBlocker::NoInput)
            } else if !guard.snapshot.stt_is_ready() {
                Some(StartBlocker::SttUnavailable)
            } else if guard.pipeline.is_some()
                || matches!(
                    guard.snapshot.listening_state,
                    ListeningState::Starting | ListeningState::Listening
                )
            {
                Some(StartBlocker::AlreadyActive)
            } else {
                guard.snapshot.listening_state = ListeningState::Starting;
                guard.snapshot.active_session_id = Some(session_id);
                guard.snapshot.session_started_at_ms = Some(crate::now_ms());
                guard.snapshot.session_segment_count = 0;
                guard.snapshot.session_translation_count = 0;
                guard.snapshot.session_translation_failure_count = 0;
                guard.snapshot.microphone.capturing = false;
                guard.snapshot.system_audio.capturing = false;
                None
            }
        };

        match blocker {
            Some(StartBlocker::NoInput) => {
                self.push_diagnostic(
                    "warning",
                    "Enable an available microphone or system audio source before starting listening.",
                )?;
                return Ok(());
            }
            Some(StartBlocker::SttUnavailable) => {
                self.push_diagnostic(
                    "warning",
                    "Choose a valid Whisper model before starting listening.",
                )?;
                return Ok(());
            }
            Some(StartBlocker::AlreadyActive) => return Ok(()),
            None => {}
        }

        self.emit_snapshot()?;
        self.spawn_start_pipeline(session_id);
        Ok(())
    }

    pub(crate) fn stop_listening(&self) -> Result<()> {
        tracing::info!("listening stop requested");
        let pipeline = {
            let mut guard = self.lock_state()?;
            let should_stop = guard.pipeline.is_some()
                || matches!(
                    guard.snapshot.listening_state,
                    ListeningState::Starting | ListeningState::Listening
                );
            if !should_stop {
                return Ok(());
            }

            guard.snapshot.listening_state = ListeningState::Idle;
            guard.snapshot.active_session_id = None;
            guard.snapshot.microphone.capturing = false;
            guard.snapshot.system_audio.capturing = false;
            guard.snapshot.microphone.input_level = Some(0);
            guard.snapshot.system_audio.input_level = Some(0);
            guard.last_level_emit_at = None;
            guard.pipeline.take()
        };
        // Hand the pipeline off to the async runtime BEFORE any `?` returns so a
        // failure in `emit_snapshot` / `push_diagnostic` cannot accidentally drop
        // the handle on the caller thread (which would run cpal Stream::drop
        // synchronously and re-introduce the original UI hang).
        if let Some(handle) = pipeline {
            handle.stop();
        }
        self.emit_snapshot()?;
        self.push_diagnostic("info", "Listening stopped")?;

        Ok(())
    }

    /// Synchronous shutdown for the quit path: returns only after pipeline teardown
    /// (including in-flight Whisper transcribe spawn_blocking) actually finishes.
    /// This is what prevents `app.exit(0)` from running ggml backend static destructors
    /// while backend init dispatch blocks are still in flight.
    pub(crate) async fn shutdown(&self) -> Result<()> {
        tracing::info!("shutdown requested");
        let pipeline = {
            let mut guard = self.lock_state()?;
            guard.snapshot.listening_state = ListeningState::Idle;
            guard.snapshot.active_session_id = None;
            guard.snapshot.microphone.capturing = false;
            guard.snapshot.system_audio.capturing = false;
            guard.snapshot.microphone.input_level = Some(0);
            guard.snapshot.system_audio.input_level = Some(0);
            guard.last_level_emit_at = None;
            guard.pipeline.take()
        };
        // Best-effort UI update so a slow shutdown does not leave the controls
        // window stuck on the previous "Listening" state. Failure is non-fatal
        // because we are about to exit anyway.
        let _ = self.emit_snapshot();
        if let Some(handle) = pipeline {
            handle.shutdown().await;
        }
        Ok(())
    }

    pub(crate) fn show_overlay(&self) -> Result<()> {
        let always_on_top = self.snapshot_result()?.settings.overlay.always_on_top;
        if let Some(window) = self.overlay_window() {
            window.show()?;
            window.set_always_on_top(always_on_top)?;
            let _ = crate::platform::apply_overlay_platform_behavior(&window);
            window.set_focus()?;
        }

        {
            let mut guard = self.lock_state()?;
            guard.snapshot.settings.overlay.visible = true;
        }
        self.persist_settings()?;
        self.sync_dock_visibility();
        self.emit_snapshot()
    }

    pub(crate) fn hide_overlay(&self) -> Result<()> {
        if let Some(window) = self.overlay_window() {
            window.set_always_on_top(false)?;
            window.hide()?;
        }

        {
            let mut guard = self.lock_state()?;
            guard.snapshot.settings.overlay.visible = false;
        }
        self.persist_settings()?;
        self.sync_dock_visibility();
        self.emit_snapshot()
    }

    pub(crate) fn show_controls(&self) -> Result<()> {
        let window = self.window(crate::windowing::MAIN.label, "main")?;
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
        self.sync_dock_visibility();
        Ok(())
    }

    pub(crate) fn toggle_controls_visibility(&self) -> Result<()> {
        let window = self.window(crate::windowing::MAIN.label, "main")?;
        let visible = window.is_visible()?;
        let focused = window.is_focused().unwrap_or(false);
        if should_hide_controls_on_tray_click(visible, focused) {
            window.hide()?;
        } else {
            window.show()?;
            window.unminimize()?;
            window.set_focus()?;
        }
        self.sync_dock_visibility();
        Ok(())
    }

    pub(crate) fn show_settings(&self) -> Result<()> {
        let window = self.window(crate::windowing::SETTINGS.label, "settings")?;
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
        self.sync_dock_visibility();
        Ok(())
    }

    pub(crate) fn hide_settings(&self) -> Result<()> {
        let window = self.window(crate::windowing::SETTINGS.label, "settings")?;
        window.hide()?;
        self.sync_dock_visibility();
        Ok(())
    }

    pub(crate) fn sync_dock_visibility(&self) {
        crate::platform::sync_dock_visibility(&self.inner.app_handle);
    }

    pub(crate) fn show_settings_section(&self, section: &str) -> Result<()> {
        self.show_settings()?;
        self.inner
            .app_handle
            .emit(EVENT_SETTINGS_NAVIGATE, section.to_string())?;
        Ok(())
    }

    pub(crate) fn clear_transcript_log(&self) -> Result<()> {
        {
            let mut guard = self.lock_state()?;
            guard.snapshot.transcript_cleared_at_ms = Some(crate::now_ms());
        }
        self.emit_snapshot()
    }

    pub(crate) fn clear_translation_log(&self) -> Result<()> {
        {
            let mut guard = self.lock_state()?;
            guard.snapshot.translation_cleared_at_ms = Some(crate::now_ms());
        }
        self.emit_snapshot()
    }

    pub(crate) fn clear_diagnostics(&self) -> Result<()> {
        {
            let mut guard = self.lock_state()?;
            guard.snapshot.diagnostics.clear();
        }
        self.truncate_diagnostics_file();
        self.emit_snapshot()
    }

    pub(crate) fn config_preview(&self) -> Result<String> {
        self.inner
            .settings
            .render(&self.snapshot_result()?.settings)
    }

    pub(crate) fn app_paths(&self) -> AppPaths {
        AppPaths {
            config_file: self.inner.settings.path().to_string_lossy().to_string(),
            models_dir: self
                .inner
                .settings
                .models_dir()
                .to_string_lossy()
                .to_string(),
            diagnostics_log_file: self
                .inner
                .settings
                .diagnostics_log_path()
                .to_string_lossy()
                .to_string(),
        }
    }

    pub(crate) async fn download_recommended_model(&self, kind: ModelKind) -> Result<AppSnapshot> {
        let settings = self.snapshot_result()?.settings;
        let model_dir = match kind {
            ModelKind::Transcription => PathBuf::from(settings.stt_model_path.trim()),
            ModelKind::Translation => PathBuf::from(settings.translation.model_path.trim()),
        };
        let model_dir = if model_dir.as_os_str().is_empty() {
            self.inner.settings.models_dir()
        } else {
            model_dir
        };

        self.push_diagnostic("info", format!("Downloading recommended {kind:?} model"))?;
        let path = match download_recommended_model_file(&model_dir, kind).await {
            Ok(path) => path,
            Err(error) => {
                let _ = self.push_diagnostic(
                    "error",
                    format!("Recommended {kind:?} model download failed: {error:#}"),
                );
                return Err(error);
            }
        };
        let relative_path = crate::recommended_models::recommended_model(kind)
            .map(|model| model.relative_path)
            .ok_or_else(|| anyhow!("no recommended model for {kind:?}"))?;
        let mut next_settings = self.snapshot_result()?.settings;
        match kind {
            ModelKind::Transcription => {
                if Path::new(next_settings.stt_model_path.trim()) != model_dir {
                    self.push_diagnostic(
                        "warning",
                        format!(
                            "Recommended {kind:?} model downloaded to {}, but the configured directory changed before selection.",
                            path.display()
                        ),
                    )?;
                    return self.snapshot_result();
                }
                next_settings.stt_model_path = model_dir.to_string_lossy().to_string();
                next_settings.stt_selected_model = relative_path.to_string();
            }
            ModelKind::Translation => {
                if Path::new(next_settings.translation.model_path.trim()) != model_dir {
                    self.push_diagnostic(
                        "warning",
                        format!(
                            "Recommended {kind:?} model downloaded to {}, but the configured directory changed before selection.",
                            path.display()
                        ),
                    )?;
                    return self.snapshot_result();
                }
                next_settings.translation.model_path = model_dir.to_string_lossy().to_string();
                next_settings.translation.selected_model = relative_path.to_string();
            }
        }

        self.update_settings(next_settings)?;
        self.push_diagnostic(
            "info",
            format!("Recommended {kind:?} model is ready at {}", path.display()),
        )?;
        self.snapshot_result()
    }

    pub(crate) fn system_metrics(&self) -> Result<SystemMetrics> {
        let mut probe = self
            .inner
            .metrics
            .lock()
            .map_err(|_| anyhow!("metrics state lock poisoned"))?;
        Ok(probe.sample())
    }

    pub(crate) fn push_segment(&self, segment: SegmentRecord) -> Result<()> {
        {
            let mut guard = self.lock_state()?;
            guard.snapshot.segments.insert(0, segment);
            guard.snapshot.segments.truncate(MAX_SEGMENTS);
            guard.snapshot.session_segment_count += 1;
        }
        self.emit_snapshot()
    }

    pub(crate) fn update_segment_translation(
        &self,
        segment_id: Uuid,
        result: Result<String>,
    ) -> Result<()> {
        let mut diagnostic = None;
        {
            let mut guard = self.lock_state()?;
            if let Some(index) = guard
                .snapshot
                .segments
                .iter()
                .position(|segment| segment.id == segment_id)
            {
                match result {
                    Ok(translation) => {
                        {
                            let segment = &mut guard.snapshot.segments[index];
                            segment.translation = Some(translation);
                            segment.status = SegmentStatus::Translated;
                        }
                        guard.snapshot.translation_health = ServiceHealth::Ready;
                        guard.snapshot.session_translation_count += 1;
                    }
                    Err(error) => {
                        let error = error.to_string();
                        {
                            let segment = &mut guard.snapshot.segments[index];
                            segment.status = SegmentStatus::TranslationFailed;
                            segment.translation = Some("Translation failed".to_string());
                        }
                        guard.snapshot.translation_health = ServiceHealth::Degraded;
                        guard.snapshot.translation_detail = Some(error.clone());
                        guard.snapshot.session_translation_failure_count += 1;

                        let entry =
                            diagnostic_entry("error", format!("Translation failed: {error}"));
                        add_diagnostic(&mut guard.snapshot, entry.clone());
                        diagnostic = Some(entry);
                    }
                }
            }
        }
        if let Some(entry) = diagnostic {
            self.append_diagnostic_to_file(&entry);
        }
        self.emit_snapshot()
    }

    pub(crate) fn push_diagnostic(
        &self,
        level: impl Into<String>,
        message: impl Into<String>,
    ) -> Result<()> {
        let entry = diagnostic_entry(level, message);
        {
            let mut guard = self.lock_state()?;
            add_diagnostic(&mut guard.snapshot, entry.clone());
        }
        self.append_diagnostic_to_file(&entry);
        self.emit_snapshot()
    }

    pub(crate) fn update_stt_health(&self, health: ServiceHealth, detail: String) -> Result<()> {
        {
            let mut guard = self.lock_state()?;
            guard.snapshot.stt_health = health;
            guard.snapshot.stt_detail = Some(detail);
        }
        self.emit_snapshot()
    }

    pub(crate) fn update_translation_health(
        &self,
        health: ServiceHealth,
        detail: String,
    ) -> Result<()> {
        {
            let mut guard = self.lock_state()?;
            guard.snapshot.translation_health = health;
            guard.snapshot.translation_detail = Some(detail);
        }
        self.emit_snapshot()
    }

    pub(crate) fn set_listening_state(
        &self,
        state: ListeningState,
        session_id: Option<Uuid>,
    ) -> Result<()> {
        {
            let mut guard = self.lock_state()?;
            guard.snapshot.listening_state = state;
            guard.snapshot.active_session_id = session_id;
            if session_id.is_none() && matches!(state, ListeningState::Idle | ListeningState::Error)
            {
                guard.snapshot.microphone.capturing = false;
                guard.snapshot.system_audio.capturing = false;
                guard.snapshot.microphone.input_level = Some(0);
                guard.snapshot.system_audio.input_level = Some(0);
            }
        }
        self.emit_snapshot()
    }

    pub(crate) fn activate_pipeline_session(&self, session_id: Uuid) -> Result<bool> {
        let activated = {
            let mut guard = self.lock_state()?;
            if guard.snapshot.active_session_id != Some(session_id)
                || !matches!(guard.snapshot.listening_state, ListeningState::Starting)
            {
                return Ok(false);
            }

            guard.snapshot.listening_state = ListeningState::Listening;
            true
        };
        self.emit_snapshot()?;
        Ok(activated)
    }

    pub(crate) fn set_source_runtime(
        &self,
        source: crate::domain::InputSource,
        capturing: bool,
        detail: impl Into<String>,
    ) -> Result<()> {
        let detail = detail.into();
        {
            let mut guard = self.lock_state()?;
            let target = match source {
                crate::domain::InputSource::Microphone => &mut guard.snapshot.microphone,
                crate::domain::InputSource::SystemAudio => &mut guard.snapshot.system_audio,
            };
            target.capturing = capturing;
            target.health = if target.available {
                if capturing {
                    ServiceHealth::Ready
                } else if target.enabled {
                    ServiceHealth::Degraded
                } else {
                    ServiceHealth::Unknown
                }
            } else {
                ServiceHealth::Unavailable
            };
            target.detail = Some(detail);
        }
        self.emit_snapshot()
    }

    pub(crate) fn update_source_level(
        &self,
        source: crate::domain::InputSource,
        input_level: f32,
    ) -> Result<()> {
        let should_emit = {
            let mut guard = self.lock_state()?;
            let accept_live_levels = guard.pipeline.is_some()
                && matches!(
                    guard.snapshot.listening_state,
                    ListeningState::Starting | ListeningState::Listening
                );
            let target = match source {
                crate::domain::InputSource::Microphone => &mut guard.snapshot.microphone,
                crate::domain::InputSource::SystemAudio => &mut guard.snapshot.system_audio,
            };

            if !accept_live_levels {
                let should_emit = target.input_level != Some(0);
                target.input_level = Some(0);
                if should_emit {
                    guard.last_level_emit_at = None;
                }
                should_emit
            } else {
                target.input_level = Some((input_level.clamp(0.0, 1.0) * 100.0).round() as u8);

                let now = Instant::now();
                let should_emit = guard
                    .last_level_emit_at
                    .map(|last| now.duration_since(last) >= Duration::from_millis(120))
                    .unwrap_or(true);
                if should_emit {
                    guard.last_level_emit_at = Some(now);
                }
                should_emit
            }
        };
        if should_emit {
            self.emit_snapshot()?;
        }
        Ok(())
    }

    pub(crate) fn mark_source_error(
        &self,
        source: crate::domain::InputSource,
        detail: impl Into<String>,
    ) -> Result<()> {
        let detail = detail.into();
        {
            let mut guard = self.lock_state()?;
            let target = match source {
                crate::domain::InputSource::Microphone => &mut guard.snapshot.microphone,
                crate::domain::InputSource::SystemAudio => &mut guard.snapshot.system_audio,
            };
            target.capturing = false;
            target.health = if target.available {
                ServiceHealth::Degraded
            } else {
                ServiceHealth::Unavailable
            };
            target.detail = Some(detail);
            target.input_level = Some(0);
        }
        self.emit_snapshot()
    }

    fn restart_listening(&self, reason: &str) -> Result<()> {
        if crate::ggml::is_shutting_down() {
            // Mirror `start_listening`: a restart triggered by an in-flight
            // settings change must not race the graceful exit.
            return Ok(());
        }

        let session_id = Uuid::new_v4();
        let pipeline = {
            let mut guard = self.lock_state()?;
            guard.snapshot.listening_state = ListeningState::Starting;
            guard.snapshot.active_session_id = Some(session_id);
            guard.snapshot.microphone.capturing = false;
            guard.snapshot.system_audio.capturing = false;
            guard.pipeline.take()
        };

        if let Some(handle) = pipeline {
            handle.stop();
        }

        self.push_diagnostic("info", reason)?;
        self.emit_snapshot()?;
        self.spawn_start_pipeline(session_id);
        Ok(())
    }

    fn spawn_start_pipeline(&self, session_id: Uuid) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            // Defensive: callers gate on `ggml::is_shutting_down` before
            // reaching this method, but the spawn here means the check and
            // the actual pipeline start happen on different ticks. Re-check
            // inside the spawned task to refuse cleanly even if shutdown
            // landed between the gate and us.
            if crate::ggml::is_shutting_down() {
                return;
            }
            match start_pipeline(Arc::new(this.clone()), session_id).await {
                Ok(handle) => {
                    let stale_handle = if let Ok(mut guard) = this.lock_state() {
                        let session_is_current = guard.snapshot.active_session_id
                            == Some(session_id)
                            && !matches!(
                                guard.snapshot.listening_state,
                                ListeningState::Idle | ListeningState::Error
                            );
                        if session_is_current {
                            guard.pipeline = Some(handle);
                            None
                        } else {
                            Some(handle)
                        }
                    } else {
                        Some(handle)
                    };
                    if let Some(handle) = stale_handle {
                        handle.stop();
                    }
                    let _ = this.emit_snapshot();
                }
                Err(error) => {
                    if this.is_session_current(session_id) {
                        let _ = this.push_diagnostic(
                            "error",
                            format!("Failed to start listening: {error:#}"),
                        );
                        let _ = this.set_listening_state(ListeningState::Error, None);
                    }
                }
            }
        });
    }

    fn persist_settings(&self) -> Result<()> {
        let snapshot = self.snapshot_result()?;
        self.inner.settings.save(&snapshot.settings)
    }

    fn refresh_runtime_healths(&self) -> Result<()> {
        let snapshot = self.snapshot_result()?;
        let stt_detail = if let Err(detail) =
            validate_model_directory(&snapshot.settings.stt_model_path, "Whisper")
        {
            Some((ServiceHealth::Unavailable, detail))
        } else {
            match snapshot.settings.selected_stt_model_path() {
                Some(path) => {
                    let engine = WhisperEngine::new(
                        path.to_string_lossy().to_string(),
                        snapshot.settings.stt_threads,
                    );
                    match engine.ensure_ready() {
                        Ok(()) => {
                            self.update_stt_health(
                                ServiceHealth::Ready,
                                format!("Whisper ready with model {}", path.display()),
                            )?;
                            None
                        }
                        Err(error) => {
                            self.update_stt_health(ServiceHealth::Degraded, error.to_string())?;
                            None
                        }
                    }
                }
                None => Some((
                    ServiceHealth::Unavailable,
                    "Choose a Whisper model from the configured directory.".to_string(),
                )),
            }
        };

        if let Some((health, detail)) = stt_detail {
            self.update_stt_health(health, detail)?;
        }

        if let Err(detail) =
            validate_model_directory(&snapshot.settings.translation.model_path, "Translation")
        {
            self.update_translation_health(ServiceHealth::Unavailable, detail)?;
            return Ok(());
        }

        let report = build_provider(&snapshot.settings.translation).check_blocking();
        self.update_translation_health(report.health, report.detail)?;
        Ok(())
    }

    fn sync_overlay_window(&self) -> Result<()> {
        let overlay = self.snapshot_result()?.settings.overlay;
        if let Some(window) = self.overlay_window() {
            window.set_always_on_top(overlay.always_on_top && overlay.visible)?;
            if overlay.visible {
                window.show()?;
                let _ = crate::platform::apply_overlay_platform_behavior(&window);
            } else {
                window.hide()?;
            }
        }
        Ok(())
    }

    fn append_diagnostic_to_file(&self, entry: &DiagnosticsEntry) {
        let logs_dir = self.inner.settings.logs_dir();
        if let Err(error) = fs::create_dir_all(&logs_dir) {
            tracing::warn!(
                "failed to create logs dir {}: {error:#}",
                logs_dir.display()
            );
            return;
        }

        let path = self.inner.settings.diagnostics_log_path();
        match fs::OpenOptions::new().create(true).append(true).open(&path) {
            Ok(mut file) => {
                let _ = writeln!(
                    file,
                    "[{}] {} {}",
                    entry.timestamp_ms,
                    entry.level.to_uppercase(),
                    entry.message
                );
            }
            Err(error) => {
                tracing::warn!(
                    "failed to append diagnostics log {}: {error:#}",
                    path.display()
                );
            }
        }
    }

    fn truncate_diagnostics_file(&self) {
        let logs_dir = self.inner.settings.logs_dir();
        if let Err(error) = fs::create_dir_all(&logs_dir) {
            tracing::warn!(
                "failed to create logs dir {} before truncating diagnostics: {error:#}",
                logs_dir.display()
            );
            return;
        }

        let path = self.inner.settings.diagnostics_log_path();
        if let Err(error) = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)
        {
            tracing::warn!(
                "failed to truncate diagnostics log {}: {error:#}",
                path.display()
            );
        }
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, RuntimeState>> {
        self.inner
            .state
            .lock()
            .map_err(|_| anyhow!("relay state lock poisoned"))
    }

    fn window(&self, label: &str, name: &str) -> Result<WebviewWindow> {
        self.inner
            .app_handle
            .get_webview_window(label)
            .ok_or_else(|| anyhow!("{name} window is not available"))
    }

    fn overlay_window(&self) -> Option<WebviewWindow> {
        self.inner
            .app_handle
            .get_webview_window(crate::windowing::OVERLAY.label)
    }

    pub(crate) fn is_session_current(&self, session_id: Uuid) -> bool {
        self.inner
            .state
            .lock()
            .map(|guard| guard.snapshot.active_session_id == Some(session_id))
            .unwrap_or(false)
    }
}

impl SystemProbe {
    fn new() -> Self {
        Self {
            system: System::new(),
            components: Components::new_with_refreshed_list(),
            pid: get_current_pid().ok(),
            initialized: false,
        }
    }

    fn sample(&mut self) -> SystemMetrics {
        self.components.refresh(false);

        if !self.initialized {
            self.system.refresh_all();
            self.initialized = true;
        } else {
            self.system.refresh_memory();
            self.system.refresh_cpu_usage();
            let process_refresh = ProcessRefreshKind::nothing().with_memory().with_cpu();
            self.system
                .refresh_processes_specifics(ProcessesToUpdate::All, true, process_refresh);
        }

        let process = self.pid.and_then(|pid| self.system.process(pid));
        SystemMetrics {
            collected_at_ms: crate::now_ms(),
            cpu_logical_cores: self.system.cpus().len(),
            system_cpu_usage: self.system.global_cpu_usage(),
            process_cpu_usage: process.map(|value| value.cpu_usage()),
            memory_used_bytes: self.system.used_memory(),
            memory_total_bytes: self.system.total_memory(),
            process_memory_bytes: process.map(|value| value.memory()),
            swap_used_bytes: self.system.used_swap(),
            swap_total_bytes: self.system.total_swap(),
            temperatures: self
                .components
                .iter()
                .filter_map(|component| {
                    let temperature = component.temperature()?;
                    if !(0.0..=140.0).contains(&temperature) {
                        return None;
                    }
                    Some(TemperatureReading {
                        label: component.label().to_string(),
                        temperature_c: temperature,
                        max_c: component.max(),
                    })
                })
                .collect(),
        }
    }
}

fn diagnostic_entry(level: impl Into<String>, message: impl Into<String>) -> DiagnosticsEntry {
    DiagnosticsEntry {
        id: Uuid::new_v4(),
        timestamp_ms: crate::now_ms(),
        level: level.into(),
        message: message.into(),
    }
}

fn add_diagnostic(snapshot: &mut AppSnapshot, entry: DiagnosticsEntry) {
    snapshot.diagnostics.insert(0, entry);
    snapshot.diagnostics.truncate(MAX_DIAGNOSTICS);
}

fn apply_input_capabilities(snapshot: &mut AppSnapshot) {
    apply_source_capability(
        &mut snapshot.microphone,
        crate::audio::microphone_capability(),
    );
    apply_source_capability(
        &mut snapshot.system_audio,
        crate::audio::system_audio_capability(),
    );
}

fn apply_source_capability(source: &mut SourceState, capability: SourceCapability) {
    source.available = capability.available;
    source.detail = Some(capability.detail);
    if !source.enabled {
        source.capturing = false;
        source.input_level = Some(0);
        source.health = if capability.available {
            ServiceHealth::Unknown
        } else {
            ServiceHealth::Unavailable
        };
    } else if capability.available {
        source.health = ServiceHealth::Ready;
    } else {
        source.capturing = false;
        source.input_level = Some(0);
        source.health = ServiceHealth::Unavailable;
    }
}

fn clear_selected_models_after_directory_change(
    previous: &RelaySettings,
    next: &mut RelaySettings,
) {
    if previous.stt_model_path != next.stt_model_path
        && previous.stt_selected_model == next.stt_selected_model
    {
        next.stt_selected_model.clear();
    }

    if previous.translation.model_path != next.translation.model_path
        && previous.translation.selected_model == next.translation.selected_model
    {
        next.translation.selected_model.clear();
    }
}

fn should_hide_controls_on_tray_click(visible: bool, focused: bool) -> bool {
    visible && focused
}

#[cfg(test)]
mod tests {
    use super::{clear_selected_models_after_directory_change, should_hide_controls_on_tray_click};
    use crate::domain::{RelaySettings, TranslationSettings};

    #[test]
    fn model_directory_change_clears_stale_selection() {
        let previous = RelaySettings {
            stt_model_path: "/old/whisper".to_string(),
            stt_selected_model: "ggml-small.bin".to_string(),
            translation: TranslationSettings {
                model_path: "/old/gguf".to_string(),
                selected_model: "qwen.gguf".to_string(),
                ..Default::default()
            },
            ..Default::default()
        };
        let mut next = previous.clone();
        next.stt_model_path = "/new/whisper".to_string();
        next.translation.model_path = "/new/gguf".to_string();

        clear_selected_models_after_directory_change(&previous, &mut next);

        assert!(next.stt_selected_model.is_empty());
        assert!(next.translation.selected_model.is_empty());
    }

    #[test]
    fn model_directory_change_keeps_explicit_new_selection() {
        let previous = RelaySettings {
            stt_model_path: "/old/whisper".to_string(),
            stt_selected_model: "old.bin".to_string(),
            ..Default::default()
        };
        let mut next = previous.clone();
        next.stt_model_path = "/new/whisper".to_string();
        next.stt_selected_model = "new.bin".to_string();

        clear_selected_models_after_directory_change(&previous, &mut next);

        assert_eq!(next.stt_selected_model, "new.bin");
    }

    #[test]
    fn tray_click_hides_controls_only_when_window_is_visible_and_focused() {
        assert!(should_hide_controls_on_tray_click(true, true));
        assert!(!should_hide_controls_on_tray_click(true, false));
        assert!(!should_hide_controls_on_tray_click(false, false));
    }
}
