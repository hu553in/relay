use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use tokio::sync::mpsc;

use crate::audio::RawAudioChunk;
use crate::domain::{SourceCapability, UserMessage};

use super::{AudioErrorCallback, SystemAudioBackend};

mod commands;
mod reader;

use commands::{Backend, CaptureCommand};
use reader::{read_capture_stdout, StopFlag};
#[cfg(test)]
use std::ffi::OsString;

const TEXT_FILE_BUSY_ERROR: i32 = 26;
const CAPTURE_SPAWN_ATTEMPTS: usize = 3;
const CAPTURE_SPAWN_RETRY_DELAY: Duration = Duration::from_millis(10);

pub(crate) struct SystemAudioInputHandle {
    child: Arc<Mutex<Child>>,
    reader: Option<JoinHandle<()>>,
    stop_requested: StopFlag,
    detail: UserMessage,
}

impl SystemAudioBackend for SystemAudioInputHandle {
    fn start(tx: mpsc::Sender<RawAudioChunk>, on_error: AudioErrorCallback) -> Result<Self> {
        start_backend(Backend::PipeWire, tx.clone(), on_error.clone()).or_else(|pipewire_error| {
            start_backend(Backend::PulseAudio, tx, on_error)
                .with_context(|| format!("PipeWire capture failed first: {pipewire_error:#}"))
        })
    }

    fn detail(&self) -> UserMessage {
        self.detail.clone()
    }
}

impl SystemAudioInputHandle {
    pub(crate) fn start(
        tx: mpsc::Sender<RawAudioChunk>,
        on_error: AudioErrorCallback,
    ) -> Result<Self> {
        <Self as SystemAudioBackend>::start(tx, on_error)
    }

    pub(crate) fn detail(&self) -> UserMessage {
        <Self as SystemAudioBackend>::detail(self)
    }
}

impl Drop for SystemAudioInputHandle {
    fn drop(&mut self) {
        self.stop_requested.store(true, Ordering::Release);
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
        if let Ok(mut child) = self.child.lock() {
            let _ = child.wait();
        }
    }
}

pub(crate) fn capability() -> SourceCapability {
    commands::capability()
}

fn start_backend(
    backend: Backend,
    tx: mpsc::Sender<RawAudioChunk>,
    on_error: AudioErrorCallback,
) -> Result<SystemAudioInputHandle> {
    let capture = CaptureCommand::for_backend(backend);
    let Some(program_path) = commands::command_path_in_path(capture.program()) else {
        return Err(anyhow!("{} is not available in PATH", capture.program()));
    };

    start_capture_process(capture, program_path, tx, on_error)
}

#[cfg(test)]
fn start_backend_with_path(
    backend: Backend,
    path: Option<&OsString>,
    tx: mpsc::Sender<RawAudioChunk>,
    on_error: AudioErrorCallback,
) -> Result<SystemAudioInputHandle> {
    let capture = CaptureCommand::for_backend(backend);
    let Some(program_path) = commands::command_path_with_path(capture.program(), path) else {
        return Err(anyhow!("{} is not available in PATH", capture.program()));
    };

    start_capture_process(capture, program_path, tx, on_error)
}

fn start_capture_process(
    capture: CaptureCommand,
    program_path: PathBuf,
    tx: mpsc::Sender<RawAudioChunk>,
    on_error: AudioErrorCallback,
) -> Result<SystemAudioInputHandle> {
    let mut child = spawn_capture_process(capture.clone(), program_path)?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("{} did not expose stdout", capture.program()))?;
    thread::sleep(Duration::from_millis(100));
    if let Some(status) = child.try_wait().context("check capture process status")? {
        return Err(anyhow!("{} exited early with {status}", capture.program()));
    }

    let child = Arc::new(Mutex::new(child));
    let stop_requested = Arc::new(AtomicBool::new(false));
    let stop_requested_for_reader = Arc::clone(&stop_requested);
    let reader = thread::Builder::new()
        .name(format!("relay-system-audio-{}", capture.program()))
        .spawn(move || read_capture_stdout(stdout, tx, on_error, stop_requested_for_reader))
        .context("spawn system audio reader thread")?;

    Ok(SystemAudioInputHandle {
        child,
        reader: Some(reader),
        stop_requested,
        detail: capture.detail(),
    })
}

