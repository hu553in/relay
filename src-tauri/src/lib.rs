mod app;
mod audio;
mod commands;
mod domain;
mod events;
mod ids;
mod models;
mod pipeline;
mod platform;
mod settings;
mod shortcuts;
mod transcription;
mod translation;
mod tray;
mod windowing;

use anyhow::Result;
use app::RelayApp;
use commands::{
    clear_diagnostics, clear_transcript_log, clear_translation_log, get_app_paths,
    get_config_preview, get_snapshot, get_system_metrics, hide_overlay, hide_settings,
    show_controls, show_overlay, show_settings, show_settings_section, start_listening,
    stop_listening, update_settings,
};
use tauri::Manager;

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
            configure_app(app)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if let Err(error) = tray::handle_menu_event(app, event.id().0.as_str()) {
                tracing::warn!("tray menu action failed: {error:#}");
            }
        })
        .on_tray_icon_event(|app, event| {
            if let Some(relay) = app.try_state::<RelayApp>() {
                tray::handle_icon_event(app, &relay, event);
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if windowing::is_managed_window(window.label()) {
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

fn configure_app(app: &mut tauri::App) -> Result<()> {
    platform::configure_app_policy(app);

    let relay = RelayApp::bootstrap(app.handle().clone())?;
    app.manage(relay.clone());

    windowing::configure(app.handle())?;
    tray::configure(app.handle())?;
    configure_shortcuts(app.handle(), &relay);

    relay.emit_snapshot()?;
    relay.show_controls()?;
    if relay.snapshot_result()?.settings.overlay.visible {
        relay.show_overlay()?;
    }

    Ok(())
}

fn configure_shortcuts(app: &tauri::AppHandle, relay: &RelayApp) {
    #[cfg(desktop)]
    if let Err(error) = shortcuts::configure_global_shortcuts(app, relay.clone()) {
        tracing::warn!("global shortcuts unavailable: {error:#}");
        let _ = relay.push_diagnostic(
            "warning",
            format!("Global shortcuts unavailable: {error:#}"),
        );
    }
}
