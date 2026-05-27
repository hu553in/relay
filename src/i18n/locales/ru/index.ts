export const app = {
  name: 'Relay',
  toastTitle: 'Relay',
  windowTitleControls: 'Relay — управление',
  windowTitleOverlay: 'Relay — оверлей',
  windowTitleSettings: 'Relay — настройки',
} as const;

export const boot = {
  constantsError: 'Не удалось загрузить константы приложения: {{error}}',
  loadingConstants: 'Загрузка констант Relay...',
  loadingOverview: 'Загрузка состояния Relay...',
  loadingSettings: 'Загрузка настроек Relay...',
} as const;

export const common = {
  active: 'Активно',
  autoScrollEnabled: 'Автопрокрутка включена',
  available: 'Доступно',
  browse: 'Выбрать',
  browsingHistory: 'История',
  clearLog: 'Очистить лог',
  copyLog: 'Скопировать лог',
  degraded: 'Нестабильно',
  disabled: 'Отключено',
  dismiss: 'Закрыть',
  error: 'Ошибка',
  failed: 'Сбой',
  idle: 'Ожидание',
  info: 'Информация',
  jumpToLatest: 'К последним',
  lineCount_one: '{{count}} строка',
  lineCount_few: '{{count}} строки',
  lineCount_many: '{{count}} строк',
  lineCount_other: '{{count}} строки',
  live: 'Live',
  missing: 'Отсутствует',
  notSelected: 'Не выбрано',
  ready: 'Готово',
  starting: 'Запуск',
  unavailable: 'Недоступно',
  unknown: 'Неизвестно',
  warning: 'Предупреждение',
} as const;

export const controls = {
  appCpu: 'CPU приложения',
  appMemory: 'Память приложения',
  hideOverlay: 'Скрыть оверлей',
  hideStats: 'Скрыть статистику',
  inputLevel: 'Уровень сигнала',
  inputUnavailable: 'Источник звука недоступен',
  liveSession: 'Текущая сессия',
  microphone: 'Микрофон',
  noModelSelected: 'Модель не выбрана',
  openSettings: 'Открыть настройки',
  segments: 'Сегменты',
  showOverlay: 'Показать оверлей',
  showStats: 'Показать статистику',
  systemAudio: 'Звук системы',
  systemCpu: 'CPU системы',
  systemMemory: 'Память системы',
  temperatureSensors: 'Датчики температуры',
  transcription: 'Распознавание',
  translated: 'Переведено',
} as const;

