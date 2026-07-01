import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type SaveDialogOptions,
  screen,
  session as electronSession,
  shell,
  Tray,
} from 'electron';

import { logError, logWarn } from '@/shared/log';
import { isRelayActive } from '@/shared/status';
import type {
  AudioChunkPayload,
  CaptionEntry,
  RelaySettings,
  RelayState,
  StartCaptureRequest,
  WindowSize,
} from '@/shared/types';

import { IPC_CHANNELS } from './ipc-channels';
import { RealtimeTranslationSession } from './realtime';
import { SettingsStore } from './settings';
import { createTrayIcon } from './tray-icon';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..');
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const RENDERER_DIST = path.join(APP_ROOT, 'dist');

let controlWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let session: RealtimeTranslationSession | null = null;
let lastPopoverBlurAt = 0;
let controlMeasuredSize: WindowSize | null = null;
let overlayMeasuredSize: WindowSize | null = null;
let lastTrayActive: boolean | null = null;
let overlayWantedVisible = false;

const CONTROL_INITIAL_SIZE: WindowSize = {
  width: 520,
  height: 295,
};
const OVERLAY_WIDTH_RATIO = 0.9;
const OVERLAY_BOTTOM_MARGIN_RATIO = 0.1;
const OVERLAY_MAX_HEIGHT_RATIO = 0.9;
const OVERLAY_MIN_HEIGHT = 160;
const OVERLAY_INITIAL_SIZE: WindowSize = {
  width: 720,
  height: 320,
};
const MAX_AUDIO_CHUNK_BASE64_LENGTH = 64_000;
const REPOSITORY_URL = 'https://github.com/hu553in/relay';
const TRANSCRIPTS_EXTENSION = 'txt';

const settingsStore = new SettingsStore();
const captions = new Map<string, CaptionEntry>();

let status: RelayState['status'] = 'idle';
let error: string | null = null;

function relayState(): RelayState {
  return {
    status,
    settings: settingsStore.settings,
    apiKey: {
      hasApiKey: settingsStore.hasApiKey(),
    },
    overlayVisible: overlayWantedVisible && Boolean(overlayWindow && !overlayWindow.isDestroyed()),
    captions: Array.from(captions.values())
      .toSorted((a, b) => a.createdAt - b.createdAt)
      .slice(-settingsStore.settings.overlayRows),
    error,
  };
}

function emitState(): void {
  let state: RelayState;
  try {
    state = relayState();
  } catch (reason) {
    logError('Failed to build relay state.', reason);
    return;
  }

  for (const window of BrowserWindow.getAllWindows()) {
    try {
      window.webContents.send(IPC_CHANNELS.state, state);
    } catch (reason) {
      logWarn('Failed to send state update to renderer.', reason);
    }
  }
  syncTray();
  syncControlWindow();
  syncOverlayWindow();
}

function setStatus(next: RelayState['status'], nextError: string | null = null): void {
  status = next;
  error = nextError;
  emitState();
}

function clearInactiveError(): void {
  if (status === 'error') {
    status = 'idle';
  }
  error = null;
}

function rendererUrl(kind: 'control' | 'overlay'): string {
  if (VITE_DEV_SERVER_URL) {
    const url = new URL(VITE_DEV_SERVER_URL);
    url.searchParams.set('window', kind);
    return url.toString();
  }

  const url = pathToFileURL(path.join(RENDERER_DIST, 'index.html'));
  url.searchParams.set('window', kind);
  return url.toString();
}

function preloadPath(): string {
  return path.join(__dirname, 'preload.cjs');
}

function registerDisplayMediaHandler(): void {
  try {
    electronSession.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      try {
        callback({
          ...(request.audioRequested ? { audio: 'loopback' as const } : {}),
          ...(request.videoRequested && request.frame ? { video: request.frame } : {}),
        });
      } catch (reason) {
        logError('Failed to resolve display media request.', reason);
        throw reason;
      }
    });
  } catch (reason) {
    logError('Failed to register display media handler.', reason);
    throw reason;
  }
}

async function openExternalUrl(rawUrl: string): Promise<void> {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') {
      throw new Error(`Unsupported external URL protocol: ${url.protocol}`);
    }

    await shell.openExternal(url.toString());
  } catch (reason) {
    logWarn('Failed to open external URL.', reason);
    throw reason;
  }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function measuredWindowSize(size: WindowSize | null, fallback: WindowSize): WindowSize {
  return size ?? fallback;
}

