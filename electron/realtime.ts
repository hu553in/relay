import { randomUUID } from 'node:crypto';

import WebSocket, { type RawData } from 'ws';

import { logError, logWarn } from '@/shared/log';
import type { CaptionEntry } from '@/shared/types';

type RealtimeClientEvent = Record<string, unknown>;
type RealtimeServerEvent = Record<string, unknown>;

const CAPTION_SILENCE_BREAK_MS = 3_500;
const GRACEFUL_CLOSE_TIMEOUT_MS = 1_000;
const REALTIME_OPEN_TIMEOUT_MS = 15_000;
const REALTIME_MODEL = 'gpt-realtime-translate';
const REALTIME_URL = 'wss://api.openai.com/v1/realtime/translations';
const INPUT_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper';

interface RealtimeSessionOptions {
  settings: {
    originalLanguage: string;
    translationLanguage: string;
  };
  apiKey: string;
  onStatus: (status: 'connecting' | 'listening') => void;
  onCaption: (caption: CaptionEntry) => void;
  onError: (error: string) => void;
}

export class RealtimeTranslationSession {
  private ws: WebSocket | null = null;
  private activeCaption: CaptionEntry | null = null;
  private closeTimeout: ReturnType<typeof setTimeout> | null = null;
  private closing = false;
  private lastDeltaAt = 0;
  private shouldReportClose = false;

  constructor(private readonly options: RealtimeSessionOptions) {}

