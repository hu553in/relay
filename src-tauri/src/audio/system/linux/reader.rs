use std::io::Read;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tokio::sync::mpsc;

use crate::audio::{fold_to_mono, RawAudioChunk};
use crate::domain::InputSource;

use super::super::AudioErrorCallback;

const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: usize = 2;
const READ_FRAMES: usize = 2_400;
const READ_BYTES: usize = READ_FRAMES * CHANNELS * std::mem::size_of::<f32>();

pub(super) type StopFlag = Arc<AtomicBool>;

pub(super) fn read_capture_stdout(
    mut stdout: impl Read,
    tx: mpsc::Sender<RawAudioChunk>,
    on_error: AudioErrorCallback,
    stop_requested: StopFlag,
) {
    let mut buffer = vec![0_u8; READ_BYTES];
    let mut pending = Vec::new();

    loop {
        match stdout.read(&mut buffer) {
            Ok(0) => {
                if !stop_requested.load(Ordering::Acquire) {
                    on_error(
                        InputSource::SystemAudio,
                        "System audio capture stopped unexpectedly".to_string(),
                    );
                }
                break;
            }
            Ok(read) => {
                pending.extend_from_slice(&buffer[..read]);
                let complete_len = pending.len() - (pending.len() % std::mem::size_of::<f32>());
                if complete_len == 0 {
                    continue;
                }

                let samples = f32le_bytes_to_mono(&pending[..complete_len], CHANNELS);
                pending.drain(..complete_len);
                if samples.is_empty() {
                    continue;
                }

                let chunk = RawAudioChunk {
                    source: InputSource::SystemAudio,
                    captured_at_ms: crate::now_ms(),
                    sample_rate: SAMPLE_RATE,
                    samples,
                };
                let _ = tx.blocking_send(chunk);
            }
            Err(error) => {
                on_error(
                    InputSource::SystemAudio,
                    format!("System audio reader failed: {error}"),
                );
                break;
            }
        }
    }
}

fn f32le_bytes_to_mono(bytes: &[u8], channels: usize) -> Vec<f32> {
    let samples = bytes
        .chunks_exact(std::mem::size_of::<f32>())
        .map(|chunk| f32::from_le_bytes(chunk.try_into().expect("chunk is always four bytes")))
        .collect::<Vec<_>>();
    fold_to_mono(&samples, channels, |sample| sample)
}

#[cfg(test)]
mod tests {
    use std::io::{self, Cursor, Read};
    use std::sync::{atomic::AtomicBool, Arc, Mutex};

    use tokio::sync::mpsc;

    use crate::domain::InputSource;

    use super::{f32le_bytes_to_mono, read_capture_stdout, SAMPLE_RATE};

    #[test]
    fn f32le_stereo_bytes_are_folded_to_mono() {
        let samples = [-1.0_f32, 1.0, 0.25, 0.75];
        let bytes = samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect::<Vec<_>>();

        assert_eq!(f32le_bytes_to_mono(&bytes, 2), vec![0.0, 0.5]);
    }

    #[test]
    fn incomplete_sample_bytes_are_ignored() {
        let mut bytes = 1.0_f32.to_le_bytes().to_vec();
        bytes.extend_from_slice(&[0, 1, 2]);

        assert_eq!(f32le_bytes_to_mono(&bytes, 1), vec![1.0]);
    }

    #[test]
    fn reader_emits_chunk_then_reports_unexpected_eof() {
        let samples = [-1.0_f32, 1.0, 0.25, 0.75];
        let bytes = samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect::<Vec<_>>();
        let (tx, mut rx) = mpsc::channel(4);
        let errors = Arc::new(Mutex::new(Vec::new()));
        let errors_for_callback = Arc::clone(&errors);

        read_capture_stdout(
            Cursor::new(bytes),
            tx,
            Arc::new(move |_, message| errors_for_callback.lock().unwrap().push(message)),
            Arc::new(AtomicBool::new(false)),
        );

        let chunk = rx.blocking_recv().unwrap();
        assert_eq!(chunk.source, InputSource::SystemAudio);
        assert_eq!(chunk.sample_rate, SAMPLE_RATE);
        assert_eq!(chunk.samples, vec![0.0, 0.5]);
        assert!(rx.try_recv().is_err());
        assert_eq!(
            errors.lock().unwrap().as_slice(),
            ["System audio capture stopped unexpectedly"]
        );
    }

    #[test]
    fn reader_reports_read_errors() {
        let (tx, _rx) = mpsc::channel(4);
        let errors = Arc::new(Mutex::new(Vec::new()));
        let errors_for_callback = Arc::clone(&errors);

        read_capture_stdout(
            FailingReader,
            tx,
            Arc::new(move |source, message| {
                errors_for_callback.lock().unwrap().push((source, message));
            }),
            Arc::new(AtomicBool::new(false)),
        );

        let errors = errors.lock().unwrap();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].0, InputSource::SystemAudio);
        assert!(errors[0].1.contains("reader failed"));
    }

    #[test]
    fn reader_ignores_eof_after_shutdown_is_requested() {
        let (tx, _rx) = mpsc::channel(4);
        let errors = Arc::new(Mutex::new(Vec::new()));
        let errors_for_callback = Arc::clone(&errors);

        read_capture_stdout(
            Cursor::new(Vec::new()),
            tx,
            Arc::new(move |_, message| errors_for_callback.lock().unwrap().push(message)),
            Arc::new(AtomicBool::new(true)),
        );

        assert!(errors.lock().unwrap().is_empty());
    }

    struct FailingReader;

    impl Read for FailingReader {
        fn read(&mut self, _buf: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::other("boom"))
        }
    }
}
