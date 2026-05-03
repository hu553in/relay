use tauri::AppHandle;

use crate::ids;

#[cfg(target_os = "macos")]
use tauri::menu::{
    AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
};

#[cfg(target_os = "macos")]
pub(crate) fn build(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let pkg_info = app.package_info();
    let config = app.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };

    let window_menu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let help_menu = Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &[])?;

    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                pkg_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about_metadata))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    // The native predefined Quit item calls
                    // -[NSApplication terminate:] directly on macOS. That
                    // bypasses Tauri's ExitRequested handler and can run
                    // ggml Metal static destructors while internal dispatch
                    // work is still alive. Keep the standard accelerator, but
                    // route it through our menu event instead.
                    &MenuItem::with_id(
                        app,
                        ids::app_menu::QUIT,
                        "Quit Relay",
                        true,
                        Some("CmdOrCtrl+Q"),
                    )?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "File",
                true,
                &[&PredefinedMenuItem::close_window(app, None)?],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)?],
            )?,
            &window_menu,
            &help_menu,
        ],
    )
}

pub(crate) fn handle_menu_event(app: &AppHandle, menu_id: &str) -> bool {
    if !is_quit_menu_id(menu_id) {
        return false;
    }

    app.exit(0);
    true
}

fn is_quit_menu_id(menu_id: &str) -> bool {
    menu_id == ids::app_menu::QUIT
}

#[cfg(test)]
mod tests {
    use super::is_quit_menu_id;
    use crate::ids;

    #[test]
    fn app_menu_quit_id_is_reserved_for_graceful_exit() {
        assert_eq!(ids::app_menu::QUIT, "app.quit");
        assert!(is_quit_menu_id(ids::app_menu::QUIT));
        assert_ne!(ids::app_menu::QUIT, ids::tray::QUIT);
    }

    #[test]
    fn non_quit_menu_ids_are_ignored_by_app_menu_handler() {
        assert!(!is_quit_menu_id(ids::tray::QUIT));
        assert_ne!(ids::tray::QUIT, ids::app_menu::QUIT);
    }
}
