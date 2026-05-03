#[cfg(not(target_os = "macos"))]
mod default;
#[cfg(target_os = "macos")]
mod macos;

use anyhow::Result;
use tauri::{AppHandle, WebviewWindow, WebviewWindowBuilder};

type WindowBuilder<'a> = WebviewWindowBuilder<'a, tauri::Wry, AppHandle>;

pub(crate) fn configure_app_policy(app: &mut tauri::App) {
    #[cfg(target_os = "macos")]
    {
        macos::configure_app_policy(app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        default::configure_app_policy(app)
    }
}

pub(crate) fn install_native_termination_handler(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        macos::install_native_termination_handler(app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        default::install_native_termination_handler(app)
    }
}

pub(crate) fn finish_native_termination(app: &AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::finish_native_termination(app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        default::finish_native_termination(app)
    }
}

pub(crate) fn apply_main_window_platform_behavior<'a>(
    builder: WindowBuilder<'a>,
) -> WindowBuilder<'a> {
    #[cfg(target_os = "macos")]
    {
        macos::apply_main_window_platform_behavior(builder)
    }
    #[cfg(not(target_os = "macos"))]
    {
        default::apply_main_window_platform_behavior(builder)
    }
}

pub(crate) fn apply_settings_window_platform_behavior<'a>(
    builder: WindowBuilder<'a>,
) -> WindowBuilder<'a> {
    #[cfg(target_os = "macos")]
    {
        macos::apply_settings_window_platform_behavior(builder)
    }
    #[cfg(not(target_os = "macos"))]
    {
        default::apply_settings_window_platform_behavior(builder)
    }
}

pub(crate) fn apply_overlay_platform_behavior(window: &WebviewWindow) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        macos::apply_overlay_platform_behavior(window)
    }
    #[cfg(not(target_os = "macos"))]
    {
        default::apply_overlay_platform_behavior(window)
    }
}

pub(crate) fn sync_dock_visibility(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        macos::sync_dock_visibility(app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        default::sync_dock_visibility(app)
    }
}
