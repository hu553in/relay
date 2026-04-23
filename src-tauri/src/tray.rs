use std::sync::Mutex;

use anyhow::Result;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;
use tauri::{Emitter, Manager};

use crate::app::RelayApp;
use crate::domain::AppSnapshot;
use crate::{events, ids};

struct TrayMenuState {
    start: MenuItem<tauri::Wry>,
    stop: MenuItem<tauri::Wry>,
    show_overlay: MenuItem<tauri::Wry>,
    hide_overlay: MenuItem<tauri::Wry>,
    flags: Mutex<Option<TrayMenuFlags>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct TrayMenuFlags {
    start_enabled: bool,
    stop_enabled: bool,
    show_overlay_enabled: bool,
    hide_overlay_enabled: bool,
}

pub(crate) fn configure(app: &AppHandle) -> Result<()> {
    let start = menu_item(app, ids::tray::START, "Start Listening")?;
    let stop = menu_item(app, ids::tray::STOP, "Stop Listening")?;
    let show_overlay = menu_item(app, ids::tray::SHOW_OVERLAY, "Show Overlay")?;
    let hide_overlay = menu_item(app, ids::tray::HIDE_OVERLAY, "Hide Overlay")?;
    let controls = menu_item(app, ids::tray::CONTROLS, "Controls")?;
    let settings = menu_item(app, ids::tray::SETTINGS, "Settings")?;
    let about = menu_item(app, ids::tray::ABOUT, "About")?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = menu_item(app, ids::tray::QUIT, "Quit")?;

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
    let mut builder = TrayIconBuilder::with_id(ids::tray::ICON)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Relay")
        .icon_as_template(true);

    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    app.manage(TrayMenuState {
        start,
        stop,
        show_overlay,
        hide_overlay,
        flags: Mutex::new(None),
    });
    Ok(())
}

pub(crate) fn sync(app: &AppHandle, snapshot: &AppSnapshot) {
    let Some(menu) = app.try_state::<TrayMenuState>() else {
        return;
    };

    let flags = TrayMenuFlags {
        start_enabled: snapshot.can_start_listening(),
        stop_enabled: snapshot.can_stop_listening(),
        show_overlay_enabled: !snapshot.settings.overlay.visible,
        hide_overlay_enabled: snapshot.settings.overlay.visible,
    };

    let old = {
        let mut previous = match menu.flags.lock() {
            Ok(guard) => guard,
            Err(error) => {
                tracing::warn!("failed to lock tray menu state: {error:#}");
                return;
            }
        };

        if previous.as_ref() == Some(&flags) {
            return;
        }

        let old = *previous;
        *previous = Some(flags);
        old
    };

    if old
        .map(|value| value.start_enabled != flags.start_enabled)
        .unwrap_or(true)
    {
        set_enabled(&menu.start, flags.start_enabled);
    }
    if old
        .map(|value| value.stop_enabled != flags.stop_enabled)
        .unwrap_or(true)
    {
        set_enabled(&menu.stop, flags.stop_enabled);
    }
    if old
        .map(|value| value.show_overlay_enabled != flags.show_overlay_enabled)
        .unwrap_or(true)
    {
        set_enabled(&menu.show_overlay, flags.show_overlay_enabled);
    }
    if old
        .map(|value| value.hide_overlay_enabled != flags.hide_overlay_enabled)
        .unwrap_or(true)
    {
        set_enabled(&menu.hide_overlay, flags.hide_overlay_enabled);
    }
}

pub(crate) fn handle_menu_event(app: &AppHandle, menu_id: &str) -> Result<()> {
    let Some(relay) = app.try_state::<RelayApp>() else {
        return Ok(());
    };

    match menu_id {
        ids::tray::START => relay.start_listening(),
        ids::tray::STOP => relay.stop_listening(),
        ids::tray::SHOW_OVERLAY => relay.show_overlay(),
        ids::tray::HIDE_OVERLAY => relay.hide_overlay(),
        ids::tray::CONTROLS => relay.show_controls(),
        ids::tray::SETTINGS => relay.show_settings(),
        ids::tray::ABOUT => relay.show_settings_section("about"),
        ids::tray::QUIT => {
            relay.stop_listening().ok();
            app.exit(0);
            Ok(())
        }
        _ => Ok(()),
    }
}

pub(crate) fn handle_icon_event(app: &AppHandle, relay: &RelayApp, event: TrayIconEvent) {
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

fn menu_item(app: &AppHandle, id: &str, text: &str) -> Result<MenuItem<tauri::Wry>> {
    Ok(MenuItem::with_id(app, id, text, true, None::<&str>)?)
}

fn set_enabled(item: &MenuItem<tauri::Wry>, enabled: bool) {
    if let Err(error) = item.set_enabled(enabled) {
        tracing::warn!("failed to update tray menu item: {error:#}");
    }
}
