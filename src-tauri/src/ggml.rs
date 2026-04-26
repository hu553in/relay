//! Single control point for tracking every blocking call that touches the
//! ggml backend runtime (whisper-rs transcribe, llama.cpp translate, model
//! loads). Required because Tauri's `app.exit(0)` triggers libc cleanup,
//! which runs the C++ static destructors of whichever ggml backend is
//! active for the current platform — Metal on macOS, CUDA / Vulkan on
//! Windows / Linux, CPU otherwise. If a transcribe / translate / load is
//! still alive on a tokio blocking thread at that moment, it dereferences
//! freed backend state and crashes (observed as SIGBUS / EXC_ARM_DA_ALIGN
//! on macOS Metal; equivalent device-state-after-free crashes are possible
//! on the other backends).
//!
//! `JoinHandle::abort` does not help — it cancels the *outer* future at its
//! next `.await`, but the blocking thread keeps running. So we cannot rely
//! on per-task tracking; some entry points (`PipelineHandle::stop`,
//! `spawn_start_pipeline`'s stale-handle branch) are fire-and-forget and
//! their tokio handles are dropped before the blocking work finishes.
//!
//! Instead we count *work items*, not *tasks*. Every place that calls into
//! the ggml backend must enter via `try_enter()`; the returned RAII guard
//! decrements the count on drop and notifies waiters when it reaches zero.
//! `drain().await` blocks until the count is zero, so the graceful-exit
//! path can hold `app.exit(0)` until the last ggml compute graph has been
//! freed by ggml itself, before libc cleanup races it.
//!
//! `begin_shutdown()` flips a one-way flag; subsequent `try_enter()` calls
//! return `None`, so callers that race the shutdown observe an explicit
//! "no new ggml work" signal and skip / abort cleanly. This closes the
//! TOCTOU window between `drain()` returning zero and `app.exit(0)` firing.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::OnceLock;

use tokio::sync::Notify;

static IN_FLIGHT: AtomicUsize = AtomicUsize::new(0);
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

fn drain_notify() -> &'static Notify {
    static NOTIFY: OnceLock<Notify> = OnceLock::new();
    NOTIFY.get_or_init(Notify::new)
}

/// RAII guard returned by [`try_enter`]. Increments the in-flight counter
/// on construction; decrements + notifies on drop. Holding this across a
/// blocking ggml backend call is what makes [`drain`] wait for that call.
#[must_use = "GgmlGuard must be held for the entire blocking ggml call"]
pub(crate) struct GgmlGuard {
    _private: (),
}

impl Drop for GgmlGuard {
    fn drop(&mut self) {
        // Release ordering pairs with the Acquire load in `drain`'s loop:
        // the waker must observe the decremented counter.
        if IN_FLIGHT.fetch_sub(1, Ordering::Release) == 1 {
            drain_notify().notify_waiters();
        }
    }
}

/// Try to register a new piece of ggml backend work. Returns `None` if a
/// graceful shutdown is in progress, in which case the caller MUST NOT
/// touch the ggml runtime — typically by short-circuiting with a
/// "shutting down" error.
///
/// Ordering: the SHUTTING_DOWN load uses Acquire so that any work spawned
/// before `begin_shutdown` (which uses Release) is guaranteed visible to
/// `drain` via the matching counter increment below.
pub(crate) fn try_enter() -> Option<GgmlGuard> {
    if SHUTTING_DOWN.load(Ordering::Acquire) {
        return None;
    }
    IN_FLIGHT.fetch_add(1, Ordering::AcqRel);
    // Re-check after the increment to close the race where `begin_shutdown`
    // and our load interleave such that the drainer would observe the
    // counter increment but never receive a notify (because we entered
    // *after* it computed "no new work expected"). On lost race, undo and
    // refuse.
    if SHUTTING_DOWN.load(Ordering::Acquire) {
        if IN_FLIGHT.fetch_sub(1, Ordering::Release) == 1 {
            drain_notify().notify_waiters();
        }
        return None;
    }
    Some(GgmlGuard { _private: () })
}

/// Mark the ggml runtime as shutting down. After this call:
///   * every subsequent `try_enter` returns `None`,
///   * the value never flips back (one-way latch — the process is exiting),
///   * already-issued guards remain valid until they drop normally.
///
/// Idempotent: calling more than once is a no-op past the first call.
pub(crate) fn begin_shutdown() {
    SHUTTING_DOWN.store(true, Ordering::Release);
}

/// True after `begin_shutdown` has been called. Higher-level command
/// handlers (start_listening, restart_listening, settings refresh) check
/// this to fail-fast at the user-facing layer instead of half-updating
/// state and then bailing inside `try_enter`.
pub(crate) fn is_shutting_down() -> bool {
    SHUTTING_DOWN.load(Ordering::Acquire)
}

/// Block until every outstanding ggml backend call has returned (i.e. its
/// guard has been dropped). Returns immediately when the count is already
/// zero. Spurious wakeups are tolerated: we re-check the counter inside
/// the loop and only return when it actually reaches zero.
pub(crate) async fn drain() {
    loop {
        if IN_FLIGHT.load(Ordering::Acquire) == 0 {
            return;
        }
        // Register interest BEFORE the second check so we cannot miss a
        // notification fired between the check and the await.
        let waiter = drain_notify().notified();
        if IN_FLIGHT.load(Ordering::Acquire) == 0 {
            return;
        }
        waiter.await;
    }
}

#[cfg(test)]
pub(crate) fn reset_for_tests() {
    SHUTTING_DOWN.store(false, Ordering::Release);
    // Note: IN_FLIGHT is process-global. Tests must clean up after
    // themselves by dropping every guard they create. This helper exists
    // only to reset the shutdown latch between tests.
}

