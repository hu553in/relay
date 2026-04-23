use tauri::State;

use crate::app::RelayApp;
use crate::domain::{AppPaths, AppSnapshot, RelaySettings, SystemMetrics};

#[tauri::command]
pub fn get_snapshot(app: State<'_, RelayApp>) -> Result<AppSnapshot, String> {
    Ok(app.snapshot())
}

#[tauri::command]
pub fn update_settings(
    app: State<'_, RelayApp>,
    settings: RelaySettings,
) -> Result<AppSnapshot, String> {
    app.update_settings(settings)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn start_listening(app: State<'_, RelayApp>) -> Result<(), String> {
    app.start_listening().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn stop_listening(app: State<'_, RelayApp>) -> Result<(), String> {
    app.stop_listening().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn show_overlay(app: State<'_, RelayApp>) -> Result<(), String> {
    app.show_overlay().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn hide_overlay(app: State<'_, RelayApp>) -> Result<(), String> {
    app.hide_overlay().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn show_controls(app: State<'_, RelayApp>) -> Result<(), String> {
    app.show_controls().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn show_settings(app: State<'_, RelayApp>) -> Result<(), String> {
    app.show_settings().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn hide_settings(app: State<'_, RelayApp>) -> Result<(), String> {
    app.hide_settings().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn show_settings_section(app: State<'_, RelayApp>, section: String) -> Result<(), String> {
    app.show_settings_section(&section)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_transcript_log(app: State<'_, RelayApp>) -> Result<(), String> {
    app.clear_transcript_log()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_translation_log(app: State<'_, RelayApp>) -> Result<(), String> {
    app.clear_translation_log()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_diagnostics(app: State<'_, RelayApp>) -> Result<(), String> {
    app.clear_diagnostics().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_config_preview(app: State<'_, RelayApp>) -> Result<String, String> {
    app.config_preview().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_app_paths(app: State<'_, RelayApp>) -> Result<AppPaths, String> {
    Ok(app.app_paths())
}

#[tauri::command]
pub fn get_system_metrics(app: State<'_, RelayApp>) -> Result<SystemMetrics, String> {
    app.system_metrics().map_err(|error| error.to_string())
}
