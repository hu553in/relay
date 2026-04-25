//! Single source of truth for values shared between Rust defaults, runtime
//! caps, and the frontend UI. Anything declared here is exposed to the
//! webview through the `get_app_constants` Tauri command, so updating a
//! number/string here flows automatically to:
//!
//!   * `serde(default = "...")` paths in `settings/mod.rs`
//!   * `Default` impls in `domain/mod.rs`
//!   * runtime guards (e.g. token clamps, walk depth)
//!   * frontend hint copy and input validation (clamps, `min`/`max` attrs)
//!
//! Why a dedicated module instead of scattering consts: every value here is
//! duplicated at *minimum* twice (Rust default + Rust runtime guard) and
//! frequently three times (those two + a TS literal). One copy here removes
//! all drift hazards.

use serde::Serialize;

/// Default value for `TranslationSettings::max_tokens` on a fresh install or
/// when settings.toml is missing the field. Used by the settings file's
/// serde default and the in-memory `Default` impl alike.
pub const DEFAULT_MAX_TOKENS: u32 = 96;

/// Lower bound on `TranslationSettings::max_tokens`. A 0-token generation
/// produces no output and is rejected as "empty translation"; clamping at 1
/// is the smallest meaningful request.
pub const MIN_GENERATION_TOKENS: u32 = 1;

/// Hard ceiling on `TranslationSettings::max_tokens`. A fat-fingered or
/// malicious settings.toml entry must not let one request chew through
/// gigabytes of KV cache — 4096 is generous for "translate one transcript
/// chunk" and bounds the worst case.
pub const MAX_GENERATION_TOKENS: u32 = 4096;

/// Default target language for translation output. ISO 639-1 code; the UI
/// `LanguageCombobox` shows the human label.
pub const DEFAULT_TARGET_LANGUAGE: &str = "en";

/// Default global shortcut that toggles listening on/off. Cross-platform
/// `CmdOrCtrl` resolves to ⌘ on macOS and Ctrl elsewhere.
pub const DEFAULT_TOGGLE_LISTENING_SHORTCUT: &str = "CmdOrCtrl+Shift+L";

/// Default global shortcut that toggles overlay window visibility.
pub const DEFAULT_TOGGLE_OVERLAY_SHORTCUT: &str = "CmdOrCtrl+Shift+O";

/// Maximum directory depth that `collect_models` descends below the user's
/// configured root. Prevents accidental whole-filesystem walks (e.g. someone
/// pointing the model dir at `/`) and bounds work in pathological symlinked
/// layouts. Real model layouts live at most a couple of levels deep, so 8
/// leaves plenty of headroom.
pub const MAX_MODEL_WALK_DEPTH: usize = 8;

/// File extensions accepted as Whisper transcription models.
pub const WHISPER_MODEL_EXTENSIONS: &[&str] = &["bin"];

/// File extensions accepted as llama.cpp translation models.
pub const TRANSLATION_MODEL_EXTENSIONS: &[&str] = &["gguf"];

// ---------------------------------------------------------------------------
// Window labels (duplicated in frontend App.tsx)
// ---------------------------------------------------------------------------

/// Tauri webview window label for the main controls window.
pub const MAIN_WINDOW_LABEL: &str = "main";

/// Tauri webview window label for the overlay window.
pub const OVERLAY_WINDOW_LABEL: &str = "overlay";

/// Tauri webview window label for the settings window.
pub const SETTINGS_WINDOW_LABEL: &str = "settings";

// ---------------------------------------------------------------------------
// Event names (duplicated in frontend relay.ts / hooks)
// ---------------------------------------------------------------------------

/// Broadcast event carrying the full `AppSnapshot`. Emitted after every
/// meaningful state change so the webview stays in sync without polling.
pub const EVENT_SNAPSHOT: &str = "relay://snapshot";

/// Broadcast event sent by the tray/menu or Rust-side shortcuts to request
/// that the settings window jump to a specific section.
pub const EVENT_SETTINGS_NAVIGATE: &str = "relay://settings-navigate";

/// Ping event emitted periodically by the tray icon to keep the backend
/// alive during long idle periods. Currently consumed only in Rust.
pub const EVENT_TRAY_PING: &str = "relay://tray-ping";

// ---------------------------------------------------------------------------
// Frontend bundle
// ---------------------------------------------------------------------------

/// Frontend-visible bundle of every constant declared above. Sent once at
/// boot via the `get_app_constants` Tauri command and cached forever in the
/// React `AppConstantsProvider`. The struct is `Serialize`-only because the
/// frontend never sends it back — backend remains the source of truth.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConstants {
    pub default_max_tokens: u32,
    pub min_generation_tokens: u32,
    pub max_generation_tokens: u32,
    pub default_target_language: String,
    pub default_toggle_listening_shortcut: String,
    pub default_toggle_overlay_shortcut: String,
    pub max_model_walk_depth: u32,
    pub whisper_model_extensions: Vec<String>,
    pub translation_model_extensions: Vec<String>,
    pub main_window_label: String,
    pub overlay_window_label: String,
    pub settings_window_label: String,
    pub snapshot_event: String,
    pub settings_navigate_event: String,
}

