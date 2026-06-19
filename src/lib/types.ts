export interface AppConstants {
  defaultMaxTokens: number;
  minGenerationTokens: number;
  maxGenerationTokens: number;
  defaultTranslationContextTokens: number;
  minTranslationContextTokens: number;
  maxTranslationContextTokens: number;
  defaultTranslationThreads: number;
  defaultTranscriptionThreads: number;
  minWorkerThreads: number;
  maxWorkerThreads: number;
  defaultTranscriptionWindowSeconds: number;
  minTranscriptionWindowSeconds: number;
  maxTranscriptionWindowSeconds: number;
  defaultTranscriptionHopSeconds: number;
  minTranscriptionHopSeconds: number;
  maxTranscriptionHopSeconds: number;
  defaultTranscriptionSentenceTimeoutMs: number;
  minTranscriptionSentenceTimeoutMs: number;
  maxTranscriptionSentenceTimeoutMs: number;
  defaultTargetLanguage: string;
  defaultUiLanguage: string;
  defaultToggleListeningShortcut: string;
  defaultToggleOverlayShortcut: string;
  maxModelWalkDepth: number;
  whisperModelExtensions: string[];
  translationModelExtensions: string[];
  mainWindowLabel: string;
  overlayWindowLabel: string;
  settingsWindowLabel: string;
  snapshotEvent: string;
  settingsNavigateEvent: string;
}

export type InputSource = 'microphone' | 'systemAudio';
export type ListeningState = 'idle' | 'starting' | 'listening' | 'error';
export type ServiceHealth = 'unknown' | 'ready' | 'degraded' | 'unavailable';
export type SegmentStatus = 'transcribed' | 'translating' | 'translated' | 'translationFailed';
export type ModelKind = 'transcription' | 'translation';
export type ModelState = 'active' | 'available' | 'missing';
export type SettingsSection =
  | 'inputs'
  | 'transcription'
  | 'translation'
  | 'interface'
  | 'overlay'
  | 'shortcuts'
  | 'logs'
  | 'rawConfig'
  | 'about';

export interface SourceState {
  enabled: boolean;
  available: boolean;
  capturing: boolean;
  health: ServiceHealth;
  inputLevel: number | null;
  detail: UserMessage | null;
}

export interface UserMessage {
  code: string;
  params?: Record<string, string> | undefined;
}

export interface ModelRecord {
  kind: ModelKind;
  name: string;
  relativePath: string;
  path: string;
  sizeBytes: number | null;
  state: ModelState;
  recommended: boolean;
  downloadUrl: string | null;
}

export interface TranslationSettings {
  modelPath: string;
  selectedModel: string;
  targetLanguage: string;
  maxTokens: number;
  contextTokens: number;
  threads: number;
}

export interface ShortcutSettings {
  toggleListening: string;
  toggleOverlay: string;
}

export interface OverlaySettings {
  visible: boolean;
  alwaysOnTop: boolean;
}

export interface InterfaceSettings {
  uiLanguage: string;
}

export interface RelaySettings {
  microphoneEnabled: boolean;
  systemAudioEnabled: boolean;
  sttModelPath: string;
  sttSelectedModel: string;
  sttThreads: number;
  sttWindowSeconds: number;
  sttHopSeconds: number;
  sttSentenceTimeoutMs: number;
  translation: TranslationSettings;
  overlay: OverlaySettings;
  interface: InterfaceSettings;
  shortcuts: ShortcutSettings;
}

export interface DiagnosticsEntry {
  id: string;
  timestampMs: number;
  level: string;
  message: UserMessage;
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
  shortcutWarnings: UserMessage[];
  microphone: SourceState;
  systemAudio: SourceState;
  sttHealth: ServiceHealth;
  sttDetail: UserMessage | null;
  translationHealth: ServiceHealth;
  translationDetail: UserMessage | null;
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
  modelsDir: string;
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
