export type AppStatus = 'idle' | 'connecting' | 'listening' | 'error';

export interface LanguageOption {
  code: string;
  label: string;
}

export interface RelaySettings {
  microphone: boolean;
  systemAudio: boolean;
  originalLanguage: string;
  translationLanguage: string;
  overlayRows: number;
  overlayOpacity: number;
}

interface ApiKeyState {
  hasApiKey: boolean;
}

export interface CaptionEntry {
  id: string;
  originalLanguage: string;
  translationLanguage: string;
  original: string;
  translation: string;
  partial: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RelayState {
  status: AppStatus;
  settings: RelaySettings;
  apiKey: ApiKeyState;
  overlayVisible: boolean;
  captions: CaptionEntry[];
  error: string | null;
}

interface SaveTranscriptsResult {
  filePath: string | null;
  saved: boolean;
}

export interface AudioChunkPayload {
  pcm16Base64: string;
}

export interface WindowSize {
  width: number;
  height: number;
}

export interface StartCaptureRequest {
  microphone: boolean;
  systemAudio: boolean;
}

export interface RelayBridge {
  getState(): Promise<RelayState>;
  saveSettings(settings: Partial<RelaySettings>): Promise<RelayState>;
  saveApiKey(apiKey: string): Promise<RelayState>;
  clearApiKey(): Promise<RelayState>;
  openRepository(): Promise<void>;
  saveTranscripts(): Promise<SaveTranscriptsResult>;
  start(): Promise<RelayState>;
  stop(): Promise<RelayState>;
  sendAudioChunk(payload: AudioChunkPayload): void;
  resizeWindow(size: WindowSize): void;
  showOverlay(): Promise<void>;
  hideOverlay(): Promise<void>;
  quit(): Promise<void>;
  onState(listener: (state: RelayState) => void): () => void;
  onStartCapture(listener: (request: StartCaptureRequest) => void): () => void;
  onStopCapture(listener: () => void): () => void;
}
