use anyhow::{bail, Result};
use tokio::sync::mpsc;

use crate::audio::RawAudioChunk;
use crate::domain::{InputSource, SourceCapability};

use super::{AudioErrorCallback, SystemAudioBackend};

pub(crate) struct SystemAudioInputHandle;

impl SystemAudioBackend for SystemAudioInputHandle {
    fn start(_tx: mpsc::Sender<RawAudioChunk>, _on_error: AudioErrorCallback) -> Result<Self> {
        bail!("System audio capture is not implemented on this platform")
    }

    fn detail(&self) -> &'static str {
        "System audio capture is not implemented on this platform"
    }
}

impl SystemAudioInputHandle {
    pub(crate) fn start(
        tx: mpsc::Sender<RawAudioChunk>,
        on_error: AudioErrorCallback,
    ) -> Result<Self> {
        <Self as SystemAudioBackend>::start(tx, on_error)
    }

    pub(crate) fn detail(&self) -> &'static str {
        <Self as SystemAudioBackend>::detail(self)
    }
}

pub(crate) fn capability() -> SourceCapability {
    SourceCapability::unavailable("System audio capture is not implemented on this platform")
}