/// Build the snapshot the frontend receives. Cheap enough that we don't
/// bother caching — invoked at most once per app launch per webview.
pub fn app_constants() -> AppConstants {
    AppConstants {
        default_max_tokens: DEFAULT_MAX_TOKENS,
        min_generation_tokens: MIN_GENERATION_TOKENS,
        max_generation_tokens: MAX_GENERATION_TOKENS,
        default_target_language: DEFAULT_TARGET_LANGUAGE.to_string(),
        default_toggle_listening_shortcut: DEFAULT_TOGGLE_LISTENING_SHORTCUT.to_string(),
        default_toggle_overlay_shortcut: DEFAULT_TOGGLE_OVERLAY_SHORTCUT.to_string(),
        max_model_walk_depth: MAX_MODEL_WALK_DEPTH as u32,
        whisper_model_extensions: WHISPER_MODEL_EXTENSIONS
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        translation_model_extensions: TRANSLATION_MODEL_EXTENSIONS
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        main_window_label: MAIN_WINDOW_LABEL.to_string(),
        overlay_window_label: OVERLAY_WINDOW_LABEL.to_string(),
        settings_window_label: SETTINGS_WINDOW_LABEL.to_string(),
        snapshot_event: EVENT_SNAPSHOT.to_string(),
        settings_navigate_event: EVENT_SETTINGS_NAVIGATE.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Bounds invariant: clamp range is non-empty and includes the default.
    /// If anyone changes one of these constants without checking the others,
    /// this test catches the inconsistency.
    #[test]
    fn token_bounds_are_internally_consistent() {
        const {
            assert!(MIN_GENERATION_TOKENS <= DEFAULT_MAX_TOKENS);
        }
        const {
            assert!(DEFAULT_MAX_TOKENS <= MAX_GENERATION_TOKENS);
        }
        const {
            assert!(MIN_GENERATION_TOKENS <= MAX_GENERATION_TOKENS);
        }
    }

    #[test]
    fn snapshot_contains_every_constant() {
        let constants = app_constants();
        assert_eq!(constants.default_max_tokens, DEFAULT_MAX_TOKENS);
        assert_eq!(constants.min_generation_tokens, MIN_GENERATION_TOKENS);
        assert_eq!(constants.max_generation_tokens, MAX_GENERATION_TOKENS);
        assert_eq!(constants.default_target_language, DEFAULT_TARGET_LANGUAGE);
        assert_eq!(
            constants.default_toggle_listening_shortcut,
            DEFAULT_TOGGLE_LISTENING_SHORTCUT
        );
        assert_eq!(
            constants.default_toggle_overlay_shortcut,
            DEFAULT_TOGGLE_OVERLAY_SHORTCUT
        );
        assert_eq!(constants.max_model_walk_depth, MAX_MODEL_WALK_DEPTH as u32);
        assert_eq!(
            constants.whisper_model_extensions,
            WHISPER_MODEL_EXTENSIONS
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            constants.translation_model_extensions,
            TRANSLATION_MODEL_EXTENSIONS
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
        );
        assert_eq!(constants.main_window_label, MAIN_WINDOW_LABEL);
        assert_eq!(constants.overlay_window_label, OVERLAY_WINDOW_LABEL);
        assert_eq!(constants.settings_window_label, SETTINGS_WINDOW_LABEL);
        assert_eq!(constants.snapshot_event, EVENT_SNAPSHOT);
        assert_eq!(constants.settings_navigate_event, EVENT_SETTINGS_NAVIGATE);
    }

    /// Camel-case field names matter: the frontend type relies on this
    /// exact spelling. A typo would only surface as `undefined` at runtime,
    /// so pin it here.
    #[test]
    fn snapshot_serializes_with_camel_case() {
        let json = serde_json::to_string(&app_constants()).expect("serialize");
        for expected in [
            "\"defaultMaxTokens\"",
            "\"minGenerationTokens\"",
            "\"maxGenerationTokens\"",
            "\"defaultTargetLanguage\"",
            "\"defaultToggleListeningShortcut\"",
            "\"defaultToggleOverlayShortcut\"",
            "\"maxModelWalkDepth\"",
            "\"whisperModelExtensions\"",
            "\"translationModelExtensions\"",
            "\"mainWindowLabel\"",
            "\"overlayWindowLabel\"",
            "\"settingsWindowLabel\"",
            "\"snapshotEvent\"",
            "\"settingsNavigateEvent\"",
        ] {
            assert!(
                json.contains(expected),
                "missing field {expected} in {json}"
            );
        }
    }
}
