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
use crate::constants::DEFAULT_TOGGLE_LISTENING_SHORTCUT;
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
    let mut toggle_overlay = parse_or_default(
        &mut settings.toggle_overlay,
        &defaults.toggle_overlay,
        "Show or hide overlay",
        &mut warnings,
    );

    // Dedup: every action's resolved Shortcut id must be unique. If a user
    // somehow configures the same combo twice (e.g. through hand-edited
    // settings.toml), reset the duplicate to its default. We resolve the
    // default through `parse_or_default` again rather than re-parsing
    // inline, which removes the previous `.expect()` on a default that
    // *should* always parse — moving the panic risk into a single audited
    // place.
    let mut seen = HashSet::new();
    seen.insert(toggle_listening.id());
    if !seen.insert(toggle_overlay.id()) {
        let default_value = defaults.toggle_overlay.clone();
        warnings.push(format!(
            "Show or hide overlay shortcut duplicated another action, fallback to default {default_value}"
        ));
        settings.toggle_overlay = default_value.clone();
        // Re-resolve from the default. If even the default is unparseable
        // (compile-time bug), `parse_or_default` will replace the value with
        // itself and emit a warning — never panic.
        toggle_overlay = parse_or_default(
            &mut settings.toggle_overlay,
            &default_value,
            "Show or hide overlay",
            &mut warnings,
        );
    }

    ResolvedShortcuts {
        toggle_listening,
        toggle_overlay,
        warnings,
    }
}

/// Parses `*value` as a `Shortcut`, mutating it to the trimmed canonical form
/// on success or to `default_value` on failure (plus a warning entry). The
/// function returns the parsed `Shortcut` itself so the caller never has to
/// re-parse — eliminating the previous `.expect()` panics on already-validated
/// strings.
///
/// If even `default_value` fails to parse (which would be a compile-time bug
/// in the defaults), we attach a second warning and fall back to a known-good
/// hardcoded shortcut so the caller still receives a valid `Shortcut` rather
/// than panicking at startup.
fn parse_or_default(
    value: &mut String,
    default_value: &str,
    label: &str,
    warnings: &mut Vec<String>,
) -> Shortcut {
    if let Ok(shortcut) = Shortcut::from_str(value.trim()) {
        *value = value.trim().to_string();
        return shortcut;
    }

    // Parse failure on user-supplied value — fall back to default.
    *value = default_value.to_string();
    if let Ok(shortcut) = Shortcut::from_str(default_value) {
        warnings.push(format!(
            "{label} shortcut is invalid, fallback to default {default_value}"
        ));
        return shortcut;
    }

    // Default itself is unparseable. This is a programmer bug; loudly warn
    // and use a safe baseline so the app still boots. The baseline mirrors
    // `DEFAULT_TOGGLE_LISTENING_SHORTCUT` exactly because that's the value
    // we know is hand-audited; if even that fails, fall through to a hard
    // ASCII variant that doesn't depend on the CmdOrCtrl alias.
    warnings.push(format!(
        "{label} default shortcut {default_value} is unparseable, using built-in fallback {DEFAULT_TOGGLE_LISTENING_SHORTCUT}"
    ));
    Shortcut::from_str(DEFAULT_TOGGLE_LISTENING_SHORTCUT)
        .unwrap_or_else(|_| Shortcut::from_str("Ctrl+Shift+L").expect("baseline shortcut parses"))
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

                let snapshot = match relay_for_handler.snapshot_result() {
                    Ok(snapshot) => snapshot,
                    Err(error) => {
                        let _ = relay_for_handler.push_diagnostic(
                            "error",
                            format!("Global shortcut snapshot failed: {error:#}"),
                        );
                        return;
                    }
                };

                let result = if shortcut == &toggle_listening {
                    match snapshot.listening_state {
                        crate::domain::ListeningState::Listening => {
                            relay_for_handler.stop_listening()
                        }
                        _ => relay_for_handler.start_listening(),
                    }
                } else if shortcut == &toggle_overlay {
                    if snapshot.settings.overlay.visible {
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

#[cfg(test)]
mod tests {
    use super::{normalize_shortcuts, resolve_shortcuts, ShortcutSettings};
    use crate::constants::DEFAULT_TOGGLE_LISTENING_SHORTCUT;

    /// Defaults must resolve cleanly with no warnings — they are the contract
    /// every fresh install starts with on every OS.
    #[test]
    fn defaults_resolve_without_warnings() {
        let mut settings = ShortcutSettings::default();
        let warnings = normalize_shortcuts(&mut settings);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(settings, ShortcutSettings::default());
    }

    /// Garbage user input must not panic; it must roll back to the default
    /// string AND emit a warning so the diagnostics panel can show it.
    #[test]
    fn invalid_shortcut_falls_back_to_default_with_warning() {
        let mut settings = ShortcutSettings {
            toggle_listening: "this-is-not-a-shortcut".to_string(),
            toggle_overlay: ShortcutSettings::default().toggle_overlay,
        };
        let warnings = normalize_shortcuts(&mut settings);
        assert_eq!(
            settings.toggle_listening,
            ShortcutSettings::default().toggle_listening
        );
        assert!(
            warnings.iter().any(|w| w.contains("Toggle listening")),
            "{warnings:?}"
        );
    }

    /// Two actions with the same combo must dedup deterministically: the
    /// first action keeps the combo, the second resets to its default.
    #[test]
    fn duplicate_shortcut_resets_second_to_default() {
        let mut settings = ShortcutSettings {
            toggle_listening: DEFAULT_TOGGLE_LISTENING_SHORTCUT.to_string(),
            toggle_overlay: DEFAULT_TOGGLE_LISTENING_SHORTCUT.to_string(),
        };
        let warnings = normalize_shortcuts(&mut settings);
        assert_eq!(settings.toggle_listening, DEFAULT_TOGGLE_LISTENING_SHORTCUT);
        assert_eq!(
            settings.toggle_overlay,
            ShortcutSettings::default().toggle_overlay
        );
        assert!(
            warnings.iter().any(|w| w.contains("duplicated")),
            "{warnings:?}"
        );
    }

    /// Trim leading/trailing whitespace silently — common when copy-pasting
    /// from documentation. Must not be treated as invalid.
    #[test]
    fn whitespace_around_shortcut_is_trimmed() {
        let mut settings = ShortcutSettings {
            toggle_listening: format!("  {DEFAULT_TOGGLE_LISTENING_SHORTCUT}  "),
            toggle_overlay: ShortcutSettings::default().toggle_overlay,
        };
        let warnings = normalize_shortcuts(&mut settings);
        assert_eq!(settings.toggle_listening, DEFAULT_TOGGLE_LISTENING_SHORTCUT);
        assert!(warnings.is_empty(), "{warnings:?}");
    }

    /// `resolve_shortcuts` must always produce a usable pair of `Shortcut`
    /// values — even from completely garbage input — so the global shortcut
    /// registration never panics. Regression guard against the old
    /// `.expect("already validated")` codepath.
    #[test]
    fn resolve_never_panics_on_garbage_input() {
        let mut settings = ShortcutSettings {
            toggle_listening: "###".to_string(),
            toggle_overlay: "@@@".to_string(),
        };
        let resolved = resolve_shortcuts(&mut settings);
        // Either both resolved to defaults or the dedup path fired — what
        // matters is we got two distinct Shortcuts and a non-empty warning.
        assert_ne!(resolved.toggle_listening.id(), resolved.toggle_overlay.id());
        assert!(!resolved.warnings.is_empty());
    }
}
