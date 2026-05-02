use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::constants::{
    DEFAULT_MAX_TOKENS, DEFAULT_TARGET_LANGUAGE, DEFAULT_TOGGLE_LISTENING_SHORTCUT,
    DEFAULT_TOGGLE_OVERLAY_SHORTCUT,
};
use crate::domain::{OverlaySettings, RelaySettings, ShortcutSettings, TranslationSettings};

#[derive(Debug, Clone)]
pub(crate) struct SettingsStore {
    path: PathBuf,
}

#[derive(Debug, Clone)]
pub(crate) struct LoadedSettings {
    pub(crate) settings: RelaySettings,
    pub(crate) warning: Option<String>,
}

impl SettingsStore {
    pub(crate) fn new() -> Self {
        let base = dirs::config_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| PathBuf::from("."));
        Self {
            path: base.join("Relay").join("settings.toml"),
        }
    }

    pub(crate) fn load(&self) -> LoadedSettings {
        match fs::read_to_string(&self.path) {
            Ok(content) => match parse_settings(&content) {
                Ok(settings) => LoadedSettings {
                    settings,
                    warning: None,
                },
                Err(error) => LoadedSettings {
                    settings: RelaySettings::default(),
                    warning: Some(format!(
                        "Settings file {} could not be parsed. Defaults are active until settings are saved: {error}",
                        self.path.display()
                    )),
                },
            },
            Err(error) if error.kind() == ErrorKind::NotFound => LoadedSettings {
                settings: RelaySettings::default(),
                warning: None,
            },
            Err(error) => LoadedSettings {
                settings: RelaySettings::default(),
                warning: Some(format!(
                    "Settings file {} could not be read. Defaults are active until settings are saved: {error}",
                    self.path.display()
                )),
            },
        }
    }

    pub(crate) fn save(&self, settings: &RelaySettings) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("create settings dir {}", parent.display()))?;
        }

        let content = toml::to_string_pretty(&SettingsFile::from(settings))?;
        write_atomic(&self.path, content.as_bytes())
            .with_context(|| format!("write settings file {}", self.path.display()))
    }

    pub(crate) fn render(&self, settings: &RelaySettings) -> Result<String> {
        toml::to_string_pretty(&SettingsFile::from(settings)).map_err(Into::into)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn config_dir(&self) -> PathBuf {
        self.path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."))
    }

    pub(crate) fn models_dir(&self) -> PathBuf {
        self.config_dir().join("models")
    }

    pub(crate) fn logs_dir(&self) -> PathBuf {
        self.config_dir().join("logs")
    }

    pub(crate) fn diagnostics_log_path(&self) -> PathBuf {
        self.logs_dir().join("diagnostics.log")
    }

    pub(crate) fn ensure_app_dirs(&self) -> Result<()> {
        fs::create_dir_all(self.config_dir())
            .with_context(|| format!("create config dir {}", self.config_dir().display()))?;
        fs::create_dir_all(self.models_dir())
            .with_context(|| format!("create models dir {}", self.models_dir().display()))?;
        fs::create_dir_all(self.logs_dir())
            .with_context(|| format!("create logs dir {}", self.logs_dir().display()))?;
        Ok(())
    }

    pub(crate) fn apply_default_model_dirs(&self, settings: &mut RelaySettings) {
        let default_models_dir = self.models_dir().to_string_lossy().to_string();
        if settings.stt_model_path.trim().is_empty() {
            settings.stt_model_path = default_models_dir.clone();
        }
        if settings.translation.model_path.trim().is_empty() {
            settings.translation.model_path = default_models_dir;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct SettingsFile {
    #[serde(default)]
    inputs: InputsFile,
    #[serde(default)]
    transcription: TranscriptionFile,
    #[serde(default)]
    translation: TranslationFile,
    #[serde(default)]
    overlay: OverlayFile,
    #[serde(default)]
    shortcuts: ShortcutsFile,
}

impl SettingsFile {
    fn into_settings(self) -> RelaySettings {
        RelaySettings {
            microphone_enabled: self.inputs.microphone,
            system_audio_enabled: self.inputs.system_audio,
            stt_model_path: self.transcription.models_dir,
            stt_selected_model: self.transcription.model_file,
            translation: TranslationSettings {
                model_path: self.translation.models_dir,
                selected_model: self.translation.model_file,
                target_language: self.translation.target_language,
                max_tokens: self.translation.max_tokens,
            },
            overlay: OverlaySettings {
                visible: self.overlay.visible,
                always_on_top: self.overlay.always_on_top,
            },
            shortcuts: ShortcutSettings {
                toggle_listening: self.shortcuts.toggle_listening,
                toggle_overlay: self.shortcuts.toggle_overlay,
            },
        }
    }
}

impl From<&RelaySettings> for SettingsFile {
    fn from(settings: &RelaySettings) -> Self {
        Self {
            inputs: InputsFile {
                microphone: settings.microphone_enabled,
                system_audio: settings.system_audio_enabled,
            },
            transcription: TranscriptionFile {
                models_dir: settings.stt_model_path.clone(),
                model_file: settings.stt_selected_model.clone(),
            },
            translation: TranslationFile {
                models_dir: settings.translation.model_path.clone(),
                model_file: settings.translation.selected_model.clone(),
                target_language: settings.translation.target_language.clone(),
                max_tokens: settings.translation.max_tokens,
            },
            overlay: OverlayFile {
                visible: settings.overlay.visible,
                always_on_top: settings.overlay.always_on_top,
            },
            shortcuts: ShortcutsFile {
                toggle_listening: settings.shortcuts.toggle_listening.clone(),
                toggle_overlay: settings.shortcuts.toggle_overlay.clone(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct InputsFile {
    #[serde(default = "default_true")]
    microphone: bool,
    #[serde(default)]
    system_audio: bool,
}

impl Default for InputsFile {
    fn default() -> Self {
        Self {
            microphone: true,
            system_audio: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct TranscriptionFile {
    #[serde(default)]
    models_dir: String,
    #[serde(default)]
    model_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TranslationFile {
    #[serde(default)]
    models_dir: String,
    #[serde(default)]
    model_file: String,
    #[serde(default = "default_target_language")]
    target_language: String,
    #[serde(default = "default_max_tokens")]
    max_tokens: u32,
}

impl Default for TranslationFile {
    fn default() -> Self {
        Self {
            models_dir: String::new(),
            model_file: String::new(),
            target_language: default_target_language(),
            max_tokens: default_max_tokens(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct OverlayFile {
    #[serde(default = "default_true")]
    visible: bool,
    #[serde(default = "default_true")]
    always_on_top: bool,
}

impl Default for OverlayFile {
    fn default() -> Self {
        Self {
            visible: true,
            always_on_top: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ShortcutsFile {
    #[serde(default = "default_toggle_listening")]
    toggle_listening: String,
    #[serde(default = "default_toggle_overlay")]
    toggle_overlay: String,
}

impl Default for ShortcutsFile {
    fn default() -> Self {
        Self {
            toggle_listening: default_toggle_listening(),
            toggle_overlay: default_toggle_overlay(),
        }
    }
}

const fn default_true() -> bool {
    true
}

// Thin wrappers around `crate::constants::*`. They exist only because
// `serde(default = "...")` requires a function path, not a `const`. Each
// wrapper reads a single value from the central constants module so the
// settings file and the in-memory `Default` impls cannot drift.
fn default_target_language() -> String {
    DEFAULT_TARGET_LANGUAGE.to_string()
}

const fn default_max_tokens() -> u32 {
    DEFAULT_MAX_TOKENS
}

fn default_toggle_listening() -> String {
    DEFAULT_TOGGLE_LISTENING_SHORTCUT.to_string()
}

fn default_toggle_overlay() -> String {
    DEFAULT_TOGGLE_OVERLAY_SHORTCUT.to_string()
}

fn parse_settings(content: &str) -> Result<RelaySettings, toml::de::Error> {
    let mut settings = toml::from_str::<SettingsFile>(content)?.into_settings();
    settings.normalize_model_locations();
    Ok(settings)
}

/// Write `bytes` to `path` atomically via temp file + rename. The temp file
/// lives in the same directory as `path` so that `fs::rename` is a same-fs
/// rename (atomic on POSIX; uses ReplaceFile/MoveFileEx with replace on
/// Windows). On any error mid-write the original file at `path` is left
/// untouched. Best-effort cleanup of the temp file on failure.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "settings path has no parent directory",
        )
    })?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("settings.toml");
    // Suffix randomized to avoid collisions if two saves race; `.tmp.<uuid>`
    // is also explicit enough that a leftover from a crash is recognizable.
    let temp_path = parent.join(format!("{file_name}.tmp.{}", uuid::Uuid::new_v4()));

    if let Err(error) = fs::write(&temp_path, bytes) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    if let Err(error) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use uuid::Uuid;

    use super::{parse_settings, write_atomic, SettingsFile, SettingsStore};
    use crate::domain::RelaySettings;

    #[test]
    fn parses_sectioned_toml_settings() {
        let settings = parse_settings(
            r#"
[inputs]
microphone = false
system_audio = true

[transcription]
models_dir = "/models/stt"
model_file = "ggml-small.bin"

[translation]
models_dir = "/models/translation"
model_file = "nested/qwen.gguf"
target_language = "de"
max_tokens = 64

[overlay]
visible = false
always_on_top = false

[shortcuts]
toggle_listening = "CmdOrCtrl+Shift+T"
toggle_overlay = "CmdOrCtrl+Shift+Y"
"#,
        )
        .expect("sectioned TOML should parse");

        assert!(!settings.microphone_enabled);
        assert!(settings.system_audio_enabled);
        assert_eq!(settings.stt_model_path, "/models/stt");
        assert_eq!(settings.stt_selected_model, "ggml-small.bin");
        assert_eq!(settings.translation.model_path, "/models/translation");
        assert_eq!(settings.translation.selected_model, "nested/qwen.gguf");
        assert_eq!(settings.translation.target_language, "de");
        assert_eq!(settings.translation.max_tokens, 64);
        assert!(!settings.overlay.visible);
        assert!(!settings.overlay.always_on_top);
        assert_eq!(settings.shortcuts.toggle_listening, "CmdOrCtrl+Shift+T");
        assert_eq!(settings.shortcuts.toggle_overlay, "CmdOrCtrl+Shift+Y");
    }

    #[test]
    fn rejects_unknown_toml_fields() {
        let error = parse_settings(
            r#"
[overlay]
unknown_setting = true
"#,
        )
        .expect_err("unknown fields should be rejected");

        assert!(error.to_string().contains("unknown_setting"));
    }

    /// Defaults must round-trip cleanly through serialize → parse to keep the
    /// "open settings.toml in editor" UX honest. A field added without a
    /// matching default would silently break existing settings files.
    #[test]
    fn defaults_round_trip_through_toml() {
        let original = RelaySettings::default();
        let rendered = toml::to_string_pretty(&SettingsFile::from(&original))
            .expect("render defaults to TOML");
        let parsed = parse_settings(&rendered).expect("parse rendered defaults");
        assert_eq!(parsed, original);
    }

    /// `write_atomic` must leave the original file untouched on success and
    /// must not leave temp files around. The temp-rename pattern is the whole
    /// reason `save` was hardened — partial writes during a panic/crash were
    /// previously possible with `fs::write`.
    #[test]
    fn atomic_write_replaces_existing_content_without_partial_state() {
        let dir = std::env::temp_dir().join(format!("relay-settings-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create temp settings dir");
        let path = dir.join("settings.toml");
        fs::write(&path, b"original").expect("seed original file");

        write_atomic(&path, b"replaced").expect("atomic write succeeds");

        let actual = fs::read_to_string(&path).expect("read back");
        assert_eq!(actual, "replaced");

        // No leftover temp file siblings.
        let leftovers = fs::read_dir(&dir)
            .expect("read dir")
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains("settings.toml.tmp.")
            })
            .count();
        assert_eq!(leftovers, 0, "no temp file siblings should remain");

        fs::remove_dir_all(&dir).ok();
    }

    /// Save then load must yield byte-identical settings — the contract that
    /// makes the settings UI's "modify and persist" round-trip safe across
    /// app restarts on any OS.
    #[test]
    fn save_then_load_round_trips_settings() {
        let dir = std::env::temp_dir().join(format!("relay-settings-{}", Uuid::new_v4()));
        let path = dir.join("settings.toml");
        let store = SettingsStore { path };
        let mut settings = RelaySettings::default();
        settings.translation.target_language = "de".to_string();
        settings.translation.max_tokens = 64;
        settings.overlay.visible = false;

        store.save(&settings).expect("save");
        let loaded = store.load();

        assert!(loaded.warning.is_none(), "{:?}", loaded.warning);
        assert_eq!(loaded.settings, settings);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn default_model_dirs_live_next_to_settings_and_logs() {
        let dir = std::env::temp_dir().join(format!("relay-settings-{}", Uuid::new_v4()));
        let store = SettingsStore {
            path: dir.join("settings.toml"),
        };
        let mut settings = RelaySettings::default();

        store.apply_default_model_dirs(&mut settings);

        let expected = dir.join("models").to_string_lossy().to_string();
        assert_eq!(settings.stt_model_path, expected);
        assert_eq!(settings.translation.model_path, expected);
        assert_eq!(store.logs_dir(), dir.join("logs"));
    }
}
