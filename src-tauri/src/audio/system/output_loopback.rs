use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Stream;
use tokio::sync::mpsc;

use crate::audio::{build_stream, RawAudioChunk};
use crate::domain::{InputSource, SourceCapability, UserMessage};

use super::{AudioErrorCallback, SystemAudioBackend};

pub(crate) struct SystemAudioInputHandle {
    _stream: Stream,
}

impl SystemAudioBackend for SystemAudioInputHandle {
    fn start(tx: mpsc::Sender<RawAudioChunk>, on_error: AudioErrorCallback) -> Result<Self> {
        let host = cpal::default_host();
        let device = host.default_output_device().ok_or_else(|| {
            anyhow!("No default output device is available for system audio loopback")
        })?;
        let config = device
            .default_output_config()
            .context("read default system output config")?;
        let stream = build_stream(InputSource::SystemAudio, device, config, tx, on_error)?;
        stream
            .play()
            .context("start system audio loopback stream")?;
        Ok(Self { _stream: stream })
    }

    fn detail(&self) -> UserMessage {
        UserMessage::new("source:activeDefaultOutputLoopback")
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

pub(crate) fn capability() -> SourceCapability {
    let host = cpal::default_host();
    let Some(device) = host.default_output_device() else {
        return SourceCapability::unavailable(UserMessage::new("source:systemAudioNeedsLoopback"));
    };

    match device.default_output_config() {
        Ok(_) => SourceCapability::available(UserMessage::new("source:readyDefaultOutputLoopback")),
        Err(error) => SourceCapability::unavailable(
            UserMessage::new("source:defaultOutputDeviceUnavailable").param("error", error),
        ),
    }
}
