use anyhow::Result;
use tauri::{AppHandle, WebviewWindow, WebviewWindowBuilder};

use crate::domain::SourceCapability;

pub(crate) fn system_audio_capability() -> SourceCapability {
    SourceCapability::unavailable("System audio capture is not implemented on this platform")
}

pub(crate) fn configure_app_policy(_app: &mut tauri::App) {}

pub(crate) fn apply_main_window_platform_behavior<'a>(
    builder: WebviewWindowBuilder<'a, tauri::Wry, AppHandle>,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    builder
}

pub(crate) fn apply_settings_window_platform_behavior<'a>(
    builder: WebviewWindowBuilder<'a, tauri::Wry, AppHandle>,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    builder
}

pub(crate) fn apply_overlay_platform_behavior(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}

pub(crate) fn sync_dock_visibility(_app: &AppHandle) {}
