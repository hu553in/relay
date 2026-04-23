use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig, SupportedStreamConfig};
use tokio::sync::mpsc;

use crate::domain::InputSource;

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

pub(crate) struct SystemAudioInputHandle {
    _stream: Stream,
}

impl MicrophoneInputHandle {
    pub(crate) fn start(
        tx: mpsc::Sender<RawAudioChunk>,
        on_error: Arc<dyn Fn(InputSource, String) + Send + Sync>,
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

impl SystemAudioInputHandle {
    pub(crate) fn start(
        tx: mpsc::Sender<RawAudioChunk>,
        on_error: Arc<dyn Fn(InputSource, String) + Send + Sync>,
    ) -> Result<Self> {
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
}

pub(crate) fn system_audio_unavailable_detail() -> String {
    "System audio capture needs loopback support on the default output device. Relay degrades to microphone-only when that path is unavailable."
        .to_string()
}

fn build_stream(
    source: InputSource,
    device: Device,
    config: SupportedStreamConfig,
    tx: mpsc::Sender<RawAudioChunk>,
    on_error: Arc<dyn Fn(InputSource, String) + Send + Sync>,
) -> Result<Stream> {
    let channels = config.channels() as usize;
    let sample_rate = config.sample_rate();
    let source_label = match source {
        InputSource::Microphone => "Microphone",
        InputSource::SystemAudio => "System audio",
    };
    let error_handler = on_error.clone();
    let err_handler = move |error| {
        error_handler(source, format!("{source_label} stream failed: {error}"));
    };

    let stream_config: StreamConfig = config.clone().into();
    match config.sample_format() {
        SampleFormat::F32 => device
            .build_input_stream(
                &stream_config,
                move |data: &[f32], _| {
                    let chunk = RawAudioChunk {
                        source,
                        captured_at_ms: now_ms(),
                        sample_rate,
                        samples: fold_to_mono_f32(data, channels),
                    };
                    let _ = tx.try_send(chunk);
                },
                err_handler,
                None,
            )
            .with_context(|| format!("build f32 {source_label} stream")),
        SampleFormat::I16 => {
            let tx = tx.clone();
            let on_error = on_error.clone();
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[i16], _| {
                        let chunk = RawAudioChunk {
                            source,
                            captured_at_ms: now_ms(),
                            sample_rate,
                            samples: fold_to_mono_i16(data, channels),
                        };
                        let _ = tx.try_send(chunk);
                    },
                    move |error| on_error(source, format!("{source_label} stream failed: {error}")),
                    None,
                )
                .with_context(|| format!("build i16 {source_label} stream"))
        }
        SampleFormat::U16 => {
            let tx = tx.clone();
            let on_error = on_error.clone();
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[u16], _| {
                        let chunk = RawAudioChunk {
                            source,
                            captured_at_ms: now_ms(),
                            sample_rate,
                            samples: fold_to_mono_u16(data, channels),
                        };
                        let _ = tx.try_send(chunk);
                    },
                    move |error| on_error(source, format!("{source_label} stream failed: {error}")),
                    None,
                )
                .with_context(|| format!("build u16 {source_label} stream"))
        }
        format => Err(anyhow!(
            "Unsupported {source_label} sample format: {format:?}"
        )),
    }
}

fn fold_to_mono_f32(data: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return data.to_vec();
    }

    data.chunks(channels)
        .map(|frame| frame.iter().copied().sum::<f32>() / frame.len() as f32)
        .collect()
}

fn fold_to_mono_i16(data: &[i16], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return data
            .iter()
            .map(|sample| *sample as f32 / i16::MAX as f32)
            .collect();
    }

    data.chunks(channels)
        .map(|frame| {
            let sum = frame
                .iter()
                .map(|sample| *sample as f32 / i16::MAX as f32)
                .sum::<f32>();
            sum / frame.len() as f32
        })
        .collect()
}

fn fold_to_mono_u16(data: &[u16], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return data
            .iter()
            .map(|sample| (*sample as f32 / u16::MAX as f32) * 2.0 - 1.0)
            .collect();
    }

    data.chunks(channels)
        .map(|frame| {
            let sum = frame
                .iter()
                .map(|sample| (*sample as f32 / u16::MAX as f32) * 2.0 - 1.0)
                .sum::<f32>();
            sum / frame.len() as f32
        })
        .collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}