  async start(): Promise<void> {
    this.emitStatus('connecting');
    const wsUrl = buildRealtimeUrl();

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
        },
      });
      this.ws = ws;
      this.shouldReportClose = true;
      let opened = false;
      let openFailed = false;
      let openTimeout: ReturnType<typeof setTimeout> | null = null;
      const clearOpenTimeout = () => {
        if (openTimeout) {
          clearTimeout(openTimeout);
          openTimeout = null;
        }
      };

      const fail = (error: Error) => {
        if (openFailed) {
          return;
        }
        openFailed = true;
        clearOpenTimeout();
        this.shouldReportClose = false;
        logError('Realtime WebSocket failed before opening.', error);
        reject(error);
      };
      openTimeout = setTimeout(() => {
        fail(new Error('Realtime connection timed out.'));
        closeWebSocket(ws);
      }, REALTIME_OPEN_TIMEOUT_MS);

      ws.once('open', () => {
        try {
          opened = true;
          ws.off('error', fail);
          clearOpenTimeout();
          this.configureSession();
          this.emitStatus('listening');
          resolve();
        } catch (reason) {
          logError('Failed to initialize Realtime session after WebSocket open.', reason);
          this.shouldReportClose = false;
          closeWebSocket(ws);
          reject(errorFromUnknown('Failed to initialize Realtime session.', reason));
        }
      });
      ws.once('error', fail);
      ws.on('message', data => {
        try {
          this.handleMessage(rawDataToString(data));
        } catch (reason) {
          logError('Failed to handle Realtime message.', reason);
          this.emitError('Failed to process Realtime event.');
        }
      });
      ws.on('close', (code, reason) => {
        const closeReason = reason.toString();
        const message = closeReason
          ? `Realtime connection closed (${String(code)}): ${closeReason}`
          : `Realtime connection closed (${String(code)}).`;
        if (!opened) {
          if (!openFailed) {
            logWarn('Realtime WebSocket closed before opening.', {
              code,
              reason: closeReason,
            });
          }
          this.finishClose(ws);
          fail(new Error(message));
          return;
        }

        const shouldReportClose = this.shouldReportClose;
        if (this.ws === ws) {
          this.finishClose(ws);
        }
        if (shouldReportClose) {
          logWarn('Realtime WebSocket closed unexpectedly.', { code, reason: closeReason });
          this.emitError(message);
        }
      });
      ws.on('error', error => {
        if (this.shouldReportClose) {
          this.shouldReportClose = false;
          logError('Realtime WebSocket error.', error);
          this.emitError(error.message);
        }
      });
    });
  }

  stop(): void {
    const ws = this.ws;
    this.shouldReportClose = false;
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      this.finishClose(ws);
      return;
    }

    this.closing = true;
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'session.close' }));
      } catch (reason) {
        logWarn('Failed to send Realtime session close event.', reason);
        closeWebSocket(ws);
      }
      this.scheduleCloseTimeout(ws);
      return;
    }
    closeWebSocket(ws);
  }

  appendAudio(pcm16Base64: string): void {
    if (this.closing || !pcm16Base64 || this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.send({
      type: 'session.input_audio_buffer.append',
      audio: pcm16Base64,
    });
  }

  private configureSession(): void {
    const sent = this.send({
      type: 'session.update',
      session: {
        audio: {
          input: {
            transcription: {
              model: INPUT_TRANSCRIPTION_MODEL,
            },
          },
          output: {
            language: this.options.settings.translationLanguage,
          },
        },
      },
    });
    if (!sent) {
      throw new Error('Failed to send Realtime session configuration.');
    }
  }

  private handleMessage(raw: string): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch (reason) {
      logWarn('Ignored malformed Realtime event.', { rawLength: raw.length, reason });
      return;
    }

    const typeValue = event['type'];
    const type = typeof typeValue === 'string' ? typeValue : '';
    if (type === 'session.closed') {
      this.finishClose(this.ws);
      return;
    }

    if (type === 'error') {
      const message = readRealtimeError(event);
      logError('Realtime API error event.', message);
      this.emitError(message);
      return;
    }

    if (type === 'session.input_transcript.delta') {
      this.applyDelta('original', readDelta(event));
      return;
    }

    if (type === 'session.input_transcript.completed') {
      this.applyFinal('original', readDelta(event));
      return;
    }

    if (type === 'session.output_transcript.delta') {
      this.applyDelta('translation', readDelta(event));
      return;
    }

    if (type === 'session.output_transcript.completed') {
      this.applyFinal('translation', readDelta(event));
      return;
    }

    if (isTranscriptEvent(type, 'input') && type.endsWith('.delta')) {
      this.applyDelta('original', readDelta(event));
      return;
    }

    if (isTranscriptEvent(type, 'input') && isFinalEvent(type)) {
      this.applyFinal('original', readDelta(event));
      return;
    }

    if (isTranscriptEvent(type, 'output') && type.endsWith('.delta')) {
      this.applyDelta('translation', readDelta(event));
      return;
    }

    if (isTranscriptEvent(type, 'output') && isFinalEvent(type)) {
      this.applyFinal('translation', readDelta(event));
      return;
    }

    if (type.endsWith('.done') || type.endsWith('.completed')) {
      if (this.activeCaption) {
        this.activeCaption = {
          ...this.activeCaption,
          partial: false,
          updatedAt: Date.now(),
        };
        this.emitCaption(this.activeCaption);
      }
    }
  }

  private applyDelta(field: 'original' | 'translation', delta: string): void {
    if (!delta.trim()) {
      return;
    }

    const now = Date.now();
    if (!this.activeCaption || this.shouldStartNewCaption(now)) {
      this.activeCaption = this.newCaption();
    }

    this.lastDeltaAt = now;
    this.activeCaption = {
      ...this.activeCaption,
      [field]: appendText(this.activeCaption[field], delta),
      partial: true,
      updatedAt: now,
    };
    this.emitCaption(this.activeCaption);
  }

  private applyFinal(field: 'original' | 'translation', text: string): void {
    const now = Date.now();
    if (!text.trim()) {
      this.completeActiveCaption(now);
      return;
    }

    if (!this.activeCaption || this.shouldStartNewCaption(now)) {
      this.activeCaption = this.newCaption();
    }

    this.lastDeltaAt = now;
    this.activeCaption = {
      ...this.activeCaption,
      [field]: text.trim(),
      partial: false,
      updatedAt: now,
    };
    this.emitCaption(this.activeCaption);
  }

  private shouldStartNewCaption(now: number): boolean {
    const caption = this.activeCaption;
    if (!caption) {
      return false;
    }
    return now - this.lastDeltaAt > CAPTION_SILENCE_BREAK_MS && hasReadableText(caption);
  }

  private completeActiveCaption(now: number): void {
    if (!this.activeCaption) {
      return;
    }

    this.activeCaption = {
      ...this.activeCaption,
      partial: false,
      updatedAt: now,
    };
    this.emitCaption(this.activeCaption);
  }

  private emitStatus(status: 'connecting' | 'listening'): void {
    try {
      this.options.onStatus(status);
    } catch (reason) {
      logError('Realtime status callback failed.', reason);
      throw reason;
    }
  }

  private emitCaption(caption: CaptionEntry): void {
    try {
      this.options.onCaption(caption);
    } catch (reason) {
      logError('Realtime caption callback failed.', reason);
      throw reason;
    }
  }

  private emitError(message: string): void {
    try {
      this.options.onError(message);
    } catch (reason) {
      logError('Realtime error callback failed.', reason);
    }
  }

  private newCaption(): CaptionEntry {
    const now = Date.now();
    return {
      id: randomUUID(),
      originalLanguage: this.options.settings.originalLanguage,
      translationLanguage: this.options.settings.translationLanguage,
      original: '',
      translation: '',
      partial: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  private send(message: RealtimeClientEvent): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (reason) {
      logError('Failed to send Realtime client event.', {
        eventType: clientEventType(message),
        reason,
      });
      return false;
    }
  }

  private scheduleCloseTimeout(ws: WebSocket): void {
    this.clearCloseTimeout();
    this.closeTimeout = setTimeout(() => {
      logWarn('Realtime WebSocket did not close gracefully in time.');
      terminateWebSocket(ws);
      this.finishClose(ws);
    }, GRACEFUL_CLOSE_TIMEOUT_MS);
  }

  private clearCloseTimeout(): void {
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = null;
    }
  }

  private finishClose(ws: WebSocket | null): void {
    this.clearCloseTimeout();
    this.activeCaption = null;
    this.closing = false;
    this.shouldReportClose = false;
    if (!ws) {
      this.ws = null;
      return;
    }
    if (this.ws === ws) {
      this.ws = null;
    }
    if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
      closeWebSocket(ws);
    }
  }
}