fn spawn_capture_process(capture: CaptureCommand, program_path: PathBuf) -> Result<Child> {
    for attempt in 1..=CAPTURE_SPAWN_ATTEMPTS {
        let mut command = capture.command(program_path.clone());
        match command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => return Ok(child),
            Err(error)
                if error.raw_os_error() == Some(TEXT_FILE_BUSY_ERROR)
                    && attempt < CAPTURE_SPAWN_ATTEMPTS =>
            {
                thread::sleep(CAPTURE_SPAWN_RETRY_DELAY);
            }
            Err(error) => {
                return Err(error).with_context(|| format!("start {}", capture.program()))
            }
        }
    }

    unreachable!("capture spawn attempts always return before loop exits")
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    use tokio::sync::mpsc;

    use crate::domain::InputSource;

    use super::{start_backend_with_path, Backend};

    #[test]
    fn start_uses_pipewire_when_available() {
        let fake_bin = temp_dir("pipewire");
        write_fake_capture_tool(fake_bin.join("pw-record"));
        let fake_path = fake_bin.into_os_string();
        let (tx, mut rx) = mpsc::channel(4);
        let errors = Arc::new(Mutex::new(Vec::new()));
        let errors_for_callback = Arc::clone(&errors);

        let handle = start_backend_with_path(
            Backend::PipeWire,
            Some(&fake_path),
            tx,
            Arc::new(move |_, message| errors_for_callback.lock().unwrap().push(message)),
        )
        .unwrap();

        assert_eq!(handle.detail().code, "source:activePipeWire");
        let chunk = rx.blocking_recv().unwrap();
        assert_eq!(chunk.source, InputSource::SystemAudio);
        assert_eq!(chunk.sample_rate, 48_000);
        assert_eq!(chunk.samples, vec![0.0, 0.5]);
        assert!(errors.lock().unwrap().is_empty());
        drop(handle);
    }

    #[test]
    fn pulse_backend_reads_when_pipewire_would_exit_early() {
        let fake_bin = temp_dir("pulse-fallback");
        write_exiting_tool(fake_bin.join("pw-record"));
        write_fake_capture_tool(fake_bin.join("parec"));
        let fake_path = fake_bin.into_os_string();
        let (tx, mut rx) = mpsc::channel(4);

        let pipewire_error = match start_backend_with_path(
            Backend::PipeWire,
            Some(&fake_path),
            tx.clone(),
            Arc::new(|_, _| {}),
        ) {
            Ok(handle) => panic!(
                "expected PipeWire startup failure, got {}",
                handle.detail().code
            ),
            Err(error) => error,
        };
        let handle = start_backend_with_path(
            Backend::PulseAudio,
            Some(&fake_path),
            tx,
            Arc::new(|_, _| {}),
        )
        .unwrap();

        assert!(pipewire_error.to_string().contains("exited early"));
        assert_eq!(handle.detail().code, "source:activePulseAudio");
        let chunk = rx.blocking_recv().unwrap();
        assert_eq!(chunk.source, InputSource::SystemAudio);
        assert_eq!(chunk.samples, vec![0.0, 0.5]);
        drop(handle);
    }

    #[test]
    fn start_fails_when_no_linux_runtime_tool_is_available() {
        let fake_bin = temp_dir("no-tools");
        let fake_path = fake_bin.into_os_string();
        let (tx, _rx) = mpsc::channel(4);

        let error = match start_backend_with_path(
            Backend::PulseAudio,
            Some(&fake_path),
            tx,
            Arc::new(|_, _| {}),
        ) {
            Ok(handle) => panic!(
                "expected PulseAudio startup failure, got {}",
                handle.detail().code
            ),
            Err(error) => error,
        };

        assert!(error.to_string().contains("parec is not available"));
    }

    fn write_fake_capture_tool(path: PathBuf) {
        write_tool(
            path,
            r#"#!/bin/sh
printf '\000\000\200\277\000\000\200\077\000\000\200\076\000\000\100\077'
sleep 1
"#,
        );
    }

    fn write_exiting_tool(path: PathBuf) {
        write_tool(
            path,
            r#"#!/bin/sh
exit 42
"#,
        );
    }

    fn write_tool(path: PathBuf, body: &str) {
        let temp_path = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
        let mut file = fs::File::create(&temp_path).unwrap();
        file.write_all(body.as_bytes()).unwrap();
        file.sync_all().unwrap();
        drop(file);

        let mut permissions = fs::metadata(&temp_path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&temp_path, permissions).unwrap();
        fs::rename(temp_path, path).unwrap();
    }

    fn temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "relay-linux-system-audio-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
