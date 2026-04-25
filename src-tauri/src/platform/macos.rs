use anyhow::Result;
use cpal::traits::HostTrait;
use tauri::{ActivationPolicy, AppHandle, Manager, WebviewWindow, WebviewWindowBuilder};

use crate::domain::SourceCapability;
use crate::windowing;

type WindowBuilder<'a> = WebviewWindowBuilder<'a, tauri::Wry, AppHandle>;

pub(crate) fn system_audio_capability() -> SourceCapability {
    if cpal::default_host().default_output_device().is_some() {
        SourceCapability::available("Ready to capture the default output device loopback")
    } else {
        SourceCapability::unavailable(
            "System audio capture needs a default output device with loopback support",
        )
    }
}

pub(crate) fn configure_app_policy(app: &mut tauri::App) {
    app.set_activation_policy(ActivationPolicy::Accessory);
    app.set_dock_visibility(false);
}

pub(crate) fn apply_main_window_platform_behavior<'a>(
    builder: WindowBuilder<'a>,
) -> WindowBuilder<'a> {
    apply_hidden_titlebar(builder)
}

pub(crate) fn apply_settings_window_platform_behavior<'a>(
    builder: WindowBuilder<'a>,
) -> WindowBuilder<'a> {
    apply_hidden_titlebar(builder)
}

fn apply_hidden_titlebar(builder: WindowBuilder<'_>) -> WindowBuilder<'_> {
    builder
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
}

pub(crate) fn apply_overlay_platform_behavior(window: &WebviewWindow) -> Result<()> {
    window.set_visible_on_all_workspaces(true)?;
    Ok(())
}

pub(crate) fn sync_dock_visibility(app: &AppHandle) {
    let dock_visible = [windowing::MAIN.label, windowing::SETTINGS.label]
        .iter()
        .any(|label| {
            app.get_webview_window(label)
                .and_then(|window| window.is_visible().ok())
                .unwrap_or(false)
        });

    let policy = if dock_visible {
        ActivationPolicy::Regular
    } else {
        ActivationPolicy::Accessory
    };
    if let Err(error) = app.set_activation_policy(policy) {
        tracing::warn!("failed to set activation policy: {error:#}");
    }
    if let Err(error) = app.set_dock_visibility(dock_visible) {
        tracing::warn!("failed to set dock visibility: {error:#}");
    }
}