export const diagnostics = {
  audioCaptureFailed: 'Не удалось захватить звук системы: {{error}}',
  audioCaptureStopped: 'Захват звука системы неожиданно остановился',
  audioMicrophoneStarted: 'Аудио: захват микрофона запущен',
  audioReaderFailed: 'Ошибка чтения звука системы: {{error}}',
  audioSystemStarted: 'Аудио: loopback-захват системного звука запущен',
  globalShortcutFailed: 'Ошибка глобальной горячей клавиши: {{error}}',
  globalShortcutSnapshotFailed: 'Не удалось обработать глобальную горячую клавишу: {{error}}',
  globalShortcutsRegisterFailed:
    'Горячие клавиши сохранены, но их не удалось зарегистрировать: {{error}}',
  globalShortcutsUnavailable: 'Глобальные горячие клавиши недоступны: {{error}}',
  listeningStopped: 'Распознавание остановлено',
  microphoneStreamFailed: 'Ошибка потока микрофона: {{error}}',
  noInput: 'Включите доступный микрофон или системный звук перед запуском распознавания.',
  recommendedDirectoryChangedTranscription:
    'Модель распознавания речи загружена в {{path}}, но папка моделей была изменена до выбора.',
  recommendedDirectoryChangedTranslation:
    'Модель перевода загружена в {{path}}, но папка моделей была изменена до выбора.',
  recommendedDownloadTranscription: 'Загрузка рекомендованной модели распознавания речи',
  recommendedDownloadTranslation: 'Загрузка рекомендованной модели перевода',
  recommendedFailedTranscription: 'Не удалось загрузить модель распознавания речи: {{error}}',
  recommendedFailedTranslation: 'Не удалось загрузить модель перевода: {{error}}',
  recommendedReadyTranscription: 'Рекомендованная модель распознавания речи готова: {{path}}',
  recommendedReadyTranslation: 'Рекомендованная модель перевода готова: {{path}}',
  restartAfterSettings: 'Настройки изменены. Перезапускаем обработку аудио.',
  settingsParseFailed:
    'Не удалось разобрать файл настроек {{path}}. До следующего сохранения будут использоваться значения по умолчанию: {{error}}',
  settingsReadFailed:
    'Не удалось прочитать файл настроек {{path}}. До следующего сохранения будут использоваться значения по умолчанию: {{error}}',
  shortcutDefaultInvalidToggleListening:
    'Горячая клавиша по умолчанию для распознавания {{fallback}} некорректна. Используется встроенный резервный вариант {{baseline}}',
  shortcutDefaultInvalidToggleOverlay:
    'Горячая клавиша по умолчанию для оверлея {{fallback}} некорректна. Используется встроенный резервный вариант {{baseline}}',
  shortcutDuplicateToggleOverlay:
    'Горячая клавиша показа/скрытия оверлея совпала с другим действием. Используется вариант {{fallback}}',
  shortcutInvalidToggleListening:
    'Горячая клавиша переключения распознавания некорректна. Используется вариант {{fallback}}',
  shortcutInvalidToggleOverlay:
    'Горячая клавиша показа/скрытия оверлея некорректна. Используется вариант {{fallback}}',
  startFailed: 'Не удалось запустить распознавание: {{error}}',
  stoppedAfterSettings:
    'Настройки изменены. Распознавание остановлено, потому что выбранный источник звука или модель распознавания речи не готовы.',
  sttUnavailable: 'Выберите корректную модель Whisper перед запуском распознавания.',
  systemAudioStreamFailed: 'Ошибка потока системного звука: {{error}}',
  translationFailed: 'Ошибка перевода: {{error}}',
  unknownBackendMessage: 'Неизвестное сообщение бэкенда: {{code}}',
} as const;

export const listening = {
  listening: 'Распознавание',
  start: 'Начать распознавание',
  starting: 'Запуск',
  startingAction: 'Запуск...',
  stop: 'Остановить распознавание',
} as const;

export const logs = {
  clearDiagnostics: 'Очистить лог диагностики',
  clearTranscript: 'Очистить лог распознавания',
  clearTranslation: 'Очистить лог перевода',
  diagnostics: 'Диагностика',
  diagnosticsCleared: 'Диагностика очищена',
  emptyDiagnostics: 'Ожидание событий диагностики.',
  emptySegments: 'Ожидание live-сегментов.',
  failedCount_one: '{{count}} ошибка',
  failedCount_few: '{{count}} ошибки',
  failedCount_many: '{{count}} ошибок',
  failedCount_other: '{{count}} ошибки',
  logFileUnavailable: 'Файл лога недоступен',
  openLogFolder: 'Открыть папку логов',
  original: 'Оригинал',
  translatedCount_one: '{{count}} переведено',
  translatedCount_few: '{{count}} переведено',
  translatedCount_many: '{{count}} переведено',
  translatedCount_other: '{{count}} переведено',
  translation: 'Перевод',
  translationFailed: 'Ошибка перевода',
  translationPending: 'Ожидание перевода',
  translationUnavailable: 'Перевод недоступен',
} as const;

export const models = {
  active: 'Активна',
  available: 'Доступна',
  download: 'Загрузить модель',
  downloading: 'Загрузка...',
  empty: 'Локальные модели пока не найдены. Сначала выберите папку с моделями.',
  missing: 'Отсутствует',
  models: 'Модели',
  recommended: 'Рекомендованная',
  unknownSize: 'Размер неизвестен',
  use: 'Использовать модель',
} as const;

export const overlay = {
  liveTranscription: 'Распознавание в реальном времени',
} as const;

