mod app;
mod audio;
mod commands;
mod constants;
mod domain;
mod ggml;
mod ids;
mod models;
mod pipeline;
mod platform;
mod recommended_models;
mod settings;
mod shortcuts;
mod transcription;
mod translation;
mod tray;
mod windowing;

use std::sync::atomic::{AtomicU8, Ordering};

use anyhow::Result;

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}
use app::RelayApp;
use commands::{
    clear_diagnostics, clear_transcript_log, clear_translation_log, download_recommended_model,
    get_app_constants, get_app_paths, get_config_preview, get_snapshot, get_system_metrics,
    hide_overlay, hide_settings, show_controls, show_overlay, show_settings, show_settings_section,
    start_listening, stop_listening, update_settings,
};
use tauri::{AppHandle, Manager, RunEvent};

/// Three-state shutdown machine used by the ExitRequested handler:
///
/// * `IDLE` — no exit attempt yet; first ExitRequested begins shutdown.
/// * `IN_PROGRESS` — shutdown is running; further ExitRequested calls are
///   blocked with `prevent_exit` so a second Cmd+Q (or signal) cannot tear the
///   process down before pipeline teardown completes.
/// * `DONE` — shutdown finished and explicitly called `app.exit(0)`; we let
///   that ExitRequested through so Tauri can actually exit.
static SHUTDOWN_STATE: AtomicU8 = AtomicU8::new(SHUTDOWN_IDLE);

const SHUTDOWN_IDLE: u8 = 0;
const SHUTDOWN_IN_PROGRESS: u8 = 1;
const SHUTDOWN_DONE: u8 = 2;

#[derive(Debug, PartialEq, Eq)]
enum ExitDecision {
    /// First exit request: prevent the exit and start graceful shutdown.
    BeginShutdown,
    /// Shutdown already running: prevent the exit but do not restart it.
    PreventExit,
    /// Shutdown already finished: let Tauri actually exit.
    LetExit,
}

fn decide_exit(state: &AtomicU8) -> ExitDecision {
    match state.compare_exchange(
        SHUTDOWN_IDLE,
        SHUTDOWN_IN_PROGRESS,
        Ordering::AcqRel,
        Ordering::Acquire,
    ) {
        Ok(_) => ExitDecision::BeginShutdown,
        Err(SHUTDOWN_IN_PROGRESS) => ExitDecision::PreventExit,
        Err(_) => ExitDecision::LetExit,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = run_inner() {
        eprintln!("relay failed to start: {error:#}");
    }
}

fn run_inner() -> Result<()> {
    app::init_logging();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            configure_app(app)?;
            install_signal_handler(app.handle().clone());
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
                    platform::sync_dock_visibility(window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            update_settings,
            download_recommended_model,
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
            get_system_metrics,
            get_app_constants
        ])
        .build(tauri::generate_context!())?;

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            match decide_exit(&SHUTDOWN_STATE) {
                ExitDecision::BeginShutdown => {
                    api.prevent_exit();
                    spawn_graceful_shutdown(app_handle.clone());
                }
                ExitDecision::PreventExit => {
                    api.prevent_exit();
                }
                ExitDecision::LetExit => {}
            }
        }
    });

    Ok(())
}

fn spawn_graceful_shutdown(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Latch the ggml-shutdown flag *before* we do anything else, so any
        // start_listening / restart_listening / refresh_runtime_healths racing
        // us is rejected at the entry point rather than enqueuing fresh
        // ggml backend work that would race the upcoming `app.exit(0)`.
        ggml::begin_shutdown();

        if let Some(relay) = app.try_state::<RelayApp>() {
            let relay = relay.inner().clone();
            if let Err(error) = relay.shutdown().await {
                tracing::warn!("shutdown failed: {error:#}");
            }
        }

        // Belt-and-suspenders drain: `relay.shutdown` only awaits the *current*
        // PipelineHandle. Fire-and-forget paths (`PipelineHandle::stop` from a
        // prior `stop_listening`, the stale-handle branch of
        // `spawn_start_pipeline`, an in-flight `provider.check()` model load
        // that hasn't been wired into a handle yet) are not visible to it.
        // Every ggml backend call is wrapped in a `GgmlGuard`, so this drain
        // returns only after every such call has finished — no matter which
        // task spawned it.
        ggml::drain().await;

        // Order matters: flip to DONE before `app.exit(0)` so the ExitRequested
        // we trigger ourselves observes DONE and lets Tauri actually exit.
        SHUTDOWN_STATE.store(SHUTDOWN_DONE, Ordering::Release);
        app.exit(0);
    });
}

