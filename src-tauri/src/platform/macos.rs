use std::{
    ffi::{c_char, c_void},
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        OnceLock,
    },
};

use anyhow::{anyhow, Result};
use tauri::{ActivationPolicy, AppHandle, Manager, WebviewWindow, WebviewWindowBuilder};

use crate::windowing;

type WindowBuilder<'a> = WebviewWindowBuilder<'a, tauri::Wry, AppHandle>;
type Id = *mut c_void;
type Class = *mut c_void;
type Sel = *mut c_void;
type Imp = *const c_void;

#[cfg(target_arch = "aarch64")]
type ObjCBool = bool;
#[cfg(not(target_arch = "aarch64"))]
type ObjCBool = i8;

const NATIVE_TERMINATION_IDLE: u8 = 0;
const NATIVE_TERMINATION_PENDING: u8 = 1;
const NATIVE_TERMINATION_READY: u8 = 2;

const NS_TERMINATE_NOW: usize = 1;
const NS_TERMINATE_LATER: usize = 2;

static TERMINATION_APP: OnceLock<AppHandle> = OnceLock::new();
static NATIVE_TERMINATION_STATE: AtomicU8 = AtomicU8::new(NATIVE_TERMINATION_IDLE);
static TERMINATION_HOOK_INSTALLED: AtomicBool = AtomicBool::new(false);

#[link(name = "objc")]
extern "C" {
    fn objc_lookUpClass(name: *const c_char) -> Class;
    fn object_getClass(obj: Id) -> Class;
    fn sel_registerName(name: *const c_char) -> Sel;
    fn class_addMethod(cls: Class, name: Sel, imp: Imp, types: *const c_char) -> ObjCBool;
    fn objc_msgSend();
}

pub(crate) fn configure_app_policy(app: &mut tauri::App) {
    app.set_activation_policy(ActivationPolicy::Accessory);
    app.set_dock_visibility(false);
}

pub(crate) fn install_native_termination_handler(app: &AppHandle) {
    let _ = TERMINATION_APP.set(app.clone());

    if TERMINATION_HOOK_INSTALLED.swap(true, Ordering::AcqRel) {
        return;
    }

    if let Err(error) = unsafe { install_application_should_terminate() } {
        TERMINATION_HOOK_INSTALLED.store(false, Ordering::Release);
        tracing::warn!("failed to install macOS native termination handler: {error:#}");
    }
}