function sanitizeWindowSize(size: unknown): WindowSize | null {
  if (!size || typeof size !== 'object') {
    return null;
  }
  const candidate = size as Partial<WindowSize>;
  const widthValue = candidate.width;
  const heightValue = candidate.height;
  if (
    typeof widthValue !== 'number' ||
    typeof heightValue !== 'number' ||
    !Number.isFinite(widthValue) ||
    !Number.isFinite(heightValue)
  ) {
    return null;
  }

  const width = Math.ceil(widthValue);
  const height = Math.ceil(heightValue);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

function sanitizeAudioChunkPayload(payload: unknown): AudioChunkPayload | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as Partial<AudioChunkPayload>;
  const pcm16Base64 = candidate.pcm16Base64;
  if (
    typeof pcm16Base64 !== 'string' ||
    pcm16Base64.length === 0 ||
    pcm16Base64.length > MAX_AUDIO_CHUNK_BASE64_LENGTH
  ) {
    return null;
  }

  return { pcm16Base64 };
}

function sanitizeSettingsPatch(payload: unknown): Partial<RelaySettings> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  const patch: Partial<RelaySettings> = {};
  const microphone = candidate['microphone'];
  const systemAudio = candidate['systemAudio'];
  const originalLanguage = candidate['originalLanguage'];
  const translationLanguage = candidate['translationLanguage'];
  const overlayRows = candidate['overlayRows'];
  const overlayOpacity = candidate['overlayOpacity'];

  if (typeof microphone === 'boolean') {
    patch.microphone = microphone;
  }
  if (typeof systemAudio === 'boolean') {
    patch.systemAudio = systemAudio;
  }
  if (typeof originalLanguage === 'string') {
    patch.originalLanguage = originalLanguage;
  }
  if (typeof translationLanguage === 'string') {
    patch.translationLanguage = translationLanguage;
  }
  if (typeof overlayRows === 'number' && Number.isFinite(overlayRows)) {
    patch.overlayRows = overlayRows;
  }
  if (typeof overlayOpacity === 'number' && Number.isFinite(overlayOpacity)) {
    patch.overlayOpacity = overlayOpacity;
  }

  return patch;
}

function sameWindowSize(left: WindowSize, right: WindowSize): boolean {
  return left.width === right.width && left.height === right.height;
}

function sortedCaptions(): CaptionEntry[] {
  return Array.from(captions.values()).toSorted((a, b) => a.createdAt - b.createdAt);
}

function transcriptsText(): string {
  const blocks = sortedCaptions().map(caption =>
    [
      `${transcriptsLanguageCode(caption.originalLanguage)}: ${caption.original.trim()}`,
      `${transcriptsLanguageCode(caption.translationLanguage)}: ${caption.translation.trim()}`,
    ].join('\n')
  );

  return blocks.length === 0 ? '' : `${blocks.join('\n\n')}\n`;
}

function transcriptsLanguageCode(code: string): string {
  return code.toLowerCase();
}

function transcriptsDefaultPath(): string {
  return path.join(app.getPath('documents'), `relay-${fileDateTime(new Date())}.txt`);
}

function fileDateTime(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return [
    date.getFullYear().toString(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('-');
}

function overlayWindowBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.round(workArea.width * OVERLAY_WIDTH_RATIO);
  const height = clampInt(
    measuredWindowSize(overlayMeasuredSize, OVERLAY_INITIAL_SIZE).height,
    OVERLAY_MIN_HEIGHT,
    Math.round(workArea.height * OVERLAY_MAX_HEIGHT_RATIO)
  );
  const bottomMargin = Math.round(workArea.height * OVERLAY_BOTTOM_MARGIN_RATIO);

  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + workArea.height - height - bottomMargin),
  };
}