export const runtime = {
  chooseTranslationModel: 'Выберите GGUF-модель перевода из настроенной папки.',
  chooseWhisperModel: 'Выберите модель Whisper из настроенной папки.',
  llamaHealthWorkerFailed: 'Ошибка проверки llama.cpp: {{error}}',
  llamaRuntimeLockPoisoned: 'Ошибка блокировки llama.cpp',
  modelDirectoryCannotBeRead:
    'Не удалось прочитать папку моделей {{label}} по пути {{path}}: {{error}}',
  modelDirectoryEmpty: 'Папка моделей {{label}} пуста',
  modelDirectoryMissing: 'Папка моделей {{label}} отсутствует по пути {{path}}',
  modelDirectoryMustBeFolder: 'Путь к моделям {{label}} должен указывать на папку',
  modelDirectoryUnavailable: 'Папка моделей {{label}} недоступна: {{error}}',
  modelPath: '{{path}}',
  translationModelLoadFailed: 'Не удалось загрузить локальную модель перевода: {{error}}',
  translationRuntimeBusy: 'Перевод ещё завершает предыдущий сегмент',
  translationRuntimeShuttingDown: 'Перевод завершает работу',
  whisperModelNotConfigured:
    'Модель Whisper не настроена. Укажите локальную папку с моделями и выберите модель .bin в настройках.',
  whisperModelNotReady: 'Модель Whisper не готова: {{error}}',
  whisperWorkerFailed: 'Ошибка процесса Whisper: {{error}}',
} as const;

export const settings = {
  about: {
    repository: 'GitHub-репозиторий',
    version: 'Версия',
    website: 'Сайт',
  },
  interface: {
    uiLanguage: 'Язык интерфейса',
    uiLanguageHint: 'Выберите язык интерфейса Relay.',
  },
  overlay: {
    alwaysOnTop: 'Поверх всех окон',
    alwaysOnTopDetail: 'Держать оверлей поверх других окон, пока он видим.',
  },
  rawConfig: {
    loadFailed: 'Не удалось показать файл настроек.',
    openFolder: 'Открыть папку настроек',
    title: 'Файл настроек',
  },
  sections: {
    about: {
      description: 'Информация о приложении.',
      label: 'О приложении',
    },
    inputs: {
      description: 'Микрофон и источники системного звука.',
      label: 'Источники звука',
    },
    interface: {
      description: 'Язык интерфейса.',
      label: 'Интерфейс',
    },
    logs: {
      description: 'Логи приложения и диагностика.',
      label: 'Логи',
    },
    overlay: {
      description: 'Поведение окна оверлея.',
      label: 'Оверлей',
    },
    rawConfig: {
      description: 'Просмотр файла с текущими настройками.',
      label: 'Файл настроек',
    },
    shortcuts: {
      description: 'Горячие клавиши для действий Relay.',
      label: 'Горячие клавиши',
    },
    transcription: {
      description: 'Настройки распознавания речи.',
      label: 'Распознавание',
    },
    translation: {
      description: 'Настройки локального перевода.',
      label: 'Перевод',
    },
  },
  shortcuts: {
    descriptionPrefix:
      'Измените горячую клавишу, затем нажмите Enter или кликните вне поля для сохранения. Модификаторы и клавиши пишутся через "+", например CmdOrCtrl+Shift+L.',
    shortcutAria: 'Горячая клавиша: {{label}}',
    syntaxLink: 'Доступные клавиши (исходный код Tauri)',
    title: 'Глобальные горячие клавиши',
    toggleListening: 'Переключить распознавание',
    toggleOverlay: 'Показать / скрыть оверлей',
  },
  title: 'Настройки',
  transcription: {
    browseModels: 'Найти модели Whisper на Hugging Face',
    hop: 'Шаг аудио',
    hopHint:
      'Секунды между перекрывающимися окнами распознавания, от {{min}} до {{max}}. Меньше — чаще обновления и выше нагрузка на CPU.',
    modelDescription: 'Укажите папку с моделями, затем выберите модель из списка.',
    modelTitle: 'Модель распознавания речи',
    modelsDirectory: 'Папка моделей Whisper',
    modelsDirectoryHint:
      'Relay сканирует выбранную папку до {{depth}} уровней глубины в поиске файлов {{extensions}}. Нажмите Enter или кликните вне поля для сохранения.',
    note: 'Здесь поддерживаются модели Whisper GGML {{extensions}}. Мультиязычные модели покрывают много языков. English-only варианты с "en" в имени работают быстрее, но не подходят для смешанной или неанглийской речи.',
    sentenceTimeout: 'Таймаут предложения',
    sentenceTimeoutHint:
      'Миллисекунды до показа частичного предложения, от {{min}} до {{max}}. Меньше — быстрее ощущается; больше — чище границы предложений.',
    threads: 'CPU-потоки Whisper',
    threadsHint:
      'Потоки для Whisper, от {{min}} до {{max}}. Больше потоков может ускорить распознавание, пока не начнут мешать нагрузка на CPU или нагрев.',
    window: 'Окно аудио',
    windowHint:
      'Секунды на одно окно распознавания Whisper, от {{min}} до {{max}}. Меньше — ниже задержка; больше — больше речевого контекста.',
  },
  translation: {
    browseModels: 'Найти модели перевода на Hugging Face',
    contextTokens: 'Токены контекста',
    contextTokensHint:
      'Контекстное окно llama.cpp, от {{min}} до {{max}}. Больше — длиннее prompt и output, но выше расход памяти.',
    maxTokens: 'Лимит токенов',
    maxTokensHint:
      'Лимит токенов перевода на сегмент, от {{min}} до {{max}}. Меньше — быстрее. Больше помогает длинным предложениям.',
    modelDescription: 'Укажите папку с моделями, затем выберите модель из списка.',
    modelTitle: 'Модель перевода',
    modelsDirectory: 'Папка моделей перевода',
    modelsDirectoryHint:
      'Relay сканирует выбранную папку до {{depth}} уровней глубины в поиске файлов {{extensions}}. Нажмите Enter или кликните вне поля для сохранения.',
    note: 'Используйте instruct/chat GGUF-модели, совместимые с llama.cpp. Фильтр Hugging Face ниже — хорошая отправная точка. У каждой модели всё равно должен быть chat template и приемлемое качество перевода. Сейчас перевод использует greedy sampling, поэтому temperature не настраивается.',
    targetLanguage: 'Язык перевода',
    targetLanguageHint:
      'Используйте ISO-код вроде de или ja, либо введите название языка, например Portuguese.',
    threads: 'CPU-потоки llama.cpp',
    threadsHint:
      'Потоки для перевода, от {{min}} до {{max}}. Больше потоков может ускорить перевод, пока не начнут мешать нагрузка на CPU или нагрев.',
  },
  version: 'Relay v{{version}}',
} as const;

