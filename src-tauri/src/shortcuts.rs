use std::collections::HashSet;
use std::str::FromStr;

use tauri_plugin_global_shortcut::Shortcut;

use crate::domain::ShortcutSettings;

#[derive(Debug, Clone)]
pub struct ResolvedShortcuts {
    pub toggle_listening: Shortcut,
    pub toggle_overlay: Shortcut,
    pub warnings: Vec<String>,
}

pub fn normalize_shortcuts(settings: &mut ShortcutSettings) -> Vec<String> {
    resolve_shortcuts(settings).warnings
}

pub fn resolve_shortcuts(settings: &mut ShortcutSettings) -> ResolvedShortcuts {
    let defaults = ShortcutSettings::default();
    let mut warnings = Vec::new();

    let toggle_listening = parse_or_default(
        &mut settings.toggle_listening,
        &defaults.toggle_listening,
        "Toggle listening",
        &mut warnings,
    );
    let toggle_overlay = parse_or_default(
        &mut settings.toggle_overlay,
        &defaults.toggle_overlay,
        "Show or hide overlay",
        &mut warnings,
    );
    let mut seen = HashSet::new();
    seen.insert(toggle_listening.id());
    for (label, value, default_value, shortcut) in [(
        "Show or hide overlay",
        &mut settings.toggle_overlay,
        &defaults.toggle_overlay,
        &toggle_overlay,
    )] {
        if !seen.insert(shortcut.id()) {
            *value = default_value.clone();
            warnings.push(format!(
                "{label} shortcut duplicated another action, fallback to default {default_value}"
            ));
        }
    }

    let toggle_listening = Shortcut::from_str(&settings.toggle_listening)
        .expect("toggle listening shortcut already validated");
    let toggle_overlay = Shortcut::from_str(&settings.toggle_overlay)
        .expect("toggle overlay shortcut already validated");

    ResolvedShortcuts {
        toggle_listening,
        toggle_overlay,
        warnings,
    }
}

fn parse_or_default(
    value: &mut String,
    default_value: &str,
    label: &str,
    warnings: &mut Vec<String>,
) -> Shortcut {
    match Shortcut::from_str(value.trim()) {
        Ok(shortcut) => {
            *value = value.trim().to_string();
            shortcut
        }
        Err(error) => {
            *value = default_value.to_string();
            warnings.push(format!(
                "{label} shortcut is invalid ({error}), fallback to default {default_value}"
            ));
            Shortcut::from_str(default_value).expect("default shortcut must be valid")
        }
    }
}