/// Installs a single async task that converts terminate-style OS signals
/// (SIGTERM/SIGINT/SIGHUP on unix; Ctrl+C/Ctrl+Break/Close/Logoff/Shutdown on
/// Windows) into a Tauri ExitRequested, which then drives the same graceful
/// shutdown path as Cmd+Q or the tray Quit menu.
///
/// SIGKILL and Force Quit cannot be intercepted by definition.
fn install_signal_handler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = wait_for_terminate_signal().await {
            tracing::warn!("signal handler unavailable: {error:#}");
            return;
        }
        tracing::info!("terminate signal received, requesting graceful exit");
        app.exit(0);
    });
}

#[cfg(unix)]
async fn wait_for_terminate_signal() -> Result<()> {
    use tokio::signal::unix::{signal, SignalKind};

    let mut sigterm = signal(SignalKind::terminate())?;
    let mut sigint = signal(SignalKind::interrupt())?;
    let mut sighup = signal(SignalKind::hangup())?;
    tokio::select! {
        _ = sigterm.recv() => {}
        _ = sigint.recv() => {}
        _ = sighup.recv() => {}
    }
    Ok(())
}

#[cfg(windows)]
async fn wait_for_terminate_signal() -> Result<()> {
    use tokio::signal::windows::{ctrl_break, ctrl_c, ctrl_close, ctrl_logoff, ctrl_shutdown};

    let mut c = ctrl_c()?;
    let mut br = ctrl_break()?;
    let mut cl = ctrl_close()?;
    let mut lo = ctrl_logoff()?;
    let mut sh = ctrl_shutdown()?;
    tokio::select! {
        _ = c.recv() => {}
        _ = br.recv() => {}
        _ = cl.recv() => {}
        _ = lo.recv() => {}
        _ = sh.recv() => {}
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
async fn wait_for_terminate_signal() -> Result<()> {
    std::future::pending::<()>().await;
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_exit_request_begins_shutdown() {
        let state = AtomicU8::new(SHUTDOWN_IDLE);
        assert_eq!(decide_exit(&state), ExitDecision::BeginShutdown);
        assert_eq!(state.load(Ordering::Acquire), SHUTDOWN_IN_PROGRESS);
    }

    #[test]
    fn second_exit_request_during_shutdown_is_blocked() {
        let state = AtomicU8::new(SHUTDOWN_IDLE);
        assert_eq!(decide_exit(&state), ExitDecision::BeginShutdown);
        // While the spawned graceful shutdown is still running, another Cmd+Q
        // (or signal) must NOT be allowed to slip through to Tauri's default
        // exit path — that would tear down the ggml backend mid-flight again.
        assert_eq!(decide_exit(&state), ExitDecision::PreventExit);
        assert_eq!(decide_exit(&state), ExitDecision::PreventExit);
        assert_eq!(state.load(Ordering::Acquire), SHUTDOWN_IN_PROGRESS);
    }

    #[test]
    fn exit_request_after_shutdown_is_allowed() {
        let state = AtomicU8::new(SHUTDOWN_IDLE);
        assert_eq!(decide_exit(&state), ExitDecision::BeginShutdown);
        // Simulate the spawned shutdown task finishing.
        state.store(SHUTDOWN_DONE, Ordering::Release);
        // Our own `app.exit(0)` triggers ExitRequested again — this one must
        // pass through so Tauri actually exits.
        assert_eq!(decide_exit(&state), ExitDecision::LetExit);
        assert_eq!(state.load(Ordering::Acquire), SHUTDOWN_DONE);
    }

    #[test]
    fn concurrent_exit_requests_only_one_begins_shutdown() {
        use std::sync::Arc;
        use std::thread;

        let state = Arc::new(AtomicU8::new(SHUTDOWN_IDLE));
        let threads: Vec<_> = (0..16)
            .map(|_| {
                let state = Arc::clone(&state);
                thread::spawn(move || decide_exit(&state))
            })
            .collect();

        let decisions: Vec<ExitDecision> = threads.into_iter().map(|t| t.join().unwrap()).collect();

        // Exactly one thread wins the compare_exchange and begins shutdown;
        // every other thread is told to prevent exit.
        let begin_count = decisions
            .iter()
            .filter(|d| **d == ExitDecision::BeginShutdown)
            .count();
        let prevent_count = decisions
            .iter()
            .filter(|d| **d == ExitDecision::PreventExit)
            .count();
        let let_count = decisions
            .iter()
            .filter(|d| **d == ExitDecision::LetExit)
            .count();

        assert_eq!(begin_count, 1, "exactly one thread must begin shutdown");
        assert_eq!(prevent_count, 15);
        assert_eq!(let_count, 0);
        assert_eq!(state.load(Ordering::Acquire), SHUTDOWN_IN_PROGRESS);
    }
}
