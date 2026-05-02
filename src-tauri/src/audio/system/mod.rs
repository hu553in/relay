use std::sync::Arc;

use anyhow::Result;
use tokio::sync::mpsc;

use crate::audio::RawAudioChunk;
use crate::domain::{InputSource, SourceCapability};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod output_loopback;
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
mod unsupported;

#[cfg(target_os = "linux")]
pub(crate) use linux::SystemAudioInputHandle;
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) use output_loopback::SystemAudioInputHandle;
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub(crate) use unsupported::SystemAudioInputHandle;

pub(crate) type AudioErrorCallback = Arc<dyn Fn(InputSource, String) + Send + Sync>;

pub(crate) fn capability() -> SourceCapability {
    backend_capability()
}

#[cfg(target_os = "linux")]
fn backend_capability() -> SourceCapability {
    linux::capability()
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn backend_capability() -> SourceCapability {
    output_loopback::capability()
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn backend_capability() -> SourceCapability {
    unsupported::capability()
}

pub(crate) trait SystemAudioBackend: Sized {
    fn start(tx: mpsc::Sender<RawAudioChunk>, on_error: AudioErrorCallback) -> Result<Self>;
    fn detail(&self) -> &'static str;
}