export const source = {
  activeDefaultInputDevice: 'Идёт захват устройства ввода по умолчанию',
  activeDefaultOutputLoopback: 'Идёт loopback-захват устройства вывода по умолчанию',
  activePipeWire: 'Идёт захват системного звука через PipeWire',
  activePulseAudio: 'Идёт захват системного звука через PulseAudio',
  audioStreamError: 'Ошибка аудиопотока. Проверьте выбранное устройство и разрешения.',
  defaultInputDeviceUnavailable: 'Устройство ввода по умолчанию недоступно: {{error}}',
  defaultOutputDeviceUnavailable: 'Устройство вывода по умолчанию недоступно: {{error}}',
  installLinuxCaptureTool:
    'Установите pw-record или parec, чтобы захватывать системный звук в Linux',
  microphoneDisabled: 'Микрофон отключён в настройках',
  microphoneUnavailable: 'Захват микрофона недоступен',
  readyDefaultInputDevice: 'Готов к захвату устройства ввода по умолчанию',
  readyDefaultOutputLoopback: 'Готов к loopback-захвату устройства вывода по умолчанию',
  readyPipeWire: 'Готов к захвату системного звука через PipeWire',
  readyPipeWireWithPulseFallback: 'Готов к захвату системного звука через PipeWire или PulseAudio',
  readyPulseAudio: 'Готов к захвату системного звука через PulseAudio',
  systemAudioDisabled: 'Системный звук отключён в настройках',
  systemAudioLoopbackDescription:
    'Захват системного звука использует loopback-захват устройства вывода по умолчанию, когда он доступен',
  systemAudioNeedsLoopback:
    'Для захвата системного звука нужно устройство вывода по умолчанию с поддержкой loopback-захвата',
  systemAudioUnavailable: 'Захват системного звука недоступен',
  systemAudioUnsupported: 'Захват системного звука не поддерживается на этой платформе',
  usesDefaultInputDevice: 'Используется устройство ввода по умолчанию',
} as const;

export const targetLanguage = {
  ariaLabel: 'Язык перевода',
  placeholder: 'Поиск или свой язык',
  useCustom: 'Использовать свой язык "{{value}}"',
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
  code: 'ru',
  label: 'Russian',
  nativeLabel: 'Русский',
  resources,
} as const;

export { resources };
