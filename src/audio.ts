import { logError, logWarn } from './shared/log';
import type { StartCaptureRequest } from './shared/types';

type StopCapture = () => void;
type FloatSamples = Float32Array;

const TARGET_SAMPLE_RATE = 24_000;
const SEND_FRAME_SAMPLES = 4_800;

export async function startAudioCapture(request: StartCaptureRequest): Promise<StopCapture> {
  const streams: MediaStream[] = [];
  let context: AudioContext | null = null;

  try {
    if (request.microphone) {
      try {
        streams.push(
          await navigator.mediaDevices.getUserMedia({
            audio: {
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
            },
          })
        );
      } catch (reason) {
        logError('Failed to capture microphone audio.', reason);
        throw reason;
      }
    }

    if (request.systemAudio) {
      let displayStream: MediaStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
      } catch (reason) {
        logError('Failed to capture system audio.', reason);
        throw new Error(systemAudioErrorMessage(reason), { cause: reason });
      }
      stopTracks(displayStream.getVideoTracks());
      if (displayStream.getAudioTracks().length === 0) {
        stopTracks(displayStream.getTracks());
        logError('System audio capture returned no audio tracks.');
        throw new Error(
          'System audio stream started without an audio track. Check macOS audio capture permission, and use a packaged app on macOS 14.2+ if dev mode still returns video-only capture.'
        );
      }
      streams.push(displayStream);
    }

    if (streams.length === 0) {
      throw new Error('No audio tracks were captured.');
    }

    const audioContext = new AudioContext();
    context = audioContext;
    const mixer = audioContext.createGain();
    mixer.gain.value = 1 / Math.max(1, streams.length);
    const sources = streams.map(stream => audioContext.createMediaStreamSource(stream));
    sources.forEach(source => source.connect(mixer));

    const workletUrl = URL.createObjectURL(
      new Blob(
        [
          `
class RelayCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || input[0].length === 0) {
      return true;
    }
    const frames = input[0].length;
    const mono = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
      let sum = 0;
      for (let channel = 0; channel < input.length; channel += 1) {
        sum += input[channel][frame] || 0;
      }
      mono[frame] = sum / input.length;
    }
    this.port.postMessage(mono, [mono.buffer]);
    return true;
  }
}
registerProcessor('relay-capture-processor', RelayCaptureProcessor);
`,
        ],
        { type: 'text/javascript' }
      )
    );
    try {
      await audioContext.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }

    const captureNode = new AudioWorkletNode(audioContext, 'relay-capture-processor');
    let pending: FloatSamples = new Float32Array(0);
    let frameProcessingErrorLogged = false;

    captureNode.port.onmessage = (event: MessageEvent<FloatSamples>) => {
      try {
        const resampled = resampleToTarget(event.data, audioContext.sampleRate, TARGET_SAMPLE_RATE);
        pending = concatFloat32(pending, resampled);
        while (pending.length >= SEND_FRAME_SAMPLES) {
          const frame = pending.slice(0, SEND_FRAME_SAMPLES);
          pending = pending.slice(SEND_FRAME_SAMPLES);
          const pcm16Base64 = pcm16ToBase64(frame);
          window.relay.sendAudioChunk({ pcm16Base64 });
        }
      } catch (reason) {
        if (!frameProcessingErrorLogged) {
          frameProcessingErrorLogged = true;
          logError(
            'Failed to process audio capture frame; suppressing repeated frame errors for this capture.',
            reason
          );
        }
      }
    };

    const silentSink = audioContext.createGain();
    silentSink.gain.value = 0;
    mixer.connect(captureNode);
    captureNode.connect(silentSink);
    silentSink.connect(audioContext.destination);
    captureNode.port.start();

    return () => {
      captureNode.port.onmessage = null;
      try {
        captureNode.disconnect();
        silentSink.disconnect();
        mixer.disconnect();
        sources.forEach(source => {
          source.disconnect();
        });
      } catch (reason) {
        logWarn('Failed to disconnect audio capture graph cleanly.', reason);
      }
      stopStreams(streams);
      audioContext.close().catch((reason: unknown) => {
        logWarn('Failed to close audio context.', reason);
      });
    };
  } catch (error) {
    logError('Audio capture startup failed.', error);
    stopStreams(streams);
    if (context) {
      context.close().catch((reason: unknown) => {
        logWarn('Failed to close audio context after startup failure.', reason);
      });
    }
    throw error;
  }
}

function stopStreams(streams: MediaStream[]): void {
  streams.forEach(stream => {
    stopTracks(stream.getTracks());
  });
}

function stopTracks(tracks: MediaStreamTrack[]): void {
  tracks.forEach(track => {
    try {
      track.stop();
    } catch (reason) {
      logWarn('Failed to stop media track.', { kind: track.kind, reason });
    }
  });
}

function systemAudioErrorMessage(reason: unknown): string {
  if (isUnsupportedSystemAudioError(reason)) {
    return 'System audio capture is not supported in this runtime. Use a packaged app with audio capture permission.';
  }

  return errorMessage(reason);
}

function isUnsupportedSystemAudioError(reason: unknown): boolean {
  return errorName(reason) === 'NotSupportedError' || errorMessage(reason) === 'Not supported';
}

function errorName(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'name' in reason) {
    const name = reason.name;
    return typeof name === 'string' ? name : '';
  }

  return '';
}

function errorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason) {
    const message = reason.message;
    return typeof message === 'string' ? message : 'Unknown error';
  }

  if (
    typeof reason === 'string' ||
    typeof reason === 'number' ||
    typeof reason === 'boolean' ||
    typeof reason === 'bigint'
  ) {
    return String(reason);
  }

  return 'Unknown error';
}

function resampleToTarget(
  input: FloatSamples,
  sourceRate: number,
  targetRate: number
): FloatSamples {
  if (sourceRate === targetRate) {
    return input;
  }
  const ratio = sourceRate / targetRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio;
    const index = Math.floor(sourceIndex);
    const next = Math.min(index + 1, input.length - 1);
    const fraction = sourceIndex - index;
    const currentSample = input[index] ?? 0;
    const nextSample = input[next] ?? currentSample;
    output[i] = currentSample * (1 - fraction) + nextSample * fraction;
  }
  return output;
}

function concatFloat32(left: FloatSamples, right: FloatSamples): FloatSamples {
  if (left.length === 0) {
    return right;
  }
  const out = new Float32Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

function pcm16ToBase64(float32: FloatSamples): string {
  const bytes = new Uint8Array(float32.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < float32.length; i += 1) {
    const value = Math.max(-1, Math.min(1, float32[i] ?? 0));
    view.setInt16(i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
