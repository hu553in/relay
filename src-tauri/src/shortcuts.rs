use std::collections::HashSet;
use std::str::FromStr;

#[cfg(desktop)]
use anyhow::Result;
#[cfg(desktop)]
use tauri::AppHandle;
use tauri_plugin_global_shortcut::Shortcut;
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg(desktop)]
use crate::app::RelayApp;
use crate::domain::ShortcutSettings;

#[derive(Debug, Clone)]
struct ResolvedShortcuts {
    toggle_listening: Shortcut,
    toggle_overlay: Shortcut,
    warnings: Vec<String>,
}

pub(crate) fn normalize_shortcuts(settings: &mut ShortcutSettings) -> Vec<String> {
    resolve_shortcuts(settings).warnings
}

fn resolve_shortcuts(settings: &mut ShortcutSettings) -> ResolvedShortcuts {
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

#[cfg(desktop)]
pub(crate) fn configure_global_shortcuts(app: &AppHandle, relay: RelayApp) -> Result<()> {
    let mut settings = relay.snapshot_result()?.settings.shortcuts;
    let resolved = resolve_shortcuts(&mut settings);
    let toggle_listening = resolved.toggle_listening;
    let toggle_overlay = resolved.toggle_overlay;
    for warning in resolved.warnings {
        relay.push_diagnostic("warning", warning)?;
    }

    let relay_for_handler = relay.clone();
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |_app, shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }

                let result = if shortcut == &toggle_listening {
                    match relay_for_handler.snapshot().listening_state {
                        crate::domain::ListeningState::Listening => {
                            relay_for_handler.stop_listening()
                        }
                        _ => relay_for_handler.start_listening(),
                    }
                } else if shortcut == &toggle_overlay {
                    if relay_for_handler.snapshot().settings.overlay.visible {
                        relay_for_handler.hide_overlay()
                    } else {
                        relay_for_handler.show_overlay()
                    }
                } else {
                    Ok(())
                };

                if let Err(error) = result {
                    let _ = relay_for_handler
                        .push_diagnostic("error", format!("Global shortcut failed: {error:#}"));
                }
            })
            .build(),
    )?;

    app.global_shortcut().register(toggle_listening)?;
    app.global_shortcut().register(toggle_overlay)?;
    Ok(())
}
