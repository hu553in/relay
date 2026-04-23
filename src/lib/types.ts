export type InputSource = 'microphone' | 'systemAudio';
export type ListeningState = 'idle' | 'starting' | 'listening' | 'stopping' | 'error';
export type ServiceHealth = 'unknown' | 'ready' | 'degraded' | 'unavailable';
export type SegmentStatus = 'transcribed' | 'translating' | 'translated' | 'translationFailed';
export type ModelKind = 'transcription' | 'translation';
export type ModelState = 'active' | 'available' | 'missing';

export interface SourceState {
  enabled: boolean;
  available: boolean;
  capturing: boolean;
  health: ServiceHealth;
  inputLevel: number | null;
  detail: string | null;
}

export interface ModelRecord {
  kind: ModelKind;
  name: string;
  relativePath: string;
  path: string;
  sizeBytes: number | null;
  state: ModelState;
}

export interface TranslationSettings {
  modelPath: string;
  selectedModel: string;
  targetLanguage: string;
  maxTokens: number;
}

export interface ShortcutSettings {
  toggleListening: string;
  toggleOverlay: string;
}

export interface OverlaySettings {
  visible: boolean;
  alwaysOnTop: boolean;
}

export interface RelaySettings {
  microphoneEnabled: boolean;
  systemAudioEnabled: boolean;
  sttModelPath: string;
  sttSelectedModel: string;
  translation: TranslationSettings;
  overlay: OverlaySettings;
  shortcuts: ShortcutSettings;
}

export interface DiagnosticsEntry {
  id: string;
  timestampMs: number;
  level: string;
  message: string;
}

export interface SegmentRecord {
  id: string;
  source: InputSource;
  createdAtMs: number;
  transcript: string;
  translation: string | null;
  status: SegmentStatus;
}

export interface AppSnapshot {
  listeningState: ListeningState;
  settings: RelaySettings;
  shortcutWarnings: string[];
  microphone: SourceState;
  systemAudio: SourceState;
  sttHealth: ServiceHealth;
  sttDetail: string | null;
  translationHealth: ServiceHealth;
  translationDetail: string | null;
  activeSessionId: string | null;
  sessionStartedAtMs: number | null;
  sessionSegmentCount: number;
  sessionTranslationCount: number;
  sessionTranslationFailureCount: number;
  transcriptClearedAtMs: number | null;
  translationClearedAtMs: number | null;
  segments: SegmentRecord[];
  models: ModelRecord[];
  diagnostics: DiagnosticsEntry[];
}

export interface AppPaths {
  configFile: string;
  diagnosticsLogFile: string;
}

export interface TemperatureReading {
  label: string;
  temperatureC: number;
  maxC: number | null;
}

export interface SystemMetrics {
  collectedAtMs: number;
  cpuLogicalCores: number;
  systemCpuUsage: number;
  processCpuUsage: number | null;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  processMemoryBytes: number | null;
  swapUsedBytes: number;
  swapTotalBytes: number;
  temperatures: TemperatureReading[];
}

export interface RelaySnapshotState {
  snapshot: AppSnapshot | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
