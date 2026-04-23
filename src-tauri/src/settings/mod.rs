use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

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
        fs::write(&self.path, content)
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

    pub(crate) fn logs_dir(&self) -> PathBuf {
        self.config_dir().join("logs")
    }

    pub(crate) fn diagnostics_log_path(&self) -> PathBuf {
        self.logs_dir().join("diagnostics.log")
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

fn default_target_language() -> String {
    "en".to_string()
}

const fn default_max_tokens() -> u32 {
    96
}

fn default_toggle_listening() -> String {
    "CmdOrCtrl+Shift+L".to_string()
}

fn default_toggle_overlay() -> String {
    "CmdOrCtrl+Shift+O".to_string()
}

fn parse_settings(content: &str) -> Result<RelaySettings, toml::de::Error> {
    let mut settings = toml::from_str::<SettingsFile>(content)?.into_settings();
    settings.normalize_model_locations();
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::parse_settings;

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
    fn rejects_removed_or_unknown_toml_fields() {
        let error = parse_settings(
            r#"
[overlay]
compact_mode = true
"#,
        )
        .expect_err("unknown fields should be rejected");

        assert!(error.to_string().contains("compact_mode"));
    }
}
