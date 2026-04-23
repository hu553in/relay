use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::domain::{OverlaySettings, RelaySettings, ShortcutSettings, TranslationSettings};

#[derive(Debug, Clone)]
pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new() -> Self {
        let base = dirs::config_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| PathBuf::from("."));
        let path = base.join("Relay").join("settings.toml");
        Self { path }
    }

    pub fn load(&self) -> RelaySettings {
        match fs::read_to_string(&self.path) {
            Ok(content) => match toml::from_str::<SettingsFile>(&content) {
                Ok(file) => {
                    let mut settings = file.into_settings();
                    settings.normalize_model_locations();
                    settings
                }
                Err(_) => {
                    let mut settings =
                        toml::from_str::<RelaySettings>(&content).unwrap_or_default();
                    settings.normalize_model_locations();
                    settings
                }
            },
            Err(_) => RelaySettings::default(),
        }
    }

    pub fn save(&self, settings: &RelaySettings) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("create settings dir {}", parent.display()))?;
        }

        let content = toml::to_string_pretty(&SettingsFile::from(settings))?;
        fs::write(&self.path, content)
            .with_context(|| format!("write settings file {}", self.path.display()))
    }

    pub fn render(&self, settings: &RelaySettings) -> Result<String> {
        toml::to_string_pretty(&SettingsFile::from(settings)).map_err(Into::into)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn config_dir(&self) -> PathBuf {
        self.path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."))
    }

    pub fn logs_dir(&self) -> PathBuf {
        self.config_dir().join("logs")
    }

    pub fn diagnostics_log_path(&self) -> PathBuf {
        self.logs_dir().join("diagnostics.log")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
                compact_mode: self.overlay.compact_mode,
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
                compact_mode: settings.overlay.compact_mode,
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
struct TranscriptionFile {
    #[serde(default)]
    models_dir: String,
    #[serde(default)]
    model_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
struct OverlayFile {
    #[serde(default = "default_true")]
    visible: bool,
    #[serde(default)]
    compact_mode: bool,
    #[serde(default = "default_true")]
    always_on_top: bool,
}

impl Default for OverlayFile {
    fn default() -> Self {
        Self {
            visible: true,
            compact_mode: false,
            always_on_top: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
