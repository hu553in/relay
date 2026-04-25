use tauri::State;

use crate::app::RelayApp;
use crate::constants::{app_constants, AppConstants};
use crate::domain::{AppPaths, AppSnapshot, RelaySettings, SystemMetrics};

/// Thin helper: every Tauri command returns `Result<T, String>` so that the
/// webview sees a plain error message. This helper collapses the identical
/// `.map_err(|e| e.to_string())` call sites into one place.
fn map_err<T>(result: anyhow::Result<T>) -> Result<T, String> {
    result.map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn get_snapshot(app: State<'_, RelayApp>) -> Result<AppSnapshot, String> {
    map_err(app.snapshot_result())
}

#[tauri::command]
pub(crate) fn update_settings(
    app: State<'_, RelayApp>,
    settings: RelaySettings,
) -> Result<AppSnapshot, String> {
    map_err(app.update_settings(settings))
}

#[tauri::command]
pub(crate) fn start_listening(app: State<'_, RelayApp>) -> Result<(), String> {
    map_err(app.start_listening())
}

#[tauri::command]
pub(crate) fn stop_listening(app: State<'_, RelayApp>) -> Result<(), String> {
    map_err(app.stop_listening())
}

#[tauri::command]
pub(crate) fn show_overlay(app: State<'_, RelayApp>) -> Result<(), String> {
    map_err(app.show_overlay())
}

#[tauri::command]
pub(crate) fn hide_overlay(app: State<'_, RelayApp>) -> Result<(), String> {
    map_err(app.hide_overlay())
}

#[tauri::command]
pub(crate) fn show_controls(app: State<'_, RelayApp>) -> Result<(), String> {
    map_err(app.show_controls())
}

#[tauri::command]
pub(crate) fn show_settings(app: State<'_, RelayApp>) -> Result<(), String> {
    map_err(app.show_settings())
}

#[tauri::command]
pub(crate) fn hide_settings(app: State<'_, RelayApp>) -> Result<(), String> {
    map_err(app.hide_settings())
}

#[tauri::command]
pub(crate) fn show_settings_section(
    app: State<'_, RelayApp>,
    section: String,
) -> Result<(), String> {
    map_err(app.show_settings_section(&section))
}

#[tauri::command]
pub(crate) fn clear_transcript_log(app: State<'_, RelayApp>) -> Result<(), String> {
    map_err(app.clear_transcript_log())
}

#[tauri::command]
pub(crate) fn clear_translation_log(app: State<'_, RelayApp>) -> Result<(), String> {
    map_err(app.clear_translation_log())
}

#[tauri::command]
pub(crate) fn clear_diagnostics(app: State<'_, RelayApp>) -> Result<(), String> {
    map_err(app.clear_diagnostics())
}

#[tauri::command]
pub(crate) fn get_config_preview(app: State<'_, RelayApp>) -> Result<String, String> {
    map_err(app.config_preview())
}

#[tauri::command]
pub(crate) fn get_app_paths(app: State<'_, RelayApp>) -> Result<AppPaths, String> {
    Ok(app.app_paths())
}

#[tauri::command]
pub(crate) fn get_system_metrics(app: State<'_, RelayApp>) -> Result<SystemMetrics, String> {
    map_err(app.system_metrics())
}

/// Static, immutable bundle of app-level constants exposed to the webview.
/// Sent once at React boot and cached for the life of the window — backend
/// remains the source of truth, frontend is a passive consumer.
#[tauri::command]
pub(crate) fn get_app_constants() -> AppConstants {
    app_constants()
}
