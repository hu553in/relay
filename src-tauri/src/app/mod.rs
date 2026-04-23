use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use sysinfo::{get_current_pid, Components, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

use crate::domain::{
    AppPaths, AppSnapshot, DiagnosticsEntry, ListeningState, ModelKind, ModelRecord, ModelState,
    RelaySettings, SegmentRecord, SegmentStatus, ServiceHealth, SystemMetrics, TemperatureReading,
};
use crate::events::{EVENT_SETTINGS_NAVIGATE, EVENT_SNAPSHOT};
use crate::pipeline::{start_pipeline, PipelineHandle};
use crate::settings::SettingsStore;
use crate::shortcuts::normalize_shortcuts;
use crate::transcription::WhisperEngine;
use crate::translation::build_provider;

const MAX_SEGMENTS: usize = 120;
const MAX_DIAGNOSTICS: usize = 60;

pub fn init_logging() {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_env_filter(EnvFilter::from_default_env())
        .compact()
        .try_init();
}

#[derive(Clone)]
pub struct RelayApp {
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
    pub fn bootstrap(app_handle: AppHandle) -> Result<Self> {
        let settings_store = SettingsStore::new();
        let mut settings = settings_store.load();
        settings.normalize_model_locations();
        let shortcut_warnings = normalize_shortcuts(&mut settings.shortcuts);
        let mut snapshot = AppSnapshot {
            settings,
            shortcut_warnings,
            ..AppSnapshot::default()
        };
        snapshot.microphone.enabled = snapshot.settings.microphone_enabled;
        snapshot.system_audio.enabled = snapshot.settings.system_audio_enabled;
        snapshot.system_audio.available = crate::platform::macos::system_audio_supported();
        if snapshot.system_audio.available {
            snapshot.system_audio.detail =
                Some("Ready to capture the default output device loopback".to_string());
            snapshot.system_audio.health = ServiceHealth::Ready;
        } else {
            snapshot.system_audio.detail = Some(crate::audio::system_audio_unavailable_detail());
            snapshot.system_audio.health = ServiceHealth::Unavailable;
        }
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

        app.refresh_runtime_healths()?;

        Ok(app)
    }

    pub fn snapshot(&self) -> AppSnapshot {
        self.inner
            .state
            .lock()
            .map(|guard| guard.snapshot.clone())
            .unwrap_or_default()
    }

    pub fn emit_snapshot(&self) -> Result<()> {
        let snapshot = self.snapshot();
        self.inner.app_handle.emit(EVENT_SNAPSHOT, snapshot)?;
        Ok(())
    }

    pub fn update_settings(&self, settings: RelaySettings) -> Result<AppSnapshot> {
        let mut settings = settings;
        settings.normalize_model_locations();
        let shortcut_warnings = normalize_shortcuts(&mut settings.shortcuts);

        let should_restart = {
            let mut guard = self.lock_state()?;
            guard.snapshot.settings = settings.clone();
            guard.snapshot.shortcut_warnings = shortcut_warnings;
            guard.snapshot.microphone.enabled = settings.microphone_enabled;
            guard.snapshot.system_audio.enabled = settings.system_audio_enabled;
            guard.snapshot.models = collect_models(&settings);
            guard.pipeline.is_some()
        };

        self.persist_settings()?;
        self.refresh_runtime_healths()?;
        self.sync_overlay_window()?;
        self.emit_snapshot()?;

        if should_restart {
            self.restart_listening(
                "Settings changed. Restarting audio pipeline with the new configuration.",
            )?;
        }

        Ok(self.snapshot())
    }

    pub fn start_listening(&self) -> Result<()> {
        let settings = self.snapshot().settings;
        if !settings.microphone_enabled && !settings.system_audio_enabled {
            self.push_diagnostic(
                "warning",
                "Enable microphone or system audio before starting listening.",
            )?;
            return Ok(());
        }

        if !matches!(self.snapshot().stt_health, ServiceHealth::Ready) {
            self.push_diagnostic(
                "warning",
                "Choose a valid Whisper model before starting listening.",
            )?;
            return Ok(());
        }

        {
            let mut guard = self.lock_state()?;
            if guard.pipeline.is_some() {
                return Ok(());
            }
            guard.snapshot.listening_state = ListeningState::Starting;
            guard.snapshot.session_started_at_ms = Some(now_ms());
            guard.snapshot.session_segment_count = 0;
            guard.snapshot.session_translation_count = 0;
            guard.snapshot.session_translation_failure_count = 0;
            guard.snapshot.microphone.capturing = false;
            guard.snapshot.system_audio.capturing = false;
        }
        self.emit_snapshot()?;

        self.spawn_start_pipeline(Uuid::new_v4());
        Ok(())
    }

    pub fn stop_listening(&self) -> Result<()> {
        let pipeline = {
            let mut guard = self.lock_state()?;
            guard.snapshot.listening_state = ListeningState::Stopping;
            guard.snapshot.active_session_id = None;
            guard.snapshot.microphone.capturing = false;
            guard.snapshot.system_audio.capturing = false;
            guard.snapshot.microphone.input_level = Some(0);
            guard.snapshot.system_audio.input_level = Some(0);
            guard.last_level_emit_at = None;
            guard.pipeline.take()
        };
        self.emit_snapshot()?;

        if let Some(handle) = pipeline {
            handle.stop();
        }

        self.set_listening_state(ListeningState::Idle, None)?;
        self.push_diagnostic("info", "Listening stopped")?;
        Ok(())
    }

    pub fn show_overlay(&self) -> Result<()> {
        let always_on_top = self.snapshot().settings.overlay.always_on_top;
        if let Some(window) = self.inner.app_handle.get_webview_window("overlay") {
            window.show()?;
            window.set_always_on_top(always_on_top)?;
            #[cfg(target_os = "macos")]
            {
                let _ = window.set_visible_on_all_workspaces(true);
            }
            window.set_focus()?;
        }

        {
            let mut guard = self.lock_state()?;
            guard.snapshot.settings.overlay.visible = true;
        }
        self.persist_settings()?;
        self.emit_snapshot()
    }

    pub fn hide_overlay(&self) -> Result<()> {
        if let Some(window) = self.inner.app_handle.get_webview_window("overlay") {
            window.set_always_on_top(false)?;
            window.hide()?;
        }

        {
            let mut guard = self.lock_state()?;
            guard.snapshot.settings.overlay.visible = false;
        }
        self.persist_settings()?;
        self.emit_snapshot()
    }

    pub fn show_controls(&self) -> Result<()> {
        let Some(window) = self.inner.app_handle.get_webview_window("main") else {
            return Err(anyhow!("main window is not available"));
        };
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
        Ok(())
    }

    pub fn show_settings(&self) -> Result<()> {
        let Some(window) = self.inner.app_handle.get_webview_window("settings") else {
            return Err(anyhow!("settings window is not available"));
        };
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
        Ok(())
    }

    pub fn hide_settings(&self) -> Result<()> {
        let Some(window) = self.inner.app_handle.get_webview_window("settings") else {
            return Err(anyhow!("settings window is not available"));
        };
        window.hide()?;
        Ok(())
    }

    pub fn show_settings_section(&self, section: &str) -> Result<()> {
        self.show_settings()?;
        self.inner
            .app_handle
            .emit(EVENT_SETTINGS_NAVIGATE, section.to_string())?;
        Ok(())
    }

    pub fn clear_transcript_log(&self) -> Result<()> {
        {
            let mut guard = self.lock_state()?;
            guard.snapshot.transcript_cleared_at_ms = Some(now_ms());
        }
        self.emit_snapshot()
    }

    pub fn clear_translation_log(&self) -> Result<()> {
        {
            let mut guard = self.lock_state()?;
            guard.snapshot.translation_cleared_at_ms = Some(now_ms());
        }
        self.emit_snapshot()
    }

    pub fn clear_diagnostics(&self) -> Result<()> {
        {
            let mut guard = self.lock_state()?;
            guard.snapshot.diagnostics.clear();
        }
        self.truncate_diagnostics_file();
        self.emit_snapshot()
    }

    pub fn config_preview(&self) -> Result<String> {
        self.inner.settings.render(&self.snapshot().settings)
    }

    pub fn app_paths(&self) -> AppPaths {
        AppPaths {
            config_file: self.inner.settings.path().to_string_lossy().to_string(),
            config_dir: self
                .inner
                .settings
                .config_dir()
                .to_string_lossy()
                .to_string(),
            logs_dir: self.inner.settings.logs_dir().to_string_lossy().to_string(),
            diagnostics_log_file: self
                .inner
                .settings
                .diagnostics_log_path()
                .to_string_lossy()
                .to_string(),
        }
    }

    pub fn system_metrics(&self) -> Result<SystemMetrics> {
        let mut probe = self
            .inner
            .metrics
            .lock()
            .map_err(|_| anyhow!("metrics state lock poisoned"))?;
        Ok(probe.sample())
    }

    pub fn push_segment(&self, segment: SegmentRecord) -> Result<()> {
        {
            let mut guard = self.lock_state()?;
            guard.snapshot.segments.insert(0, segment);
            guard.snapshot.segments.truncate(MAX_SEGMENTS);
            guard.snapshot.session_segment_count += 1;
        }
        self.emit_snapshot()
    }

    pub fn update_segment_translation(
        &self,
        segment_id: Uuid,
        result: Result<String>,
    ) -> Result<()> {
        {
            let mut guard = self.lock_state()?;
            if let Some(segment) = guard
                .snapshot
                .segments
                .iter_mut()
                .find(|segment| segment.id == segment_id)
            {
                match result {
                    Ok(translation) => {
                        segment.translation = Some(translation);
                        segment.status = SegmentStatus::Translated;
                        guard.snapshot.translation_health = ServiceHealth::Ready;
                        guard.snapshot.session_translation_count += 1;
                    }
                    Err(error) => {
                        segment.status = SegmentStatus::TranslationFailed;
                        segment.translation = Some("Translation failed".to_string());
                        guard.snapshot.translation_health = ServiceHealth::Degraded;
                        guard.snapshot.translation_detail = Some(error.to_string());
                        guard.snapshot.session_translation_failure_count += 1;
                        guard.snapshot.diagnostics.insert(
                            0,
                            DiagnosticsEntry {
                                id: Uuid::new_v4(),
                                timestamp_ms: now_ms(),
                                level: "error".to_string(),
                                message: format!("Translation failed: {error}"),
                            },
                        );
                        guard.snapshot.diagnostics.truncate(MAX_DIAGNOSTICS);
                    }
                }
            }
        }
        self.emit_snapshot()
    }

    pub fn push_diagnostic(
        &self,
        level: impl Into<String>,
        message: impl Into<String>,
    ) -> Result<()> {
        let entry = DiagnosticsEntry {
            id: Uuid::new_v4(),
            timestamp_ms: now_ms(),
            level: level.into(),
            message: message.into(),
        };
        {
            let mut guard = self.lock_state()?;
            guard.snapshot.diagnostics.insert(0, entry.clone());
            guard.snapshot.diagnostics.truncate(MAX_DIAGNOSTICS);
        }
        self.append_diagnostic_to_file(&entry);
        self.emit_snapshot()
    }

    pub fn update_stt_health(&self, health: ServiceHealth, detail: String) -> Result<()> {
        {
            let mut guard = self.lock_state()?;
            guard.snapshot.stt_health = health;
            guard.snapshot.stt_detail = Some(detail);
        }
        self.emit_snapshot()
    }

    pub fn update_translation_health(&self, health: ServiceHealth, detail: String) -> Result<()> {
        {
            let mut guard = self.lock_state()?;
            guard.snapshot.translation_health = health;
            guard.snapshot.translation_detail = Some(detail);
        }
        self.emit_snapshot()
    }

    pub fn set_listening_state(
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

    pub fn set_source_runtime(
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

    pub fn update_source_level(
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

    pub fn mark_source_error(
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
        let pipeline = {
            let mut guard = self.lock_state()?;
            guard.snapshot.listening_state = ListeningState::Starting;
            guard.snapshot.active_session_id = None;
            guard.snapshot.microphone.capturing = false;
            guard.snapshot.system_audio.capturing = false;
            guard.pipeline.take()
        };

        if let Some(handle) = pipeline {
            handle.stop();
        }

        self.push_diagnostic("info", reason)?;
        self.emit_snapshot()?;
        self.spawn_start_pipeline(Uuid::new_v4());
        Ok(())
    }

    fn spawn_start_pipeline(&self, session_id: Uuid) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            match start_pipeline(Arc::new(this.clone()), session_id).await {
                Ok(handle) => {
                    if let Ok(mut guard) = this.lock_state() {
                        guard.pipeline = Some(handle);
                    }
                    let _ = this.emit_snapshot();
                }
                Err(error) => {
                    let _ = this
                        .push_diagnostic("error", format!("Failed to start listening: {error:#}"));
                    let _ = this.set_listening_state(ListeningState::Error, None);
                }
            }
        });
    }

    fn persist_settings(&self) -> Result<()> {
        let snapshot = self.snapshot();
        self.inner.settings.save(&snapshot.settings)
    }

    fn refresh_runtime_healths(&self) -> Result<()> {
        let snapshot = self.snapshot();
        let stt_detail = if let Err(detail) =
            validate_model_directory(&snapshot.settings.stt_model_path, "Whisper")
        {
            Some((ServiceHealth::Unavailable, detail))
        } else {
            match snapshot.settings.selected_stt_model_path() {
                Some(path) => {
                    let engine = WhisperEngine::new(path.to_string_lossy().to_string());
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

        let translation_provider = build_provider(&snapshot.settings.translation);
        let report = tauri::async_runtime::block_on(translation_provider.check());
        self.update_translation_health(report.health, report.detail)?;
        Ok(())
    }

    fn sync_overlay_window(&self) -> Result<()> {
        let overlay = self.snapshot().settings.overlay;
        if let Some(window) = self.inner.app_handle.get_webview_window("overlay") {
            window.set_always_on_top(overlay.always_on_top && overlay.visible)?;
            if overlay.visible {
                window.show()?;
                #[cfg(target_os = "macos")]
                {
                    let _ = window.set_visible_on_all_workspaces(true);
                }
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
}

fn collect_models(settings: &RelaySettings) -> Vec<ModelRecord> {
    let mut candidates = BTreeMap::<String, ModelRecord>::new();
    collect_model_candidates(
        &mut candidates,
        ModelKind::Transcription,
        &settings.stt_model_path,
        &settings.stt_selected_model,
        &["bin"],
    );
    collect_model_candidates(
        &mut candidates,
        ModelKind::Translation,
        &settings.translation.model_path,
        &settings.translation.selected_model,
        &["gguf"],
    );
    candidates.into_values().collect()
}

fn collect_model_candidates(
    out: &mut BTreeMap<String, ModelRecord>,
    kind: ModelKind,
    root_dir: &str,
    selected_model: &str,
    extensions: &[&str],
) {
    let root_dir = root_dir.trim();
    if root_dir.is_empty() {
        return;
    }

    let root = Path::new(root_dir);
    let Ok(metadata) = fs::metadata(root) else {
        return;
    };

    if metadata.is_file() {
        register_model(
            out,
            kind,
            root.to_path_buf(),
            root.parent().unwrap_or(root),
            selected_model,
        );
        return;
    }

    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }

            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if !extensions
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
            {
                continue;
            }

            register_model(out, kind, path, root, selected_model);
        }
    }
}

fn register_model(
    out: &mut BTreeMap<String, ModelRecord>,
    kind: ModelKind,
    path: PathBuf,
    root: &Path,
    selected_model: &str,
) {
    let path_string = path.to_string_lossy().to_string();
    if path_string.is_empty() {
        return;
    }

    let metadata = fs::metadata(&path).ok();
    let exists = metadata.is_some();
    let relative_path = path
        .strip_prefix(root)
        .ok()
        .and_then(|value| value.to_str())
        .unwrap_or_else(|| {
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("Unknown model")
        })
        .to_string();
    let active = !selected_model.trim().is_empty() && relative_path == selected_model.trim();
    let state = if active {
        if exists {
            ModelState::Active
        } else {
            ModelState::Missing
        }
    } else if exists {
        ModelState::Available
    } else {
        ModelState::Missing
    };

    let record = ModelRecord {
        kind,
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Unknown model")
            .to_string(),
        relative_path,
        path: path_string.clone(),
        size_bytes: metadata.map(|value| value.len()),
        state,
    };

    out.entry(path_string)
        .and_modify(|current| {
            if matches!(record.state, ModelState::Active | ModelState::Missing) {
                *current = record.clone();
            }
        })
        .or_insert(record);
}

fn validate_model_directory(path: &str, label: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} model directory is empty"));
    }

    let path = Path::new(trimmed);
    if !path.exists() {
        return Err(format!(
            "{label} model directory is missing at {}",
            path.display()
        ));
    }

    let metadata = fs::metadata(path)
        .map_err(|error| format!("{label} model directory is unavailable: {error}"))?;
    if !metadata.is_dir() {
        return Err(format!("{label} model directory must point to a folder"));
    }

    fs::read_dir(path).map_err(|error| {
        format!(
            "{label} model directory cannot be read at {}: {error}",
            path.display()
        )
    })?;

    Ok(())
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
            collected_at_ms: now_ms(),
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

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}
