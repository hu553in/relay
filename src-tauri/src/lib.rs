mod app;
mod audio;
mod commands;
mod domain;
mod events;
mod pipeline;
mod platform;
mod settings;
mod shortcuts;
mod transcription;
mod translation;

use anyhow::Result;
use app::RelayApp;
use commands::{
    clear_diagnostics, clear_transcript_log, clear_translation_log, get_app_paths,
    get_config_preview, get_snapshot, get_system_metrics, hide_overlay, hide_settings,
    show_controls, show_overlay, show_settings, show_settings_section, start_listening,
    stop_listening, update_settings,
};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::window::Color;
use tauri::{ActivationPolicy, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
const WINDOW_MAIN: &str = "main";
const WINDOW_OVERLAY: &str = "overlay";
const WINDOW_SETTINGS: &str = "settings";

const MENU_START: &str = "tray.start";
const MENU_STOP: &str = "tray.stop";
const MENU_SHOW_OVERLAY: &str = "tray.show_overlay";
const MENU_HIDE_OVERLAY: &str = "tray.hide_overlay";
const MENU_CONTROLS: &str = "tray.controls";
const MENU_SETTINGS: &str = "tray.settings";
const MENU_ABOUT: &str = "tray.about";
const MENU_QUIT: &str = "tray.quit";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = run_inner() {
        eprintln!("relay failed to start: {error:#}");
    }
}

fn run_inner() -> Result<()> {
    app::init_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.set_activation_policy(ActivationPolicy::Accessory);
            app.set_dock_visibility(false);

            let relay = RelayApp::bootstrap(app.handle().clone())?;
            app.manage(relay.clone());

            configure_windows(app.handle())?;
            configure_tray(app.handle())?;
            #[cfg(desktop)]
            if let Err(error) = configure_global_shortcuts(app.handle(), relay.clone()) {
                tracing::warn!("global shortcuts unavailable: {error:#}");
                let _ = relay.push_diagnostic(
                    "warning",
                    format!("Global shortcuts unavailable: {error:#}"),
                );
            }
            relay.emit_snapshot()?;
            relay.show_controls()?;
            if relay.snapshot().settings.overlay.visible {
                relay.show_overlay()?;
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            if let Some(relay) = app.try_state::<RelayApp>() {
                let outcome = match event.id().0.as_str() {
                    MENU_START => relay.start_listening(),
                    MENU_STOP => relay.stop_listening(),
                    MENU_SHOW_OVERLAY => relay.show_overlay(),
                    MENU_HIDE_OVERLAY => relay.hide_overlay(),
                    MENU_CONTROLS => relay.show_controls(),
                    MENU_SETTINGS => relay.show_settings(),
                    MENU_ABOUT => relay.show_settings_section("about"),
                    MENU_QUIT => {
                        relay.stop_listening().ok();
                        app.exit(0);
                        Ok(())
                    }
                    _ => Ok(()),
                };

                if let Err(error) = outcome {
                    tracing::warn!("tray menu action failed: {error:#}");
                }
            }
        })
        .on_tray_icon_event(|app, event| {
            if let Some(relay) = app.try_state::<RelayApp>() {
                handle_tray_event(app, &relay, event);
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == WINDOW_MAIN
                    || window.label() == WINDOW_OVERLAY
                    || window.label() == WINDOW_SETTINGS
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            update_settings,
            start_listening,
            stop_listening,
            show_overlay,
            hide_overlay,
            show_controls,
            show_settings,
            hide_settings,
            show_settings_section,
            clear_transcript_log,
            clear_translation_log,
            clear_diagnostics,
            get_config_preview,
            get_app_paths,
            get_system_metrics
        ])
        .run(tauri::generate_context!())
        .map_err(Into::into)
}

fn configure_windows(app: &AppHandle) -> Result<()> {
    if app.get_webview_window(WINDOW_OVERLAY).is_none() {
        let overlay = WebviewWindowBuilder::new(app, WINDOW_OVERLAY, WebviewUrl::default())
            .title("Relay Overlay")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(true)
            .visible(false)
            .always_on_top(false)
            .skip_taskbar(true)
            .inner_size(1080.0, 560.0)
            .min_inner_size(840.0, 420.0)
            .position(160.0, 120.0)
            .background_color(Color(0, 0, 0, 0))
            .build()?;

        #[cfg(target_os = "macos")]
        {
            overlay.set_visible_on_all_workspaces(true)?;
        }
    }

    if app.get_webview_window(WINDOW_SETTINGS).is_none() {
        WebviewWindowBuilder::new(app, WINDOW_SETTINGS, WebviewUrl::default())
            .title("Relay Settings")
            .inner_size(980.0, 720.0)
            .min_inner_size(880.0, 620.0)
            .center()
            .visible(false)
            .resizable(true)
            .hidden_title(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .build()?;
    }

    Ok(())
}

fn configure_tray(app: &AppHandle) -> Result<()> {
    let start = MenuItem::with_id(app, MENU_START, "Start Listening", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, MENU_STOP, "Stop Listening", true, None::<&str>)?;
    let show_overlay =
        MenuItem::with_id(app, MENU_SHOW_OVERLAY, "Show Overlay", true, None::<&str>)?;
    let hide_overlay =
        MenuItem::with_id(app, MENU_HIDE_OVERLAY, "Hide Overlay", true, None::<&str>)?;
    let controls = MenuItem::with_id(app, MENU_CONTROLS, "Controls", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, MENU_SETTINGS, "Settings", true, None::<&str>)?;
    let about = MenuItem::with_id(app, MENU_ABOUT, "About", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &start,
            &stop,
            &separator,
            &show_overlay,
            &hide_overlay,
            &controls,
            &settings,
            &separator,
            &about,
            &separator,
            &quit,
        ],
    )?;

    let icon = app.default_window_icon().cloned();
    let mut builder = TrayIconBuilder::with_id("relay-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Relay")
        .icon_as_template(true);

    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

fn handle_tray_event(app: &AppHandle, relay: &RelayApp, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button,
        button_state,
        ..
    } = event
    {
        if button == MouseButton::Left && button_state == MouseButtonState::Up {
            if let Err(error) = relay.show_controls() {
                tracing::warn!("tray left click failed: {error:#}");
            }
        }
    }

    let _ = app.emit(events::EVENT_TRAY_PING, ());
}

#[cfg(desktop)]
fn configure_global_shortcuts(app: &AppHandle, relay: RelayApp) -> Result<()> {
    let mut settings = relay.snapshot().settings.shortcuts;
    let resolved = shortcuts::resolve_shortcuts(&mut settings);
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
