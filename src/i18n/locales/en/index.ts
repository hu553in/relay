export const app = {
  name: 'Relay',
  toastTitle: 'Relay',
  windowTitleControls: 'Relay Controls',
  windowTitleOverlay: 'Relay Overlay',
  windowTitleSettings: 'Relay Settings',
} as const;

export const boot = {
  constantsError: 'Failed to load app constants: {{error}}',
  loadingConstants: 'Loading Relay constants...',
  loadingOverview: 'Loading Relay status...',
  loadingSettings: 'Loading Relay settings...',
} as const;

export const common = {
  active: 'Active',
  autoScrollEnabled: 'Auto-scroll enabled',
  available: 'Available',
  browse: 'Browse',
  browsingHistory: 'History',
  clearLog: 'Clear log',
  copyLog: 'Copy log',
  degraded: 'Degraded',
  disabled: 'Disabled',
  dismiss: 'Dismiss',
  error: 'Error',
  failed: 'Failed',
  idle: 'Idle',
  info: 'Info',
  jumpToLatest: 'Jump to latest',
  lineCount_one: '{{count}} line',
  lineCount_other: '{{count}} lines',
  live: 'Live',
  missing: 'Missing',
  notSelected: 'Not selected',
  ready: 'Ready',
  starting: 'Starting',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
  warning: 'Warning',
} as const;

export const controls = {
  appCpu: 'App CPU',
  appMemory: 'App memory',
  hideOverlay: 'Hide overlay',
  hideStats: 'Hide stats',
  inputLevel: 'Input level',
  inputUnavailable: 'Input unavailable',
  liveSession: 'Live session',
  microphone: 'Microphone',
  noModelSelected: 'No model selected',
  openSettings: 'Open settings',
  segments: 'Segments',
  showOverlay: 'Show overlay',
  showStats: 'Show stats',
  systemAudio: 'System audio',
  systemCpu: 'System CPU',
  systemMemory: 'System memory',
  temperatureSensors: 'Temperature sensors',
  transcription: 'Transcription',
  translated: 'Translated',
} as const;

export const diagnostics = {
  audioCaptureFailed: 'System audio capture failed: {{error}}',
  audioCaptureStopped: 'System audio capture stopped unexpectedly',
  audioMicrophoneStarted: 'Audio: microphone capture started',
  audioReaderFailed: 'System audio reader failed: {{error}}',
  audioSystemStarted: 'Audio: system output loopback started',
  globalShortcutFailed: 'Global shortcut failed: {{error}}',
  globalShortcutSnapshotFailed: 'Global shortcut snapshot failed: {{error}}',
  globalShortcutsRegisterFailed: 'Global shortcuts saved but could not be registered: {{error}}',
  globalShortcutsUnavailable: 'Global shortcuts unavailable: {{error}}',
  listeningStopped: 'Listening stopped',
  microphoneStreamFailed: 'Microphone stream failed: {{error}}',
  noInput: 'Enable an available microphone or system audio source before starting listening.',
  recommendedDirectoryChangedTranscription:
    'The transcription model was downloaded to {{path}}, but the models directory changed before selection.',
  recommendedDirectoryChangedTranslation:
    'The translation model was downloaded to {{path}}, but the models directory changed before selection.',
  recommendedDownloadTranscription: 'Downloading recommended transcription model',
  recommendedDownloadTranslation: 'Downloading recommended translation model',
  recommendedFailedTranscription: 'Recommended transcription model download failed: {{error}}',
  recommendedFailedTranslation: 'Recommended translation model download failed: {{error}}',
  recommendedReadyTranscription: 'Recommended transcription model ready: {{path}}',
  recommendedReadyTranslation: 'Recommended translation model ready: {{path}}',
  restartAfterSettings: 'Settings changed. Restarting the audio pipeline.',
  settingsParseFailed:
    'Could not parse settings file {{path}}. Defaults are active until settings are saved: {{error}}',
  settingsReadFailed:
    'Could not read settings file {{path}}. Defaults are active until settings are saved: {{error}}',
  shortcutDefaultInvalidToggleListening:
    'Toggle listening default shortcut {{fallback}} is invalid; using built-in fallback {{baseline}}',
  shortcutDefaultInvalidToggleOverlay:
    'Show / hide overlay default shortcut {{fallback}} is invalid; using built-in fallback {{baseline}}',
  shortcutDuplicateToggleOverlay:
    'Show / hide overlay shortcut duplicated another action; using default {{fallback}}',
  shortcutInvalidToggleListening:
    'Toggle listening shortcut is invalid; using default {{fallback}}',
  shortcutInvalidToggleOverlay:
    'Show / hide overlay shortcut is invalid; using default {{fallback}}',
  startFailed: 'Failed to start listening: {{error}}',
  stoppedAfterSettings:
    'Settings changed. Listening stopped because the selected input or transcription model is not ready.',
  sttUnavailable: 'Choose a valid Whisper model before starting listening.',
  systemAudioStreamFailed: 'System audio stream failed: {{error}}',
  translationFailed: 'Translation failed: {{error}}',
  unknownBackendMessage: 'Unknown backend message: {{code}}',
} as const;