function buildRealtimeUrl(): string {
  const url = new URL(REALTIME_URL);
  if (!url.searchParams.has('model')) {
    url.searchParams.set('model', REALTIME_MODEL);
  }
  return url.toString();
}

function readDelta(event: RealtimeServerEvent): string {
  const record = event as Record<string, unknown>;
  const candidates = [
    record['delta'],
    record['transcript'],
    record['text'],
    record['content'],
    record['partial'],
    record['text_delta'],
    record['output_text_delta'],
    record['transcript_delta'],
    record['input_transcript'],
    record['input_transcript_delta'],
    record['input_transcription'],
    record['input_transcription_delta'],
    record['output_transcript'],
    record['output_transcript_delta'],
    record['translation'],
    record['translation_delta'],
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  return '';
}

function readRealtimeError(event: Record<string, unknown>): string {
  const error = event['error'];
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record['message'] === 'string') {
      return record['message'];
    }
    const details = [record['type'], record['code']].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    );
    if (details.length > 0) {
      return details.join(': ');
    }
  }
  return 'Realtime API returned an error.';
}

function rawDataToString(data: RawData): string {
  if (typeof data === 'string') {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }

  return data.toString('utf8');
}

function appendText(current: string, delta: string): string {
  if (!current) {
    return delta.trimStart();
  }
  return `${current}${delta}`;
}

function hasReadableText(caption: CaptionEntry): boolean {
  return Boolean(caption.original.trim() || caption.translation.trim());
}

function isTranscriptEvent(type: string, direction: 'input' | 'output'): boolean {
  const hasDirection =
    direction === 'input'
      ? type.includes('input')
      : type.includes('output') || type.includes('translation');

  return hasDirection && (type.includes('transcript') || type.includes('transcription'));
}

function isFinalEvent(type: string): boolean {
  return type.endsWith('.done') || type.endsWith('.completed');
}

function clientEventType(message: RealtimeClientEvent): string {
  const type = message['type'];
  return typeof type === 'string' ? type : 'unknown';
}

function closeWebSocket(ws: WebSocket): void {
  try {
    ws.close(1000, 'stopped');
  } catch (reason) {
    logWarn('Failed to close Realtime WebSocket.', reason);
  }
}

function terminateWebSocket(ws: WebSocket): void {
  try {
    ws.terminate();
  } catch (reason) {
    logWarn('Failed to terminate Realtime WebSocket.', reason);
  }
}

function errorFromUnknown(message: string, reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(message, { cause: reason });
}