pub(crate) fn finish_native_termination(app: &AppHandle) -> bool {
    if !mark_native_termination_ready(&NATIVE_TERMINATION_STATE) {
        return false;
    }

    if let Err(error) = app.run_on_main_thread(|| unsafe {
        reply_to_application_should_terminate(true);
    }) {
        tracing::warn!("failed to resume native macOS termination on main thread: {error:#}");
        unsafe {
            reply_to_application_should_terminate(true);
        }
    }

    true
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

#[derive(Debug, PartialEq, Eq)]
enum NativeTerminationDecision {
    StartGracefulShutdown,
    WaitForGracefulShutdown,
    TerminateNow,
}

fn decide_native_termination(state: &AtomicU8) -> NativeTerminationDecision {
    match state.compare_exchange(
        NATIVE_TERMINATION_IDLE,
        NATIVE_TERMINATION_PENDING,
        Ordering::AcqRel,
        Ordering::Acquire,
    ) {
        Ok(_) => NativeTerminationDecision::StartGracefulShutdown,
        Err(NATIVE_TERMINATION_PENDING) => NativeTerminationDecision::WaitForGracefulShutdown,
        Err(NATIVE_TERMINATION_READY) => NativeTerminationDecision::TerminateNow,
        Err(_) => NativeTerminationDecision::WaitForGracefulShutdown,
    }
}

fn mark_native_termination_ready(state: &AtomicU8) -> bool {
    state
        .compare_exchange(
            NATIVE_TERMINATION_PENDING,
            NATIVE_TERMINATION_READY,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_ok()
}

unsafe fn install_application_should_terminate() -> Result<()> {
    let ns_app = shared_application().ok_or_else(|| anyhow!("NSApplication unavailable"))?;
    let delegate = objc_msg_send_id(ns_app, selector(b"delegate\0"));
    if delegate.is_null() {
        return Err(anyhow!("NSApplication delegate unavailable"));
    }

    let delegate_class = object_getClass(delegate);
    if delegate_class.is_null() {
        return Err(anyhow!("NSApplication delegate class unavailable"));
    }

    let did_add = class_addMethod(
        delegate_class,
        selector(b"applicationShouldTerminate:\0"),
        application_should_terminate as *const () as Imp,
        c"Q@:@".as_ptr().cast(),
    );
    if !objc_bool(did_add) {
        return Err(anyhow!(
            "NSApplication delegate already implements applicationShouldTerminate:"
        ));
    }

    Ok(())
}

extern "C" fn application_should_terminate(_this: Id, _cmd: Sel, _sender: Id) -> usize {
    match decide_native_termination(&NATIVE_TERMINATION_STATE) {
        NativeTerminationDecision::StartGracefulShutdown => {
            tracing::info!("native macOS termination requested; routing through graceful shutdown");
            if let Some(app) = TERMINATION_APP.get() {
                app.exit(0);
                NS_TERMINATE_LATER
            } else {
                tracing::warn!(
                    "native macOS termination requested before app handle was installed"
                );
                NS_TERMINATE_NOW
            }
        }
        NativeTerminationDecision::WaitForGracefulShutdown => NS_TERMINATE_LATER,
        NativeTerminationDecision::TerminateNow => NS_TERMINATE_NOW,
    }
}

unsafe fn shared_application() -> Option<Id> {
    let ns_application = objc_lookUpClass(c"NSApplication".as_ptr());
    if ns_application.is_null() {
        return None;
    }

    let app = objc_msg_send_class_id(ns_application, selector(b"sharedApplication\0"));
    (!app.is_null()).then_some(app)
}

unsafe fn reply_to_application_should_terminate(should_terminate: bool) {
    if let Some(app) = shared_application() {
        objc_msg_send_id_bool(
            app,
            selector(b"replyToApplicationShouldTerminate:\0"),
            should_terminate,
        );
    }
}

unsafe fn selector(name: &'static [u8]) -> Sel {
    sel_registerName(name.as_ptr().cast())
}

unsafe fn objc_msg_send_class_id(target: Class, selector: Sel) -> Id {
    let send: extern "C" fn(Class, Sel) -> Id = std::mem::transmute(objc_msgSend as *const ());
    send(target, selector)
}

unsafe fn objc_msg_send_id(target: Id, selector: Sel) -> Id {
    let send: extern "C" fn(Id, Sel) -> Id = std::mem::transmute(objc_msgSend as *const ());
    send(target, selector)
}

unsafe fn objc_msg_send_id_bool(target: Id, selector: Sel, value: bool) {
    let send: extern "C" fn(Id, Sel, ObjCBool) = std::mem::transmute(objc_msgSend as *const ());
    send(target, selector, objc_bool_value(value));
}

#[cfg(target_arch = "aarch64")]
fn objc_bool(value: ObjCBool) -> bool {
    value
}

#[cfg(not(target_arch = "aarch64"))]
fn objc_bool(value: ObjCBool) -> bool {
    value != 0
}

#[cfg(target_arch = "aarch64")]
fn objc_bool_value(value: bool) -> ObjCBool {
    value
}

#[cfg(not(target_arch = "aarch64"))]
fn objc_bool_value(value: bool) -> ObjCBool {
    i8::from(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_termination_first_request_defers_to_graceful_shutdown() {
        let state = AtomicU8::new(NATIVE_TERMINATION_IDLE);

        assert_eq!(
            decide_native_termination(&state),
            NativeTerminationDecision::StartGracefulShutdown
        );
        assert_eq!(state.load(Ordering::Acquire), NATIVE_TERMINATION_PENDING);
    }

    #[test]
    fn native_termination_repeats_wait_while_shutdown_runs() {
        let state = AtomicU8::new(NATIVE_TERMINATION_PENDING);

        assert_eq!(
            decide_native_termination(&state),
            NativeTerminationDecision::WaitForGracefulShutdown
        );
        assert_eq!(state.load(Ordering::Acquire), NATIVE_TERMINATION_PENDING);
    }

    #[test]
    fn native_termination_ready_allows_appkit_to_continue() {
        let state = AtomicU8::new(NATIVE_TERMINATION_READY);

        assert_eq!(
            decide_native_termination(&state),
            NativeTerminationDecision::TerminateNow
        );
        assert_eq!(state.load(Ordering::Acquire), NATIVE_TERMINATION_READY);
    }

    #[test]
    fn finish_native_termination_only_resumes_pending_request() {
        let idle = AtomicU8::new(NATIVE_TERMINATION_IDLE);
        let pending = AtomicU8::new(NATIVE_TERMINATION_PENDING);

        assert!(!mark_native_termination_ready(&idle));
        assert!(mark_native_termination_ready(&pending));
        assert_eq!(pending.load(Ordering::Acquire), NATIVE_TERMINATION_READY);
    }
}
