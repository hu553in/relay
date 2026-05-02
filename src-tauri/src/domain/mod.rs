use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::constants::{
    DEFAULT_MAX_TOKENS, DEFAULT_TARGET_LANGUAGE, DEFAULT_TOGGLE_LISTENING_SHORTCUT,
    DEFAULT_TOGGLE_OVERLAY_SHORTCUT, DEFAULT_TRANSCRIPTION_HOP_SECONDS,
    DEFAULT_TRANSCRIPTION_SENTENCE_TIMEOUT_MS, DEFAULT_TRANSCRIPTION_THREADS,
    DEFAULT_TRANSCRIPTION_WINDOW_SECONDS, DEFAULT_TRANSLATION_CONTEXT_TOKENS,
    DEFAULT_TRANSLATION_THREADS,
};

const DEFAULT_TRANSLATION_MODEL_PATH: &str = "";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum InputSource {
    Microphone,
    SystemAudio,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ListeningState {
    Idle,
    Starting,
    Listening,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ServiceHealth {
    Unknown,
    Ready,
    Degraded,
    Unavailable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SegmentStatus {
    Transcribed,
    Translating,
    Translated,
    TranslationFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceState {
    pub enabled: bool,
    pub available: bool,
    pub capturing: bool,
    pub health: ServiceHealth,
    pub input_level: Option<u8>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SourceCapability {
    pub(crate) available: bool,
    pub(crate) detail: String,
}

impl SourceCapability {
    pub(crate) fn available(detail: impl Into<String>) -> Self {
        Self {
            available: true,
            detail: detail.into(),
        }
    }

    pub(crate) fn unavailable(detail: impl Into<String>) -> Self {
        Self {
            available: false,
            detail: detail.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum ModelKind {
    Transcription,
    Translation,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModelState {
    Active,
    Available,
    Missing,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelRecord {
    pub kind: ModelKind,
    pub name: String,
    pub relative_path: String,
    pub path: String,
    pub size_bytes: Option<u64>,
    pub state: ModelState,
    pub recommended: bool,
    pub download_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranslationSettings {
    pub model_path: String,
    #[serde(default)]
    pub selected_model: String,
    pub target_language: String,
    pub max_tokens: u32,
    #[serde(default = "default_translation_context_tokens")]
    pub context_tokens: u32,
    #[serde(default = "default_translation_threads")]
    pub threads: u32,
}

impl Default for TranslationSettings {
    fn default() -> Self {
        Self {
            model_path: DEFAULT_TRANSLATION_MODEL_PATH.to_string(),
            selected_model: String::new(),
            target_language: DEFAULT_TARGET_LANGUAGE.to_string(),
            max_tokens: DEFAULT_MAX_TOKENS,
            context_tokens: DEFAULT_TRANSLATION_CONTEXT_TOKENS,
            threads: DEFAULT_TRANSLATION_THREADS,
        }
    }
}

impl TranslationSettings {
    pub fn selected_model_path(&self) -> Option<PathBuf> {
        resolve_selected_model_path(&self.model_path, &self.selected_model)
    }

    pub fn normalize_model_location(&mut self) {
        normalize_model_location(&mut self.model_path, &mut self.selected_model);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutSettings {
    pub toggle_listening: String,
    pub toggle_overlay: String,
}

impl Default for ShortcutSettings {
    fn default() -> Self {
        Self {
            toggle_listening: DEFAULT_TOGGLE_LISTENING_SHORTCUT.to_string(),
            toggle_overlay: DEFAULT_TOGGLE_OVERLAY_SHORTCUT.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OverlaySettings {
    pub visible: bool,
    #[serde(default = "default_true")]
    pub always_on_top: bool,
}

impl Default for OverlaySettings {
    fn default() -> Self {
        Self {
            visible: true,
            always_on_top: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RelaySettings {
    pub microphone_enabled: bool,
    pub system_audio_enabled: bool,
    pub stt_model_path: String,
    #[serde(default)]
    pub stt_selected_model: String,
    #[serde(default = "default_transcription_threads")]
    pub stt_threads: u32,
    #[serde(default = "default_transcription_window_seconds")]
    pub stt_window_seconds: u32,
    #[serde(default = "default_transcription_hop_seconds")]
    pub stt_hop_seconds: u32,
    #[serde(default = "default_transcription_sentence_timeout_ms")]
    pub stt_sentence_timeout_ms: u32,
    pub translation: TranslationSettings,
    pub overlay: OverlaySettings,
    #[serde(default)]
    pub shortcuts: ShortcutSettings,
}

impl Default for RelaySettings {
    fn default() -> Self {
        Self {
            microphone_enabled: true,
            system_audio_enabled: false,
            stt_model_path: String::new(),
            stt_selected_model: String::new(),
            stt_threads: DEFAULT_TRANSCRIPTION_THREADS,
            stt_window_seconds: DEFAULT_TRANSCRIPTION_WINDOW_SECONDS,
            stt_hop_seconds: DEFAULT_TRANSCRIPTION_HOP_SECONDS,
            stt_sentence_timeout_ms: DEFAULT_TRANSCRIPTION_SENTENCE_TIMEOUT_MS,
            translation: TranslationSettings::default(),
            overlay: OverlaySettings::default(),
            shortcuts: ShortcutSettings::default(),
        }
    }
}

impl RelaySettings {
    pub fn selected_stt_model_path(&self) -> Option<PathBuf> {
        resolve_selected_model_path(&self.stt_model_path, &self.stt_selected_model)
    }

    pub fn normalize_model_locations(&mut self) {
        normalize_model_location(&mut self.stt_model_path, &mut self.stt_selected_model);
        self.translation.normalize_model_location();
    }
}

const fn default_translation_context_tokens() -> u32 {
    DEFAULT_TRANSLATION_CONTEXT_TOKENS
}

const fn default_translation_threads() -> u32 {
    DEFAULT_TRANSLATION_THREADS
}

const fn default_transcription_threads() -> u32 {
    DEFAULT_TRANSCRIPTION_THREADS
}

const fn default_transcription_window_seconds() -> u32 {
    DEFAULT_TRANSCRIPTION_WINDOW_SECONDS
}

const fn default_transcription_hop_seconds() -> u32 {
    DEFAULT_TRANSCRIPTION_HOP_SECONDS
}

const fn default_transcription_sentence_timeout_ms() -> u32 {
    DEFAULT_TRANSCRIPTION_SENTENCE_TIMEOUT_MS
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsEntry {
    pub id: Uuid,
    pub timestamp_ms: u64,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SegmentRecord {
    pub id: Uuid,
    pub source: InputSource,
    pub created_at_ms: u64,
    pub transcript: String,
    pub translation: Option<String>,
    pub status: SegmentStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub listening_state: ListeningState,
    pub settings: RelaySettings,
    pub shortcut_warnings: Vec<String>,
    pub microphone: SourceState,
    pub system_audio: SourceState,
    pub stt_health: ServiceHealth,
    pub stt_detail: Option<String>,
    pub translation_health: ServiceHealth,
    pub translation_detail: Option<String>,
    pub active_session_id: Option<Uuid>,
    pub session_started_at_ms: Option<u64>,
    pub session_segment_count: u32,
    pub session_translation_count: u32,
    pub session_translation_failure_count: u32,
    pub transcript_cleared_at_ms: Option<u64>,
    pub translation_cleared_at_ms: Option<u64>,
    pub segments: Vec<SegmentRecord>,
    pub models: Vec<ModelRecord>,
    pub diagnostics: Vec<DiagnosticsEntry>,
}

impl AppSnapshot {
    pub fn has_available_input(&self) -> bool {
        (self.microphone.enabled && self.microphone.available)
            || (self.system_audio.enabled && self.system_audio.available)
    }

    pub fn stt_is_ready(&self) -> bool {
        matches!(self.stt_health, ServiceHealth::Ready)
    }

    pub fn can_start_listening(&self) -> bool {
        matches!(
            self.listening_state,
            ListeningState::Idle | ListeningState::Error
        ) && self.has_available_input()
            && self.stt_is_ready()
    }

    pub fn can_stop_listening(&self) -> bool {
        matches!(
            self.listening_state,
            ListeningState::Starting | ListeningState::Listening
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub config_file: String,
    pub models_dir: String,
    pub diagnostics_log_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TemperatureReading {
    pub label: String,
    pub temperature_c: f32,
    pub max_c: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemMetrics {
    pub collected_at_ms: u64,
    pub cpu_logical_cores: usize,
    pub system_cpu_usage: f32,
    pub process_cpu_usage: Option<f32>,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub process_memory_bytes: Option<u64>,
    pub swap_used_bytes: u64,
    pub swap_total_bytes: u64,
    pub temperatures: Vec<TemperatureReading>,
}

impl Default for AppSnapshot {
    fn default() -> Self {
        Self {
            listening_state: ListeningState::Idle,
            settings: RelaySettings::default(),
            shortcut_warnings: Vec::new(),
            microphone: SourceState {
                enabled: true,
                available: true,
                capturing: false,
                health: ServiceHealth::Ready,
                input_level: Some(0),
                detail: Some("Uses the default input device".to_string()),
            },
            system_audio: SourceState {
                enabled: false,
                available: false,
                capturing: false,
                health: ServiceHealth::Unavailable,
                input_level: Some(0),
                detail: Some(
                    "System audio capture uses the default output device loopback when that path is available"
                        .to_string(),
                ),
            },
            stt_health: ServiceHealth::Unknown,
            stt_detail: Some("Configure a local Whisper model to start live transcription".to_string()),
            translation_health: ServiceHealth::Unknown,
            translation_detail: Some("Local llama.cpp translation is optional. Relay continues without translation.".to_string()),
            active_session_id: None,
            session_started_at_ms: None,
            session_segment_count: 0,
            session_translation_count: 0,
            session_translation_failure_count: 0,
            transcript_cleared_at_ms: None,
            translation_cleared_at_ms: None,
            segments: Vec::new(),
            models: Vec::new(),
            diagnostics: Vec::new(),
        }
    }
}

const fn default_true() -> bool {
    true
}

fn normalize_model_location(directory: &mut String, selected_model: &mut String) {
    let trimmed = directory.trim();
    if trimmed.is_empty() {
        directory.clear();
        selected_model.clear();
        return;
    }

    let path = Path::new(trimmed);
    if path.is_file() {
        let normalized_directory = path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        let normalized_selected = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        *directory = normalized_directory.to_string_lossy().to_string();
        *selected_model = normalized_selected;
        return;
    }

    *directory = trimmed.to_string();
    *selected_model = normalize_model_reference(selected_model).unwrap_or_default();
}

fn resolve_selected_model_path(directory: &str, selected_model: &str) -> Option<PathBuf> {
    let directory = directory.trim();
    if directory.is_empty() {
        return None;
    }

    let root = Path::new(directory);
    let selected_model = normalize_model_reference(selected_model)?;

    Some(root.join(selected_model))
}

pub(crate) fn normalize_model_reference(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }

    let value = value.replace('\\', "/");
    if value.starts_with('/') {
        return None;
    }

    let mut normalized = Vec::new();
    for component in value.split('/') {
        if component.is_empty() || component == "." || component == ".." || component.contains(':')
        {
            return None;
        }
        normalized.push(component);
    }

    if normalized.is_empty() {
        None
    } else {
        Some(normalized.join("/"))
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{
        normalize_model_location, resolve_selected_model_path, AppSnapshot, ServiceHealth,
    };

    #[test]
    fn selected_model_path_stays_under_models_directory() {
        let resolved = resolve_selected_model_path("models", "nested/model.gguf");
        assert_eq!(
            resolved.unwrap(),
            PathBuf::from("models").join("nested").join("model.gguf")
        );
    }

    #[test]
    fn selected_model_path_rejects_parent_traversal() {
        assert!(resolve_selected_model_path("/models", "../outside.gguf").is_none());
    }

    #[test]
    fn selected_model_path_rejects_absolute_paths() {
        let absolute_model = std::env::current_dir().unwrap().join("model.gguf");
        assert!(resolve_selected_model_path("models", &absolute_model.to_string_lossy()).is_none());
    }

    #[test]
    fn selected_model_path_normalizes_backslashes() {
        let resolved = resolve_selected_model_path("models", "nested\\model.gguf");
        assert_eq!(
            resolved.unwrap(),
            PathBuf::from("models").join("nested").join("model.gguf")
        );
    }

    #[test]
    fn selected_model_path_rejects_windows_drive_paths() {
        assert!(resolve_selected_model_path("models", "C:\\models\\model.gguf").is_none());
    }

    #[test]
    fn normalize_model_location_clears_invalid_selected_model() {
        let mut directory = "models".to_string();
        let mut selected = "../outside.gguf".to_string();

        normalize_model_location(&mut directory, &mut selected);

        assert_eq!(directory, "models");
        assert!(selected.is_empty());
    }

    #[test]
    fn startability_requires_enabled_and_available_input() {
        let mut snapshot = AppSnapshot {
            stt_health: ServiceHealth::Ready,
            ..Default::default()
        };

        snapshot.settings.microphone_enabled = true;
        snapshot.microphone.enabled = true;
        snapshot.microphone.available = false;
        snapshot.settings.system_audio_enabled = false;
        snapshot.system_audio.enabled = false;

        assert!(!snapshot.has_available_input());
        assert!(!snapshot.can_start_listening());

        snapshot.settings.microphone_enabled = false;
        snapshot.microphone.enabled = false;
        snapshot.settings.system_audio_enabled = true;
        snapshot.system_audio.enabled = true;
        snapshot.system_audio.available = false;

        assert!(!snapshot.has_available_input());
        assert!(!snapshot.can_start_listening());

        snapshot.system_audio.available = true;
        assert!(snapshot.has_available_input());
        assert!(snapshot.can_start_listening());
    }
}