function createControlWindow(): BrowserWindow {
  const size = measuredWindowSize(controlMeasuredSize, CONTROL_INITIAL_SIZE);
  const window = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: 1,
    minHeight: 1,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    transparent: true,
    hasShadow: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    title: 'Relay',
    webPreferences: {
      preload: preloadPath(),
      backgroundThrottling: false,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  logWindowProblems(window, 'control');
  window.loadURL(rendererUrl('control')).catch((reason: unknown) => {
    logError('Failed to load control renderer.', reason);
  });
  window.on('blur', () => {
    try {
      if (window.isVisible()) {
        lastPopoverBlurAt = Date.now();
        hideControlWindow(window);
      }
    } catch (reason) {
      logWarn('Failed to handle control window blur.', reason);
    }
  });
  window.on('closed', () => {
    if (controlWindow === window) {
      controlWindow = null;
      controlMeasuredSize = null;
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url).catch(() => undefined);
    return { action: 'deny' };
  });
  return window;
}

function createOverlayWindow(): BrowserWindow {
  const bounds = overlayWindowBounds();
  const window = new BrowserWindow({
    ...bounds,
    minWidth: 1,
    minHeight: 1,
    show: false,
    frame: false,
    resizable: true,
    movable: true,
    focusable: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    title: 'Relay captions',
    webPreferences: {
      preload: preloadPath(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  logWindowProblems(window, 'overlay');
  window.setIgnoreMouseEvents(true, { forward: true });
  pinOverlayWindow(window);
  window.loadURL(rendererUrl('overlay')).catch((reason: unknown) => {
    logError('Failed to load overlay renderer.', reason);
    if (overlayWindow === window) {
      overlayWantedVisible = false;
      window.destroy();
      emitState();
    }
  });
  window.once('ready-to-show', () => {
    try {
      if (overlayWantedVisible) {
        syncOverlayWindow({ force: true });
        window.showInactive();
      }
      emitState();
    } catch (reason) {
      overlayWantedVisible = false;
      logError('Failed to show overlay window after ready-to-show.', reason);
      emitState();
    }
  });
  window.on('show', () => {
    emitState();
  });
  window.on('hide', () => {
    emitState();
  });
  window.on('closed', () => {
    if (overlayWindow === window) {
      overlayWindow = null;
      overlayMeasuredSize = null;
      overlayWantedVisible = false;
      emitState();
    }
  });
  return window;
}

function logWindowProblems(window: BrowserWindow, name: string): void {
  window.on('unresponsive', () => {
    logWarn(`${name} window became unresponsive.`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    logError(`${name} renderer process gone.`, details);
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logError(`${name} renderer failed to load.`, {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });
}

function createTray(): void {
  try {
    tray = new Tray(createTrayIcon(false));
  } catch (reason) {
    logError('Failed to create tray icon.', reason);
    throw reason;
  }
  try {
    tray.setToolTip('Relay');
  } catch (reason) {
    logWarn('Failed to set tray tooltip.', reason);
  }
  tray.on('click', () => {
    try {
      toggleControlWindow();
    } catch (reason) {
      logError('Failed to handle tray click.', reason);
    }
  });
  tray.on('right-click', () => {
    try {
      toggleControlWindow();
    } catch (reason) {
      logError('Failed to handle tray right-click.', reason);
    }
  });
  syncTray();
}

function syncTray(): void {
  if (!tray) {
    return;
  }
  const active = isRelayActive(status);
  if (lastTrayActive === active) {
    return;
  }
  try {
    tray.setImage(createTrayIcon(active));
  } catch (reason) {
    logError('Failed to update tray icon.', reason);
    return;
  }
  lastTrayActive = active;
}

function syncControlWindow({ force = false }: { force?: boolean } = {}): void {
  if (!controlWindow || controlWindow.isDestroyed()) {
    return;
  }
  if (!force && !controlWindow.isVisible()) {
    return;
  }
  try {
    positionControlWindow(controlWindow);
  } catch (reason) {
    logWarn('Failed to sync control window.', reason);
  }
}

function syncOverlayWindow({ force = false }: { force?: boolean } = {}): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }
  if (!force && !overlayWindow.isVisible()) {
    return;
  }
  try {
    const nextBounds = overlayWindowBounds();
    const currentBounds = overlayWindow.getBounds();
    if (
      currentBounds.x !== nextBounds.x ||
      currentBounds.y !== nextBounds.y ||
      currentBounds.width !== nextBounds.width ||
      currentBounds.height !== nextBounds.height
    ) {
      overlayWindow.setBounds(nextBounds);
    }
  } catch (reason) {
    logWarn('Failed to sync overlay window.', reason);
  }
}

function pinOverlayWindow(window: BrowserWindow): void {
  try {
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
    window.setAlwaysOnTop(true, 'screen-saver');
  } catch (reason) {
    logWarn('Failed to pin overlay window.', reason);
  }
}

function positionControlWindow(window: BrowserWindow): void {
  const trayBounds = tray?.getBounds();
  const margin = 8;
  if (!trayBounds) {
    const { workArea } = screen.getPrimaryDisplay();
    const size = measuredWindowSize(controlMeasuredSize, CONTROL_INITIAL_SIZE);
    const maxWidth = Math.max(1, workArea.width - margin * 2);
    const maxHeight = Math.max(1, workArea.height - margin * 2);
    window.setSize(clampInt(size.width, 1, maxWidth), clampInt(size.height, 1, maxHeight));
    window.center();
    return;
  }

  const display = screen.getDisplayNearestPoint({
    x: Math.round(trayBounds.x + trayBounds.width / 2),
    y: Math.round(trayBounds.y + trayBounds.height / 2),
  });
  const { workArea } = display;
  const size = measuredWindowSize(controlMeasuredSize, CONTROL_INITIAL_SIZE);
  const maxWidth = Math.max(1, workArea.width - margin * 2);
  const maxHeight = Math.max(1, workArea.height - margin * 2);
  const width = clampInt(size.width, 1, maxWidth);
  const height = clampInt(size.height, 1, maxHeight);
  const x = clampInt(
    Math.round(trayBounds.x + trayBounds.width / 2 - width / 2),
    workArea.x + margin,
    workArea.x + workArea.width - width - margin
  );
  const opensDownward = trayBounds.y < workArea.y + workArea.height / 2;
  const preferredY = opensDownward
    ? trayBounds.y + trayBounds.height + margin
    : trayBounds.y - height - margin;
  const y = clampInt(
    Math.round(preferredY),
    workArea.y + margin,
    workArea.y + workArea.height - height - margin
  );

  window.setBounds({
    x,
    y,
    width,
    height,
  });
}

function showControlWindow(): void {
  try {
    if (!controlWindow || controlWindow.isDestroyed()) {
      controlWindow = createControlWindow();
    }
    syncControlWindow({ force: true });
    controlWindow.show();
    controlWindow.moveTop();
    controlWindow.focus();
    app.focus({ steal: true });
  } catch (reason) {
    logError('Failed to show control window.', reason);
  }
}

function showControlWindowAfterReady(): void {
  if (app.isReady()) {
    showControlWindow();
    return;
  }

  app
    .whenReady()
    .then(() => {
      showControlWindow();
    })
    .catch((reason: unknown) => {
      logWarn('Failed to show control window after app ready.', reason);
    });
}

function toggleControlWindow(): void {
  if (controlWindow?.isVisible()) {
    lastPopoverBlurAt = Date.now();
    hideControlWindow(controlWindow);
    return;
  }
  if (Date.now() - lastPopoverBlurAt < 180) {
    return;
  }
  showControlWindow();
}

function showOverlayWindow(): void {
  overlayWantedVisible = true;
  try {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      overlayWindow = createOverlayWindow();
      emitState();
      return;
    }
    syncOverlayWindow({ force: true });
    overlayWindow.showInactive();
    emitState();
  } catch (reason) {
    overlayWantedVisible = false;
    logError('Failed to show overlay window.', reason);
    emitState();
    throw reason;
  }
}

function hideOverlayWindow(): void {
  overlayWantedVisible = false;
  try {
    overlayWindow?.hide();
  } catch (reason) {
    overlayWantedVisible = Boolean(overlayWindow && !overlayWindow.isDestroyed());
    logWarn('Failed to hide overlay window.', reason);
    throw reason;
  } finally {
    emitState();
  }
}

async function saveTranscripts(): Promise<{ filePath: string | null; saved: boolean }> {
  const options: SaveDialogOptions = {
    defaultPath: transcriptsDefaultPath(),
    filters: [
      {
        name: 'Text files',
        extensions: [TRANSCRIPTS_EXTENSION],
      },
    ],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
    title: 'Save transcripts',
  };
  let canceled: boolean;
  let filePath: string | undefined;
  try {
    const result =
      controlWindow && !controlWindow.isDestroyed()
        ? await dialog.showSaveDialog(controlWindow, options)
        : await dialog.showSaveDialog(options);
    canceled = result.canceled;
    filePath = result.filePath;
  } catch (reason) {
    logError('Failed to show transcripts save dialog.', reason);
    throw reason;
  }

  if (canceled || !filePath) {
    return { filePath: null, saved: false };
  }

  try {
    await writeFile(filePath, transcriptsText(), 'utf8');
  } catch (reason) {
    logError('Failed to write transcripts file.', { filePath, reason });
    throw reason;
  }
  return { filePath, saved: true };
}

async function updateSettings(next: Partial<RelaySettings>): Promise<RelayState> {
  if (isRelayActive(status)) {
    return relayState();
  }
  const previous = settingsStore.settings;
  try {
    await settingsStore.updateSettings(next);
  } catch (reason) {
    logError('Failed to save settings.', reason);
    throw reason;
  }
  if (
    next.overlayRows !== undefined &&
    settingsStore.settings.overlayRows !== previous.overlayRows
  ) {
    overlayMeasuredSize = null;
  }
  clearInactiveError();
  emitState();
  return relayState();
}

async function startRelay(): Promise<RelayState> {
  if (status === 'connecting' || status === 'listening') {
    return relayState();
  }
  const apiKey = settingsStore.getApiKey();
  if (!apiKey) {
    logWarn('Start requested without an API key.');
    showControlWindow();
    return relayState();
  }
  if (!settingsStore.settings.microphone && !settingsStore.settings.systemAudio) {
    logWarn('Start requested without enabled audio sources.');
    setStatus('error', 'Enable microphone, system audio, or both.');
    showControlWindow();
    return relayState();
  }

  showOverlayWindow();
  stopSessionOnly();
  const nextSession = new RealtimeTranslationSession({
    settings: settingsStore.settings,
    apiKey,
    onStatus: next => {
      status = next;
      error = null;
      emitState();
    },
    onCaption: caption => {
      captions.set(caption.id, caption);
      emitState();
    },
    onError: message => {
      stopCapture();
      stopSessionOnly();
      setStatus('error', message);
    },
  });

  session = nextSession;
  try {
    await nextSession.start();
    if (!startCapture()) {
      stopSessionOnly();
      setStatus('error', 'Failed to start audio capture.');
    }
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    logError('Failed to start Realtime session.', reason);
    stopSessionOnly();
    setStatus('error', message);
  }
  return relayState();
}

function stopRelay(): RelayState {
  stopCapture();
  stopSessionOnly();
  setStatus('idle');
  return relayState();
}

function stopSessionOnly(): void {
  try {
    session?.stop();
  } catch (reason) {
    logWarn('Failed to stop Realtime session.', reason);
  } finally {
    session = null;
  }
}

function startCapture(): boolean {
  const request: StartCaptureRequest = {
    microphone: settingsStore.settings.microphone,
    systemAudio: settingsStore.settings.systemAudio,
  };
  if (!controlWindow || controlWindow.isDestroyed() || controlWindow.webContents.isDestroyed()) {
    logError('Failed to start audio capture because the control renderer is unavailable.');
    return false;
  }

  try {
    controlWindow.webContents.send(IPC_CHANNELS.startCapture, request);
    return true;
  } catch (reason) {
    logError('Failed to send start capture request to renderer.', reason);
    return false;
  }
}

function stopCapture(): void {
  try {
    controlWindow?.webContents.send(IPC_CHANNELS.stopCapture);
  } catch (reason) {
    logWarn('Failed to send stop capture request to renderer.', reason);
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getState, () => relayState());
  ipcMain.handle(IPC_CHANNELS.saveSettings, async (_event, payload: unknown) => {
    const next = sanitizeSettingsPatch(payload);
    if (!next) {
      logWarn('Ignored invalid settings payload.');
      return relayState();
    }
    if (Object.keys(next).length === 0) {
      return relayState();
    }
    return updateSettings(next);
  });
  ipcMain.handle(IPC_CHANNELS.saveApiKey, async (_event, apiKey: unknown) => {
    if (isRelayActive(status)) {
      logWarn('Ignored API key save while relay is active.');
      return relayState();
    }
    if (typeof apiKey !== 'string') {
      logWarn('Ignored invalid API key save payload.');
      return relayState();
    }
    try {
      await settingsStore.saveApiKey(apiKey);
    } catch (reason) {
      logError('Failed to save API key.', reason);
      throw reason;
    }
    clearInactiveError();
    emitState();
    return relayState();
  });
  ipcMain.handle(IPC_CHANNELS.clearApiKey, async () => {
    if (isRelayActive(status)) {
      logWarn('Ignored API key clear while relay is active.');
      return relayState();
    }
    try {
      await settingsStore.clearApiKey();
    } catch (reason) {
      logError('Failed to clear API key.', reason);
      throw reason;
    }
    clearInactiveError();
    emitState();
    return relayState();
  });
  ipcMain.handle(IPC_CHANNELS.start, () => startRelay());
  ipcMain.handle(IPC_CHANNELS.stop, () => stopRelay());
  ipcMain.on(IPC_CHANNELS.audioChunk, (_event, payload: unknown) => {
    const audioChunk = sanitizeAudioChunkPayload(payload);
    if (!audioChunk) {
      logWarn('Ignored invalid audio chunk payload.');
      return;
    }

    try {
      session?.appendAudio(audioChunk.pcm16Base64);
    } catch (reason) {
      logError('Failed to append audio chunk to Realtime session.', reason);
    }
  });
  ipcMain.on(IPC_CHANNELS.resizeWindow, (event, size: unknown) => {
    const nextSize = sanitizeWindowSize(size);
    if (!nextSize) {
      logWarn('Ignored invalid window resize payload.', size);
      return;
    }

    if (event.sender === controlWindow?.webContents) {
      if (controlMeasuredSize && sameWindowSize(controlMeasuredSize, nextSize)) {
        return;
      }
      controlMeasuredSize = nextSize;
      syncControlWindow();
      return;
    }

    if (event.sender === overlayWindow?.webContents) {
      if (overlayMeasuredSize && sameWindowSize(overlayMeasuredSize, nextSize)) {
        return;
      }
      overlayMeasuredSize = nextSize;
      syncOverlayWindow();
      return;
    }

    logWarn('Ignored resize request from unknown renderer.');
  });
  ipcMain.handle(IPC_CHANNELS.showOverlay, () => {
    showOverlayWindow();
  });
  ipcMain.handle(IPC_CHANNELS.hideOverlay, () => {
    hideOverlayWindow();
  });
  ipcMain.handle(IPC_CHANNELS.saveTranscripts, () => saveTranscripts());
  ipcMain.handle(IPC_CHANNELS.openRepository, async () => {
    await openExternalUrl(REPOSITORY_URL);
  });
  ipcMain.handle(IPC_CHANNELS.quit, () => {
    quitApp();
  });
}

function hideControlWindow(window: BrowserWindow): void {
  try {
    window.hide();
  } catch (reason) {
    logWarn('Failed to hide control window.', reason);
  }
}

function quitApp(): void {
  try {
    app.quit();
  } catch (reason) {
    logError('Failed to quit app.', reason);
    throw reason;
  }
}

function startApp(): void {
  void app
    .whenReady()
    .then(async () => {
      if (process.platform === 'darwin') {
        try {
          app.dock?.hide();
        } catch (reason) {
          logWarn('Failed to hide dock icon.', reason);
        }
      }
      if (process.platform === 'win32') {
        try {
          app.setAppUserModelId('app.relay.subtitle');
        } catch (reason) {
          logWarn('Failed to set Windows app user model ID.', reason);
        }
      }
      await settingsStore.load();
      registerDisplayMediaHandler();
      registerIpc();
      createTray();
      emitState();

      app.on('activate', () => {
        showControlWindow();
      });
    })
    .catch((reason: unknown) => {
      logError('App startup failed.', reason);
      quitApp();
    });
}

if (!app.requestSingleInstanceLock()) {
  quitApp();
} else {
  app.on('second-instance', () => {
    logWarn('Second app instance requested; showing existing control window.');
    showControlWindowAfterReady();
  });
  startApp();
}

process.on('uncaughtException', reason => {
  logError('Uncaught exception.', reason);
});

process.on('unhandledRejection', reason => {
  logError('Unhandled promise rejection.', reason);
});

app.on('before-quit', () => {
  stopCapture();
  stopSessionOnly();
});

app.on('window-all-closed', () => {
  // Menu-bar app: keep the process alive until the tray Quit item or Cmd+Q.
});
