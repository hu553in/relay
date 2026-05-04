use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig, SupportedStreamConfig};
use tokio::sync::mpsc;

use crate::domain::{InputSource, SourceCapability, UserMessage};

mod system;

pub(crate) use system::SystemAudioInputHandle;

#[derive(Debug, Clone)]
pub(crate) struct RawAudioChunk {
    pub(crate) source: InputSource,
    pub(crate) captured_at_ms: u64,
    pub(crate) sample_rate: u32,
    pub(crate) samples: Vec<f32>,
}

pub(crate) struct MicrophoneInputHandle {
    _stream: Stream,
}

impl MicrophoneInputHandle {
    pub(crate) fn start(
        tx: mpsc::Sender<RawAudioChunk>,
        on_error: Arc<dyn Fn(InputSource, UserMessage) + Send + Sync>,
    ) -> Result<Self> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| anyhow!("No input device is available"))?;
        let config = device
            .default_input_config()
            .context("read default microphone config")?;
        let stream = build_stream(InputSource::Microphone, device, config, tx, on_error)?;
        stream.play().context("start microphone stream")?;
        Ok(Self { _stream: stream })
    }
}

pub(crate) fn microphone_capability() -> SourceCapability {
    let host = cpal::default_host();
    let Some(device) = host.default_input_device() else {
        return SourceCapability::unavailable(UserMessage::new("source:microphoneUnavailable"));
    };

    match device.default_input_config() {
        Ok(_) => SourceCapability::available(UserMessage::new("source:readyDefaultInputDevice")),
        Err(error) => SourceCapability::unavailable(
            UserMessage::new("source:defaultInputDeviceUnavailable").param("error", error),
        ),
    }
}

pub(crate) fn system_audio_capability() -> SourceCapability {
    system::capability()
}

pub(super) fn build_stream(
    source: InputSource,
    device: Device,
    config: SupportedStreamConfig,
    tx: mpsc::Sender<RawAudioChunk>,
    on_error: Arc<dyn Fn(InputSource, UserMessage) + Send + Sync>,
) -> Result<Stream> {
    let channels = config.channels() as usize;
    let sample_rate = config.sample_rate();
    let source_label = match source {
        InputSource::Microphone => "Microphone",
        InputSource::SystemAudio => "System audio",
    };
    let error_code = match source {
        InputSource::Microphone => "diagnostics:microphoneStreamFailed",
        InputSource::SystemAudio => "diagnostics:systemAudioStreamFailed",
    };
    let stream_config: StreamConfig = config.clone().into();
    // Each branch is structurally identical: capture samples → fold to mono
    // f32 → push into the bounded channel. The duplication is collapsed with a
    // macro because cpal's `build_input_stream` is generic over the sample type
    // and cannot be easily abstracted into a helper without trait juggling.
    // Cross-platform: ALSA on Linux commonly delivers I32 even when
    // WASAPI/CoreAudio settle on F32 — refusing I32 here would silently kill
    // mic capture on Linux.
    macro_rules! build_stream_arm {
        ($ty:ident, $conv:expr) => {{
            let tx = tx.clone();
            let on_error = on_error.clone();
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[$ty], _| {
                        let chunk = RawAudioChunk {
                            source,
                            captured_at_ms: crate::now_ms(),
                            sample_rate,
                            samples: fold_to_mono(data, channels, $conv),
                        };
                        let _ = tx.try_send(chunk);
                    },
                    move |error| {
                        on_error(source, UserMessage::new(error_code).param("error", error))
                    },
                    None,
                )
                .with_context(|| format!("build {} {source_label} stream", stringify!($ty)))
        }};
    }

    match config.sample_format() {
        SampleFormat::F32 => build_stream_arm!(f32, |s| s),
        SampleFormat::F64 => build_stream_arm!(f64, |s| s as f32),
        SampleFormat::I32 => build_stream_arm!(i32, |s| s as f32 / i32::MAX as f32),
        SampleFormat::I16 => build_stream_arm!(i16, |s| s as f32 / i16::MAX as f32),
        SampleFormat::I8 => build_stream_arm!(i8, |s| s as f32 / i8::MAX as f32),
        SampleFormat::U16 => {
            build_stream_arm!(u16, |s| (s as f32 / u16::MAX as f32) * 2.0 - 1.0)
        }
        SampleFormat::U8 => {
            build_stream_arm!(u8, |s| (s as f32 / u8::MAX as f32) * 2.0 - 1.0)
        }
        format => {
            // `tx` and `on_error` are captured in every other arm via clone;
            // here they fall out of scope unused — fine, no warning.
            let _ = (&tx, &on_error);
            Err(anyhow!(
                "Unsupported {source_label} sample format: {format:?}"
            ))
        }
    }
}

/// Generic mono fold. `convert` normalizes one sample (any cpal type) to f32
/// in `[-1.0, 1.0]`. Two important invariants:
///
///   * `channels == 0` would be a configuration bug from cpal; we treat it
///     as "interleaving unknown, return empty" rather than panicking on
///     `chunks(0)` or dividing by zero.
///   * The trailing partial frame from `data.chunks(channels)` is averaged
///     by its actual length, not `channels`, so a truncated tail does not
///     bias toward zero.
pub(super) fn fold_to_mono<T: Copy>(
    data: &[T],
    channels: usize,
    convert: impl Fn(T) -> f32,
) -> Vec<f32> {
    if channels == 0 {
        return Vec::new();
    }
    if channels == 1 {
        return data.iter().copied().map(convert).collect();
    }
    data.chunks(channels)
        .map(|frame| {
            let sum: f32 = frame.iter().copied().map(&convert).sum();
            sum / frame.len() as f32
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::fold_to_mono;

    #[test]
    fn mono_input_is_passed_through_with_conversion() {
        let data: [i16; 4] = [0, i16::MAX, -i16::MAX, i16::MAX / 2];
        let folded = fold_to_mono(&data, 1, |s| s as f32 / i16::MAX as f32);
        assert_eq!(folded.len(), 4);
        assert!((folded[0] - 0.0).abs() < 1e-6);
        assert!((folded[1] - 1.0).abs() < 1e-6);
        assert!((folded[2] - -1.0).abs() < 1e-6);
        assert!((folded[3] - 0.5).abs() < 1e-3);
    }

    #[test]
    fn stereo_frames_average_to_mono() {
        // Two frames: [-1.0, 1.0] -> 0.0, and [0.5, 0.5] -> 0.5.
        let data = [-1.0_f32, 1.0, 0.5, 0.5];
        let folded = fold_to_mono(&data, 2, |s| s);
        assert_eq!(folded, vec![0.0, 0.5]);
    }

    /// Trailing partial frame must average by its actual length, not by the
    /// nominal channel count. Otherwise truncated tails skew silent on every
    /// callback boundary that doesn't divide evenly.
    #[test]
    fn trailing_partial_frame_uses_its_own_length() {
        let data = [1.0_f32, 1.0, 1.0]; // channels=2, last frame has only 1 sample
        let folded = fold_to_mono(&data, 2, |s| s);
        assert_eq!(folded, vec![1.0, 1.0]);
    }

    /// `channels == 0` is a defensive guard against a misconfigured cpal
    /// stream; we must not panic with `chunks(0)` or divide by zero.
    #[test]
    fn zero_channels_returns_empty_without_panicking() {
        let data = [1.0_f32, 2.0, 3.0];
        let folded = fold_to_mono(&data, 0, |s| s);
        assert!(folded.is_empty());
    }
}