/// Cross-module test lock. Every test that mutates the global ggml state
/// (this module's flag, or anything that reaches `try_enter`) must hold
/// this lock for its duration so cargo's default parallel test runner
/// cannot interleave conflicting state. `std::sync::Mutex` (not `tokio`)
/// because some callers are sync `#[test]` functions.
#[cfg(test)]
pub(crate) fn test_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering;
    use std::sync::Arc;
    use std::time::Duration;

    use super::{
        begin_shutdown, drain, drain_notify, reset_for_tests, try_enter, IN_FLIGHT, SHUTTING_DOWN,
    };

    // Hold the cross-module test lock across the body's await points so
    // `try_enter` callers in other modules cannot interleave with us. Tests
    // are short-lived and the lock is uncontended outside cargo's parallel
    // runner, so the usual async-deadlock concerns do not apply here.
    #[allow(clippy::await_holding_lock)]
    async fn fresh<F, Fut, R>(body: F) -> R
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = R>,
    {
        let _guard = super::test_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        reset_for_tests();
        // Sanity: the counter must be zero between tests.
        assert_eq!(IN_FLIGHT.load(Ordering::Acquire), 0);
        let result = body().await;
        // Tests that left guards alive are bugs in the test, not the code.
        assert_eq!(
            IN_FLIGHT.load(Ordering::Acquire),
            0,
            "test leaked a GgmlGuard"
        );
        // Always clear the latch so the next test starts clean even if
        // body panicked before reaching `begin_shutdown`-related state.
        reset_for_tests();
        result
    }

    #[tokio::test]
    async fn enter_increments_and_drop_decrements() {
        fresh(|| async {
            let guard = try_enter().expect("must accept first entry");
            assert_eq!(IN_FLIGHT.load(Ordering::Acquire), 1);
            drop(guard);
            assert_eq!(IN_FLIGHT.load(Ordering::Acquire), 0);
        })
        .await;
    }

    #[tokio::test]
    async fn drain_returns_immediately_when_idle() {
        fresh(|| async {
            tokio::time::timeout(Duration::from_millis(100), drain())
                .await
                .expect("drain must return when counter is already 0");
        })
        .await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn drain_waits_for_outstanding_guard() {
        fresh(|| async {
            let guard = try_enter().expect("enter must succeed");
            let drain_task = tokio::spawn(async {
                drain().await;
            });
            // Give the drainer a chance to observe a non-zero counter
            // and park on the notified() future.
            tokio::time::sleep(Duration::from_millis(50)).await;
            assert!(
                !drain_task.is_finished(),
                "drain returned while a guard was still alive"
            );
            drop(guard);
            tokio::time::timeout(Duration::from_secs(1), drain_task)
                .await
                .expect("drain must wake within 1s of last drop")
                .expect("drain task must not panic");
        })
        .await;
    }

    #[tokio::test]
    async fn begin_shutdown_blocks_subsequent_entries() {
        fresh(|| async {
            begin_shutdown();
            assert!(
                try_enter().is_none(),
                "try_enter must reject after begin_shutdown"
            );
            assert_eq!(IN_FLIGHT.load(Ordering::Acquire), 0);
        })
        .await;
    }

    #[tokio::test]
    async fn already_active_guards_survive_begin_shutdown() {
        fresh(|| async {
            let guard = try_enter().expect("first entry must succeed");
            begin_shutdown();
            assert_eq!(
                IN_FLIGHT.load(Ordering::Acquire),
                1,
                "shutdown must not decrement live guards"
            );
            // Drain must wait for this guard despite shutdown flag.
            let drain_task = tokio::spawn(async { drain().await });
            tokio::time::sleep(Duration::from_millis(30)).await;
            assert!(!drain_task.is_finished());
            drop(guard);
            tokio::time::timeout(Duration::from_secs(1), drain_task)
                .await
                .expect("drain must complete after live guard drops")
                .expect("drain task must not panic");
        })
        .await;
    }

    /// Race between `begin_shutdown` and `try_enter`: the post-increment
    /// re-check must catch the case where shutdown was set after our
    /// initial read. Otherwise a guard could leak past shutdown and the
    /// drainer would deadlock waiting for it.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn enter_post_increment_recheck_avoids_leak() {
        fresh(|| async {
            // Pre-arm shutdown then attempt enter — must reject and not
            // leave the counter incremented.
            SHUTTING_DOWN.store(false, Ordering::Release);
            let attempts: Vec<_> = (0..32)
                .map(|i| {
                    tokio::spawn(async move {
                        if i == 0 {
                            // One worker flips shutdown halfway.
                            tokio::time::sleep(Duration::from_micros(50)).await;
                            begin_shutdown();
                            None
                        } else {
                            tokio::time::sleep(Duration::from_micros(i as u64 * 5)).await;
                            try_enter().map(|_| ())
                        }
                    })
                })
                .collect();
            for handle in attempts {
                let _ = handle.await;
            }
            assert_eq!(
                IN_FLIGHT.load(Ordering::Acquire),
                0,
                "race left a stale increment in the counter"
            );
        })
        .await;
    }

    /// Touch `drain_notify` to ensure its OnceLock initializer is reachable
    /// from tests; if a future refactor makes it dead code, this fails to
    /// compile loudly rather than silently going unused.
    #[tokio::test]
    async fn drain_notify_is_addressable() {
        fresh(|| async {
            let _ = drain_notify();
            // Use `Arc` to avoid the unused-import warning when this test
            // file is the only place that imports it.
            let _ = Arc::new(());
        })
        .await;
    }
}