export const listening = {
  listening: 'Listening',
  start: 'Start listening',
  starting: 'Starting',
  startingAction: 'Starting...',
  stop: 'Stop listening',
} as const;

export const logs = {
  clearDiagnostics: 'Clear diagnostics log',
  clearTranscript: 'Clear transcript log',
  clearTranslation: 'Clear translation log',
  diagnostics: 'Diagnostics',
  diagnosticsCleared: 'Diagnostics cleared',
  emptyDiagnostics: 'Waiting for diagnostic events.',
  emptySegments: 'Waiting for live segments.',
  failedCount_one: '{{count}} failed',
  failedCount_other: '{{count}} failed',
  logFileUnavailable: 'Log file unavailable',
  openLogFolder: 'Open log folder',
  original: 'Original',
  translatedCount_one: '{{count}} translated',
  translatedCount_other: '{{count}} translated',
  translation: 'Translation',
  translationFailed: 'Translation failed',
  translationPending: 'Waiting for translation',
  translationUnavailable: 'Translation unavailable',
} as const;

export const models = {
  active: 'Active',
  available: 'Available',
  download: 'Download model',
  downloading: 'Downloading...',
  empty: 'No local models found yet. Select a models directory first.',
  missing: 'Missing',
  models: 'Models',
  recommended: 'Recommended',
  unknownSize: 'Unknown size',
  use: 'Use model',
} as const;

export const overlay = {
  liveTranscription: 'Live transcription',
} as const;

export const runtime = {
  chooseTranslationModel: 'Choose a GGUF translation model from the configured directory.',
  chooseWhisperModel: 'Choose a Whisper model from the configured directory.',
  llamaHealthWorkerFailed: 'llama.cpp health check failed: {{error}}',
  llamaRuntimeLockPoisoned: 'llama.cpp runtime lock failed',
  modelDirectoryCannotBeRead: '{{label}} model directory cannot be read at {{path}}: {{error}}',
  modelDirectoryEmpty: '{{label}} model directory is empty',
  modelDirectoryMissing: '{{label}} model directory is missing at {{path}}',
  modelDirectoryMustBeFolder: '{{label}} model directory must point to a folder',
  modelDirectoryUnavailable: '{{label}} model directory is unavailable: {{error}}',
  modelPath: '{{path}}',
  translationModelLoadFailed: 'Failed to load local translation model: {{error}}',
  translationRuntimeBusy: 'Translation is still finishing the previous segment',
  translationRuntimeShuttingDown: 'Translation is shutting down',
  whisperModelNotConfigured:
    'Whisper model is not configured. Set a local model directory and choose a .bin model in Settings.',
  whisperModelNotReady: 'Whisper model is not ready: {{error}}',
  whisperWorkerFailed: 'Whisper worker failed: {{error}}',
} as const;

