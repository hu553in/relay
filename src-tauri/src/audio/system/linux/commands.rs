use std::env;
use std::ffi::OsString;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::domain::SourceCapability;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Backend {
    PipeWire,
    PulseAudio,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct CaptureCommand {
    program: &'static str,
    args: &'static [&'static str],
    detail: &'static str,
}

impl CaptureCommand {
    pub(super) fn for_backend(backend: Backend) -> Self {
        match backend {
            Backend::PipeWire => Self {
                program: "pw-record",
                args: &[
                    "--raw",
                    "--format",
                    "f32",
                    "--rate",
                    "48000",
                    "--channels",
                    "2",
                    "-P",
                    "{ stream.capture.sink=true }",
                    "-",
                ],
                detail: "Active through PipeWire sink capture",
            },
            Backend::PulseAudio => Self {
                program: "parec",
                args: &[
                    "--raw",
                    "--format",
                    "float32le",
                    "--rate",
                    "48000",
                    "--channels",
                    "2",
                    "--device",
                    "@DEFAULT_MONITOR@",
                ],
                detail: "Active through PulseAudio default monitor",
            },
        }
    }

    pub(super) fn program(&self) -> &'static str {
        self.program
    }

    pub(super) fn detail(&self) -> &'static str {
        self.detail
    }

    pub(super) fn command(&self, program_path: PathBuf) -> Command {
        let mut command = Command::new(program_path);
        command.args(self.args);
        command
    }

    #[cfg(test)]
    fn args(&self) -> &'static [&'static str] {
        self.args
    }
}

pub(super) fn capability() -> SourceCapability {
    capability_for_path(env::var_os("PATH"))
}

fn capability_for_path(path: Option<OsString>) -> SourceCapability {
    let has_pipewire = command_path_with_path("pw-record", path.as_ref()).is_some();
    let has_pulse = command_path_with_path("parec", path.as_ref()).is_some();
    match (has_pipewire, has_pulse) {
        (true, true) => SourceCapability::available(
            "Ready to capture system audio through PipeWire, with PulseAudio monitor fallback",
        ),
        (true, false) => SourceCapability::available(
            "Ready to capture system audio through PipeWire sink capture",
        ),
        (false, true) => SourceCapability::available(
            "Ready to capture system audio through the PulseAudio default monitor",
        ),
        (false, false) => SourceCapability::unavailable(
            "Install an executable pw-record or parec runtime tool to capture system audio",
        ),
    }
}

pub(super) fn command_path_in_path(command: &str) -> Option<PathBuf> {
    command_path_with_path(command, env::var_os("PATH").as_ref())
}

pub(super) fn command_path_with_path(command: &str, path: Option<&OsString>) -> Option<PathBuf> {
    path.into_iter()
        .flat_map(env::split_paths)
        .filter(|entry| !entry.as_os_str().is_empty())
        .map(|entry| entry.join(command))
        .find(|candidate| is_executable_file(candidate))
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    use super::{capability_for_path, command_path_with_path, Backend, CaptureCommand};

    #[test]
    fn pipewire_command_uses_raw_sink_capture_stdout() {
        let command = CaptureCommand::for_backend(Backend::PipeWire);

        assert_eq!(command.program(), "pw-record");
        assert_eq!(
            command.args(),
            &[
                "--raw",
                "--format",
                "f32",
                "--rate",
                "48000",
                "--channels",
                "2",
                "-P",
                "{ stream.capture.sink=true }",
                "-"
            ]
        );
    }

    #[test]
    fn pulse_command_uses_default_monitor_raw_float_stream() {
        let command = CaptureCommand::for_backend(Backend::PulseAudio);

        assert_eq!(command.program(), "parec");
        assert_eq!(
            command.args(),
            &[
                "--raw",
                "--format",
                "float32le",
                "--rate",
                "48000",
                "--channels",
                "2",
                "--device",
                "@DEFAULT_MONITOR@"
            ]
        );
    }

    #[test]
    fn capability_reports_available_when_pipewire_tool_exists() {
        let temp = temp_dir("pipewire-only");
        write_executable(temp.join("pw-record"));

        let capability = capability_for_path(Some(temp.into_os_string()));

        assert!(capability.available);
        assert!(capability.detail.contains("PipeWire"));
    }

    #[test]
    fn capability_reports_pulse_fallback_when_only_pulse_tool_exists() {
        let temp = temp_dir("pulse-only");
        write_executable(temp.join("parec"));

        let capability = capability_for_path(Some(temp.into_os_string()));

        assert!(capability.available);
        assert!(capability.detail.contains("PulseAudio"));
    }

    #[test]
    fn capability_reports_unavailable_without_runtime_tools() {
        let temp = temp_dir("empty");

        let capability = capability_for_path(Some(temp.into_os_string()));

        assert!(!capability.available);
        assert!(capability.detail.contains("pw-record"));
    }

    #[test]
    fn command_lookup_ignores_non_executable_files() {
        let temp = temp_dir("non-executable");
        fs::write(temp.join("pw-record"), "").unwrap();

        let command_path = command_path_with_path("pw-record", Some(&temp.into_os_string()));

        assert!(command_path.is_none());
    }

    fn write_executable(path: impl AsRef<Path>) {
        fs::write(path.as_ref(), "").unwrap();
        let mut permissions = fs::metadata(path.as_ref()).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).unwrap();
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "relay-audio-commands-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
