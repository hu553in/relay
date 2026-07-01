import { contextBridge, ipcRenderer } from 'electron';

import type {
  AudioChunkPayload,
  RelayBridge,
  RelaySettings,
  RelayState,
  StartCaptureRequest,
  WindowSize,
} from '@/shared/types';

import { IPC_CHANNELS } from './ipc-channels';

const LOG_PREFIX = '[relay]';

function logPreloadError(message: string, reason: unknown): void {
  console.error(LOG_PREFIX, message, reason);
}

const bridge: RelayBridge = {
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.getState) as Promise<RelayState>,
  saveSettings: (settings: Partial<RelaySettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveSettings, settings),
  saveApiKey: (apiKey: string) => ipcRenderer.invoke(IPC_CHANNELS.saveApiKey, apiKey),
  clearApiKey: () => ipcRenderer.invoke(IPC_CHANNELS.clearApiKey),
  openRepository: () => ipcRenderer.invoke(IPC_CHANNELS.openRepository),
  saveTranscripts: () => ipcRenderer.invoke(IPC_CHANNELS.saveTranscripts),
  start: () => ipcRenderer.invoke(IPC_CHANNELS.start),
  stop: () => ipcRenderer.invoke(IPC_CHANNELS.stop),
  sendAudioChunk: (payload: AudioChunkPayload) => {
    ipcRenderer.send(IPC_CHANNELS.audioChunk, payload);
  },
  resizeWindow: (size: WindowSize) => {
    ipcRenderer.send(IPC_CHANNELS.resizeWindow, size);
  },
  showOverlay: () => ipcRenderer.invoke(IPC_CHANNELS.showOverlay),
  hideOverlay: () => ipcRenderer.invoke(IPC_CHANNELS.hideOverlay),
  quit: () => ipcRenderer.invoke(IPC_CHANNELS.quit),
  onState: (listener: (state: RelayState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: RelayState) => {
      try {
        listener(state);
      } catch (reason) {
        logPreloadError('State listener failed.', reason);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.state, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.state, handler);
  },
  onStartCapture: (listener: (request: StartCaptureRequest) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, request: StartCaptureRequest) => {
      try {
        listener(request);
      } catch (reason) {
        logPreloadError('Start capture listener failed.', reason);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.startCapture, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.startCapture, handler);
  },
  onStopCapture: (listener: () => void) => {
    const handler = () => {
      try {
        listener();
      } catch (reason) {
        logPreloadError('Stop capture listener failed.', reason);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.stopCapture, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.stopCapture, handler);
  },
};

try {
  contextBridge.exposeInMainWorld('relay', bridge);
} catch (reason) {
  logPreloadError('Failed to expose preload bridge.', reason);
  throw reason;
}