export const settings = {
  about: {
    repository: 'GitHub repository',
    version: 'Version',
    website: 'Website',
  },
  interface: {
    uiLanguage: 'UI language',
    uiLanguageHint: 'Choose the Relay interface language.',
  },
  overlay: {
    alwaysOnTop: 'Always on top',
    alwaysOnTopDetail: 'Keep the overlay above other windows while it is visible.',
  },
  rawConfig: {
    loadFailed: 'Unable to load the config preview.',
    openFolder: 'Open config folder',
    title: 'Config',
  },
  sections: {
    about: {
      description: 'Information about the application.',
      label: 'About',
    },
    inputs: {
      description: 'Audio input and system audio sources.',
      label: 'Inputs',
    },
    interface: {
      description: 'Interface language.',
      label: 'Interface',
    },
    logs: {
      description: 'Application logs and diagnostics.',
      label: 'Logs',
    },
    overlay: {
      description: 'Overlay window behavior.',
      label: 'Overlay',
    },
    rawConfig: {
      description: 'View the configuration file.',
      label: 'Config',
    },
    shortcuts: {
      description: 'Keyboard shortcuts for Relay actions.',
      label: 'Shortcuts',
    },
    transcription: {
      description: 'Speech-to-text settings.',
      label: 'Transcription',
    },
    translation: {
      description: 'Local translation settings.',
      label: 'Translation',
    },
  },
  shortcuts: {
    descriptionPrefix:
      'Edit shortcut text, then press Enter or click outside the field to save. Use modifiers and keys joined with "+", for example CmdOrCtrl+Shift+L.',
    shortcutAria: '{{label}} shortcut',
    syntaxLink: 'Supported keys (Tauri source code)',
    title: 'Global shortcuts',
    toggleListening: 'Toggle listening',
    toggleOverlay: 'Show / hide overlay',
  },
  title: 'Settings',
  transcription: {
    browseModels: 'Browse Whisper models on Hugging Face',
    hop: 'Audio step',
    hopHint:
      'Seconds between overlapping decodes, from {{min}} to {{max}}. Lower updates more often and costs more CPU.',
    modelDescription: 'Set the root directory, then choose a model from the list.',
    modelTitle: 'Transcription model',
    modelsDirectory: 'Whisper models directory',
    modelsDirectoryHint:
      'Relay scans the selected folder up to {{depth}} levels deep for {{extensions}} files. Press Enter or click outside the field to save.',
    note: 'Whisper GGML {{extensions}} models are supported here. Multilingual models cover many languages. English-only variants, with "en" in the name, are faster but they will not handle mixed or non-English speech.',
    sentenceTimeout: 'Sentence timeout',
    sentenceTimeoutHint:
      'Milliseconds before a partial sentence is shown, from {{min}} to {{max}}. Lower feels faster; higher waits for cleaner sentence boundaries.',
    threads: 'Whisper CPU threads',
    threadsHint:
      'Threads used by Whisper, from {{min}} to {{max}}. More threads can be faster until CPU load or heat becomes the bottleneck.',
    window: 'Audio window',
    windowHint:
      'Seconds per Whisper decode, from {{min}} to {{max}}. Lower reduces latency; higher gives more speech context.',
  },
  translation: {
    browseModels: 'Browse translation model candidates on Hugging Face',
    contextTokens: 'Context tokens',
    contextTokensHint:
      'llama.cpp context window, from {{min}} to {{max}}. Higher fits longer prompts and outputs but uses more memory.',
    maxTokens: 'Token limit',
    maxTokensHint:
      'Translation token limit per segment, from {{min}} to {{max}}. Lower is faster. Higher helps longer sentences.',
    modelDescription: 'Set the root directory, then choose a model from the list.',
    modelTitle: 'Translation model',
    modelsDirectory: 'Translation models directory',
    modelsDirectoryHint:
      'Relay scans the selected folder up to {{depth}} levels deep for {{extensions}} files. Press Enter or click outside the field to save.',
    note: 'Use llama.cpp-compatible instruct or chat GGUF models. The Hugging Face filter below is a good starting point, but every result still needs a chat template and practical translation quality. Sampling is greedy in the current runtime, so there is no temperature setting to tune.',
    targetLanguage: 'Target language',
    targetLanguageHint:
      'Use an ISO code like de or ja, or type a custom language name, for example Brazilian Portuguese.',
    threads: 'llama.cpp CPU threads',
    threadsHint:
      'Threads used by translation, from {{min}} to {{max}}. More threads can be faster until CPU load or heat becomes the bottleneck.',
  },
  version: 'Relay v{{version}}',
} as const;

export const source = {
  activeDefaultInputDevice: 'Capturing the default input device',
  activeDefaultOutputLoopback: 'Capturing the default output device loopback',
  activePipeWire: 'Capturing system audio through PipeWire',
  activePulseAudio: 'Capturing system audio through PulseAudio',
  audioStreamError: 'Audio stream error. Check the selected device and permissions.',
  defaultInputDeviceUnavailable: 'Default input device is unavailable: {{error}}',
  defaultOutputDeviceUnavailable: 'Default output device is unavailable: {{error}}',
  installLinuxCaptureTool: 'Install pw-record or parec to capture system audio on Linux',
  microphoneDisabled: 'Microphone disabled in settings',
  microphoneUnavailable: 'Microphone capture is unavailable',
  readyDefaultInputDevice: 'Ready to capture the default input device',
  readyDefaultOutputLoopback: 'Ready to capture the default output device loopback',
  readyPipeWire: 'Ready to capture system audio through PipeWire',
  readyPipeWireWithPulseFallback:
    'Ready to capture system audio through PipeWire, with PulseAudio fallback',
  readyPulseAudio: 'Ready to capture system audio through PulseAudio',
  systemAudioDisabled: 'System audio disabled in settings',
  systemAudioLoopbackDescription:
    'System audio capture uses the default output device loopback when available',
  systemAudioNeedsLoopback:
    'System audio capture needs a default output device with loopback support',
  systemAudioUnavailable: 'System audio capture is unavailable',
  systemAudioUnsupported: 'System audio capture is not supported on this platform',
  usesDefaultInputDevice: 'Uses the default input device',
} as const;

export const targetLanguage = {
  ariaLabel: 'Target language',
  placeholder: 'Search or type custom code',
  useCustom: 'Use custom language "{{value}}"',
} as const;

const resources = {
  app,
  boot,
  common,
  controls,
  diagnostics,
  listening,
  logs,
  models,
  overlay,
  runtime,
  settings,
  source,
  targetLanguage,
} as const;

export default {
  code: 'en',
  label: 'English',
  nativeLabel: 'English',
  resources,
} as const;

export { resources };
