use anyhow::Result;
use tauri::window::Color;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

type WindowBuilder<'a> = WebviewWindowBuilder<'a, tauri::Wry, AppHandle>;

pub(crate) struct WindowSpec {
    pub label: &'static str,
    pub title: &'static str,
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
}

pub(crate) struct OverlayWindowSpec {
    pub label: &'static str,
    pub title: &'static str,
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
    pub x: f64,
    pub y: f64,
}

pub(crate) const MAIN: WindowSpec = WindowSpec {
    label: "main",
    title: "Relay Controls",
    width: 1080.0,
    height: 720.0,
    min_width: 960.0,
    min_height: 640.0,
};

pub(crate) const OVERLAY: OverlayWindowSpec = OverlayWindowSpec {
    label: "overlay",
    title: "Relay Overlay",
    width: 1080.0,
    height: 560.0,
    min_width: 840.0,
    min_height: 420.0,
    x: 160.0,
    y: 120.0,
};

pub(crate) const SETTINGS: WindowSpec = WindowSpec {
    label: "settings",
    title: "Relay Settings",
    width: 980.0,
    height: 720.0,
    min_width: 880.0,
    min_height: 620.0,
};

pub(crate) fn is_managed_window(label: &str) -> bool {
    label == MAIN.label || label == OVERLAY.label || label == SETTINGS.label
}

pub(crate) fn configure(app: &AppHandle) -> Result<()> {
    if app.get_webview_window(MAIN.label).is_none() {
        build_main_window(app)?;
    }

    if app.get_webview_window(OVERLAY.label).is_none() {
        let overlay = build_overlay_window(app)?;
        crate::platform::apply_overlay_platform_behavior(&overlay)?;
    }

    if app.get_webview_window(SETTINGS.label).is_none() {
        build_settings_window(app)?;
    }

    Ok(())
}

fn base_window_builder<'a>(app: &'a AppHandle, spec: &WindowSpec) -> WindowBuilder<'a> {
    WebviewWindowBuilder::new(app, spec.label, WebviewUrl::default())
        .title(spec.title)
        .inner_size(spec.width, spec.height)
        .min_inner_size(spec.min_width, spec.min_height)
        .center()
        .visible(false)
        .resizable(true)
}

fn build_main_window(app: &AppHandle) -> Result<WebviewWindow> {
    Ok(
        crate::platform::apply_main_window_platform_behavior(base_window_builder(app, &MAIN))
            .build()?,
    )
}

fn build_settings_window(app: &AppHandle) -> Result<WebviewWindow> {
    Ok(
        crate::platform::apply_settings_window_platform_behavior(base_window_builder(
            app, &SETTINGS,
        ))
        .build()?,
    )
}

fn build_overlay_window(app: &AppHandle) -> Result<WebviewWindow> {
    Ok(
        WebviewWindowBuilder::new(app, OVERLAY.label, WebviewUrl::default())
            .title(OVERLAY.title)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(true)
            .visible(false)
            .always_on_top(false)
            .skip_taskbar(true)
            .inner_size(OVERLAY.width, OVERLAY.height)
            .min_inner_size(OVERLAY.min_width, OVERLAY.min_height)
            .position(OVERLAY.x, OVERLAY.y)
            .background_color(Color(0, 0, 0, 0))
            .build()?,
    )
}
