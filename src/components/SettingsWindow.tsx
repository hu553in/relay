import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from '@headlessui/react';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  AudioLines,
  Captions,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileCode2,
  FileSearchCorner,
  FolderOpen,
  Info,
  Keyboard,
  Languages,
  Logs,
  Mic,
  SquareTerminal,
} from 'lucide-react';
import { type PropsWithChildren, type ReactNode, useEffect, useId, useMemo, useState } from 'react';

import { InputSourceStatusCard } from '@/components/InputSourceStatusCard';
import { type LogEntry, SegmentLogPanel } from '@/components/SegmentLogPanel';
import { IntegerSettingField, MaxTokensField } from '@/components/settings/MaxTokensField';
import { PathInputField } from '@/components/settings/PathInputField';
import { ShortcutInputField } from '@/components/settings/ShortcutInputField';
import { Badge } from '@/components/shared/Badge';
import { HealthBadge } from '@/components/shared/HealthBadge';
import { ClearLogButton, IconButton } from '@/components/shared/IconButton';
import { Switch } from '@/components/shared/Switch';
import { WindowDragStrip, WindowShell } from '@/components/shared/WindowChrome';
import { ToastViewport } from '@/components/ToastViewport';
import { useAppConstants } from '@/hooks/useAppConstants';
import { useToastCenter } from '@/hooks/useToastCenter';
import { diagnosticLevelTone } from '@/lib/diagnostics';
import { toErrorMessage } from '@/lib/errors';
import { formatModelSize } from '@/lib/format';
import {
  clearDiagnostics,
  downloadRecommendedModel,
  getAppPaths,
  getConfigPreview,
  updateSettings,
} from '@/lib/relay';
import type {
  AppPaths,
  ModelKind,
  ModelRecord,
  ModelState,
  RelaySettings,
  RelaySnapshotState,
  ServiceHealth,
} from '@/lib/types';

type SettingsSection =
  | 'inputs'
  | 'transcription'
  | 'translation'
  | 'overlay'
  | 'shortcuts'
  | 'logs'
  | 'rawConfig'
  | 'about';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  nl: 'Nederlands',
  pl: 'Polski',
  pt: 'Português',
  ru: 'Русский',
  tr: 'Türkçe',
  uk: 'Українська',
  zh: '中文',
};

// Explicit order instead of relying on `Object.keys` insertion order.
const COMMON_LANGUAGES = [
  'en',
  'de',
  'es',
  'fr',
  'it',
  'ja',
  'ko',
  'nl',
  'pl',
  'pt',
  'ru',
  'tr',
  'uk',
  'zh',
];

interface SectionDescriptor {
  id: SettingsSection;
  label: string;
  icon: ReactNode;
  description: string;
}

const SECTION_ITEMS: SectionDescriptor[] = [
  {
    id: 'inputs',
    label: 'Inputs',
    icon: <Mic size={14} />,
    description: 'Audio capture sources configuration.',
  },
  {
    id: 'transcription',
    label: 'Transcription',
    icon: <AudioLines size={14} />,
    description: 'Transcription configuration.',
  },
  {
    id: 'translation',
    label: 'Translation',
    icon: <Languages size={14} />,
    description: 'Translation configuration.',
  },
  {
    id: 'overlay',
    label: 'Overlay',
    icon: <Captions size={14} />,
    description: 'Overlay window behavior options.',
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    icon: <Keyboard size={14} />,
    description: 'Key application functionality shortcuts.',
  },
  { id: 'logs', label: 'Logs', icon: <Logs size={14} />, description: 'Application logs history.' },
  {
    id: 'rawConfig',
    label: 'Raw config',
    icon: <FileCode2 size={14} />,
    description: 'Read-only preview of the configuration file.',
  },
  {
    id: 'about',
    label: 'About',
    icon: <Info size={14} />,
    description: 'Information about the application.',
  },
];

const SECTION_BY_ID: Record<SettingsSection, SectionDescriptor> = Object.fromEntries(
  SECTION_ITEMS.map(item => [item.id, item])
) as Record<SettingsSection, SectionDescriptor>;

const MODEL_STATE_LABELS: Record<ModelState, string> = {
  active: 'Active',
  available: 'Available',
  missing: 'Missing',
};

const MODEL_STATE_ORDER: Record<ModelState, number> = {
  active: 0,
  available: 1,
  missing: 2,
};

function compareModelRecords(left: ModelRecord, right: ModelRecord) {
  if (left.recommended !== right.recommended) {
    return left.recommended ? -1 : 1;
  }
  const stateDelta = MODEL_STATE_ORDER[left.state] - MODEL_STATE_ORDER[right.state];
  if (stateDelta !== 0) return stateDelta;
  return left.relativePath.localeCompare(right.relativePath);
}

export function SettingsWindow({ relay }: { relay: RelaySnapshotState }) {
  const snapshot = relay.snapshot;
  const [activeSection, setActiveSection] = useState<SettingsSection>('inputs');
  const [version, setVersion] = useState('0.1.0');
  const [configPreview, setConfigPreview] = useState('');
  const [appPaths, setAppPaths] = useState<AppPaths | null>(null);
  const [downloadingModelKind, setDownloadingModelKind] = useState<ModelKind | null>(null);
  const constants = useAppConstants();
  const { toasts, pushToast, dismissToast } = useToastCenter(snapshot?.diagnostics ?? []);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;

    void getVersion().then(value => {
      if (mounted) setVersion(value);
    });
    void getConfigPreview()
      .then(value => {
        if (mounted) setConfigPreview(value);
      })
      .catch(() => {
        if (mounted) setConfigPreview('');
      });
    void getAppPaths().then(value => {
      if (mounted) setAppPaths(value);
    });

    void listen<string>(constants.settingsNavigateEvent, event => {
      const nextSection = SECTION_ITEMS.find(item => item.id === event.payload)?.id ?? 'inputs';
      setActiveSection(nextSection);
    }).then(cleanup => {
      if (mounted) {
        unlisten = cleanup;
      } else {
        cleanup();
      }
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [constants.settingsNavigateEvent]);

  const settings = snapshot?.settings;
  const allModels = snapshot?.models;
  const sttSelectedModel = settings?.sttSelectedModel;
  const translationSelectedModel = settings?.translation.selectedModel;
  const diagnostics = snapshot?.diagnostics;

  const transcriptionModels = useMemo(
    () =>
      (allModels ?? [])
        .filter(model => model.kind === 'transcription')
        .map(model => ({
          ...model,
          state:
            model.relativePath === sttSelectedModel && model.state !== 'missing'
              ? ('active' as const)
              : model.state,
        }))
        .sort(compareModelRecords),
    [allModels, sttSelectedModel]
  );
  const translationModels = useMemo(
    () =>
      (allModels ?? [])
        .filter(model => model.kind === 'translation')
        .map(model => ({
          ...model,
          state:
            model.relativePath === translationSelectedModel && model.state !== 'missing'
              ? ('active' as const)
              : model.state,
        }))
        .sort(compareModelRecords),
    [allModels, translationSelectedModel]
  );
  const diagnosticsEntries: LogEntry[] = useMemo(
    () =>
      [...(diagnostics ?? [])].reverse().map(entry => ({
        id: `diagnostic-${entry.id}`,
        timestampMs: entry.timestampMs,
        text: entry.message,
        tone: diagnosticLevelTone(entry.level),
      })),
    [diagnostics]
  );

  if (relay.isLoading || !snapshot || !settings) {
    return <WindowShell message={relay.error ?? 'Loading Relay settings...'} />;
  }

  const notifyError = (reason: unknown) => {
    pushToast({ title: 'Relay', message: toErrorMessage(reason), tone: 'error' });
  };

  const runWithErrorToast = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (reason: unknown) {
      notifyError(reason);
    }
  };

  const refreshConfigPreview = async () => {
    try {
      setConfigPreview(await getConfigPreview());
    } catch {
      setConfigPreview('');
    }
  };

  const applySettings = async (next: RelaySettings) => {
    try {
      await updateSettings(next);
      await refreshConfigPreview();
    } catch (reason: unknown) {
      notifyError(reason);
    }
  };

  const pickModelDirectory = async (kind: ModelKind) => {
    const selected = await open({ multiple: false, directory: true });
    if (typeof selected !== 'string') return;

    const next =
      kind === 'transcription'
        ? { ...settings, sttModelPath: selected, sttSelectedModel: '' }
        : {
            ...settings,
            translation: {
              ...settings.translation,
              modelPath: selected,
              selectedModel: '',
            },
          };
    await applySettings(next);
  };

  const chooseModel = async (kind: ModelKind, model: ModelRecord) => {
    const next =
      kind === 'transcription'
        ? { ...settings, sttSelectedModel: model.relativePath }
        : {
            ...settings,
            translation: {
              ...settings.translation,
              selectedModel: model.relativePath,
            },
          };
    await applySettings(next);
  };

  const downloadRecommended = async (kind: ModelKind) => {
    if (downloadingModelKind !== null) return;
    setDownloadingModelKind(kind);
    try {
      await downloadRecommendedModel(kind);
      await refreshConfigPreview();
    } catch (reason: unknown) {
      notifyError(reason);
    } finally {
      setDownloadingModelKind(null);
    }
  };

  const active = SECTION_BY_ID[activeSection];

  return (
    <main className='bg-(--relay-app-bg) flex h-screen w-screen flex-col overflow-hidden text-stone-100'>
      <WindowDragStrip />
      <div className='flex min-h-0 flex-1'>
        <aside className='flex h-full w-52 shrink-0 flex-col border-r border-white/6 bg-[rgba(15,15,14,0.82)] px-2.5 pb-3 pt-3'>
          <div className='rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2.5'>
            <p className='text-[12.5px] font-semibold text-white'>Settings</p>
            <p className='mt-0.5 text-[10.5px] text-stone-500'>Relay v{version}</p>
          </div>

          <nav className='relay-scroll mt-2.5 grid gap-0.5 overflow-y-auto pr-1'>
            {SECTION_ITEMS.map(item => (
              <NavButton
                key={item.id}
                label={item.label}
                icon={item.icon}
                active={item.id === activeSection}
                onClick={() => {
                  setActiveSection(item.id);
                }}
              />
            ))}
          </nav>
        </aside>

        <section className='relay-scroll flex-1 overflow-y-auto'>
          <div className='sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/6 bg-[rgba(31,31,29,0.96)] px-5 py-3'>
            <div>
              <h1 className='text-[17px] font-semibold text-white'>{active.label}</h1>
              <p className='mt-0.5 text-[11.5px] text-stone-400'>{active.description}</p>
            </div>
          </div>

          <div className='mx-auto w-full max-w-230 px-5 py-4'>
            {activeSection === 'inputs' ? (
              <SectionGrid cols={2}>
                <InputSourceStatusCard
                  title='Microphone'
                  source={snapshot.microphone}
                  onToggle={enabled => {
                    void applySettings({ ...settings, microphoneEnabled: enabled });
                  }}
                />
                <InputSourceStatusCard
                  title='System audio'
                  source={snapshot.systemAudio}
                  onToggle={enabled => {
                    void applySettings({ ...settings, systemAudioEnabled: enabled });
                  }}
                />
              </SectionGrid>
            ) : null}

            {activeSection === 'transcription' ? (
              <SectionGrid>
                <SectionCard
                  title='Transcription model'
                  description='Set the root directory, then choose a model from the list.'
                  action={<HealthBadge health={snapshot.sttHealth} />}
                >
                  <HealthMessage health={snapshot.sttHealth} detail={snapshot.sttDetail} />
                  <Field
                    label='Whisper models directory'
                    hint={`App scans this folder and all subfolders (up to ${String(constants.maxModelWalkDepth)} levels deep) for ${constants.whisperModelExtensions.map(e => `.${e}`).join(', ')} files. Symlink loops are skipped automatically. Press Enter or click away to save manual edits.`}
                  >
                    <PathInputField
                      value={settings.sttModelPath}
                      placeholder='/Users/you/models/whisper'
                      onCommit={value => {
                        void applySettings({
                          ...settings,
                          sttModelPath: value,
                          sttSelectedModel:
                            value.trim() === settings.sttModelPath.trim()
                              ? settings.sttSelectedModel
                              : '',
                        });
                      }}
                      onBrowse={() => void pickModelDirectory('transcription')}
                    />
                  </Field>
                  <Field label='Models'>
                    <ModelsList
                      kind='transcription'
                      models={transcriptionModels}
                      onUse={chooseModel}
                      onDownload={downloadRecommended}
                      downloading={downloadingModelKind !== null}
                    />
                  </Field>
                  <Field
                    label='Whisper CPU threads'
                    hint={`Threads used by Whisper (${String(constants.minWorkerThreads)} to ${String(constants.maxWorkerThreads)}). Higher can transcribe faster until CPU contention or heat dominates.`}
                  >
                    <IntegerSettingField
                      value={settings.sttThreads}
                      min={constants.minWorkerThreads}
                      max={constants.maxWorkerThreads}
                      fallback={constants.defaultTranscriptionThreads}
                      onCommit={next => {
                        void applySettings({ ...settings, sttThreads: next });
                      }}
                    />
                  </Field>
                  <Field
                    label='Audio window'
                    hint={`Seconds per Whisper decode (${String(constants.minTranscriptionWindowSeconds)} to ${String(constants.maxTranscriptionWindowSeconds)}). Lower reduces latency; higher gives more speech context.`}
                  >
                    <IntegerSettingField
                      value={settings.sttWindowSeconds}
                      min={constants.minTranscriptionWindowSeconds}
                      max={constants.maxTranscriptionWindowSeconds}
                      fallback={constants.defaultTranscriptionWindowSeconds}
                      onCommit={next => {
                        void applySettings({ ...settings, sttWindowSeconds: next });
                      }}
                    />
                  </Field>
                  <Field
                    label='Audio hop'
                    hint={`Seconds between overlapping decodes (${String(constants.minTranscriptionHopSeconds)} to ${String(constants.maxTranscriptionHopSeconds)}). Lower updates more often and costs more CPU.`}
                  >
                    <IntegerSettingField
                      value={settings.sttHopSeconds}
                      min={constants.minTranscriptionHopSeconds}
                      max={constants.maxTranscriptionHopSeconds}
                      fallback={constants.defaultTranscriptionHopSeconds}
                      onCommit={next => {
                        void applySettings({ ...settings, sttHopSeconds: next });
                      }}
                    />
                  </Field>
                  <Field
                    label='Sentence timeout'
                    hint={`Milliseconds before a partial sentence is emitted (${String(constants.minTranscriptionSentenceTimeoutMs)} to ${String(constants.maxTranscriptionSentenceTimeoutMs)}). Lower feels faster; higher waits for cleaner sentence boundaries.`}
                  >
                    <IntegerSettingField
                      value={settings.sttSentenceTimeoutMs}
                      min={constants.minTranscriptionSentenceTimeoutMs}
                      max={constants.maxTranscriptionSentenceTimeoutMs}
                      fallback={constants.defaultTranscriptionSentenceTimeoutMs}
                      onCommit={next => {
                        void applySettings({ ...settings, sttSentenceTimeoutMs: next });
                      }}
                    />
                  </Field>
                  <InlineNote>
                    Whisper GGML *.{constants.whisperModelExtensions.join(', *.')} models are
                    supported here. Multilingual models cover many languages. English-only variants
                    (with &quot;en&quot; in name) are faster, but they will not handle mixed or
                    non-English speech.
                  </InlineNote>
                  <BrowseLinkRow
                    label='Browse Whisper transcription models on Hugging Face'
                    onClick={() => {
                      void openUrl('https://huggingface.co/ggerganov/whisper.cpp/tree/main');
                    }}
                    icon={<FileSearchCorner size={14} />}
                  />
                </SectionCard>
              </SectionGrid>
            ) : null}

            {activeSection === 'translation' ? (
              <SectionGrid>
                <SectionCard
                  title='Translation model'
                  description='Set the root directory, then choose a model from the list.'
                  action={<HealthBadge health={snapshot.translationHealth} />}
                >
                  <HealthMessage
                    health={snapshot.translationHealth}
                    detail={snapshot.translationDetail}
                  />
                  <Field
                    label='Target language'
                    hint='Use an ISO code like de or ja, or type a custom language name such as Brazilian Portuguese.'
                  >
                    <LanguageCombobox
                      value={settings.translation.targetLanguage}
                      onChange={next => {
                        void applySettings({
                          ...settings,
                          translation: { ...settings.translation, targetLanguage: next },
                        });
                      }}
                    />
                  </Field>
                  <Field
                    label='Translation models directory'
                    hint={`App scans this folder and all subfolders (up to ${String(constants.maxModelWalkDepth)} levels deep) for ${constants.translationModelExtensions.map(e => `.${e}`).join(', ')} files. Symlink loops are skipped automatically. Press Enter or click away to save manual edits.`}
                  >
                    <PathInputField
                      value={settings.translation.modelPath}
                      placeholder='/Users/you/models/translation'
                      onCommit={value => {
                        void applySettings({
                          ...settings,
                          translation: {
                            ...settings.translation,
                            modelPath: value,
                            selectedModel:
                              value.trim() === settings.translation.modelPath.trim()
                                ? settings.translation.selectedModel
                                : '',
                          },
                        });
                      }}
                      onBrowse={() => void pickModelDirectory('translation')}
                    />
                  </Field>
                  <Field label='Models'>
                    <ModelsList
                      kind='translation'
                      models={translationModels}
                      onUse={chooseModel}
                      onDownload={downloadRecommended}
                      downloading={downloadingModelKind !== null}
                    />
                  </Field>
                  <Field
                    label='Max tokens'
                    hint={`Max generated translation tokens per segment (${String(constants.minGenerationTokens)} to ${String(constants.maxGenerationTokens)}). Lower is faster. Higher helps longer sentences. Values outside this range are clamped.`}
                  >
                    <MaxTokensField
                      value={settings.translation.maxTokens}
                      onCommit={next => {
                        void applySettings({
                          ...settings,
                          translation: { ...settings.translation, maxTokens: next },
                        });
                      }}
                    />
                  </Field>
                  <Field
                    label='Context tokens'
                    hint={`llama.cpp context window (${String(constants.minTranslationContextTokens)} to ${String(constants.maxTranslationContextTokens)}). Higher fits longer prompts and outputs but uses more memory.`}
                  >
                    <IntegerSettingField
                      value={settings.translation.contextTokens}
                      min={constants.minTranslationContextTokens}
                      max={constants.maxTranslationContextTokens}
                      fallback={constants.defaultTranslationContextTokens}
                      onCommit={next => {
                        void applySettings({
                          ...settings,
                          translation: { ...settings.translation, contextTokens: next },
                        });
                      }}
                    />
                  </Field>
                  <Field
                    label='llama.cpp CPU threads'
                    hint={`Threads used by translation (${String(constants.minWorkerThreads)} to ${String(constants.maxWorkerThreads)}). Higher can be faster until CPU contention or heat dominates.`}
                  >
                    <IntegerSettingField
                      value={settings.translation.threads}
                      min={constants.minWorkerThreads}
                      max={constants.maxWorkerThreads}
                      fallback={constants.defaultTranslationThreads}
                      onCommit={next => {
                        void applySettings({
                          ...settings,
                          translation: { ...settings.translation, threads: next },
                        });
                      }}
                    />
                  </Field>
                  <InlineNote>
                    Use llama.cpp-compatible instruct or chat GGUF models. The Hugging Face filter
                    below is a good starting point, but every result still needs a chat template and
                    practical translation quality. Sampling is greedy in the current runtime, so
                    there is no temperature setting to tune.
                  </InlineNote>
                  <BrowseLinkRow
                    label='Browse translation model candidates on Hugging Face'
                    onClick={() => {
                      void openUrl(
                        'https://huggingface.co/models?pipeline_tag=translation&library=gguf&apps=llama.cpp'
                      );
                    }}
                    icon={<FileSearchCorner size={14} />}
                  />
                </SectionCard>
              </SectionGrid>
            ) : null}

            {activeSection === 'shortcuts' ? (
              <SectionGrid>
                <SectionCard
                  title='Global shortcuts'
                  description={
                    <>
                      Edit shortcut text, then press Enter or click away to save. Use modifiers and
                      keys joined with &quot;+&quot;, for example CmdOrCtrl+Shift+L.{' '}
                      <button
                        type='button'
                        className='text-stone-200 underline decoration-white/20 underline-offset-3 transition hover:text-white hover:decoration-white/45'
                        onClick={() => {
                          void openUrl('https://tauri.app/reference/javascript/global-shortcut/');
                        }}
                      >
                        Tauri shortcut syntax
                      </button>
                      .
                    </>
                  }
                >
                  <ShortcutRow
                    label='Toggle listening'
                    value={settings.shortcuts.toggleListening}
                    onCommit={value => {
                      void applySettings({
                        ...settings,
                        shortcuts: { ...settings.shortcuts, toggleListening: value },
                      });
                    }}
                  />
                  <ShortcutRow
                    label='Show / hide overlay'
                    value={settings.shortcuts.toggleOverlay}
                    onCommit={value => {
                      void applySettings({
                        ...settings,
                        shortcuts: { ...settings.shortcuts, toggleOverlay: value },
                      });
                    }}
                  />
                  {snapshot.shortcutWarnings.length > 0 ? (
                    <div className='grid gap-2'>
                      {snapshot.shortcutWarnings.map(warning => (
                        <div
                          key={warning}
                          className='rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2.5 text-[12px] leading-5 text-amber-100'
                        >
                          {warning}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </SectionCard>
              </SectionGrid>
            ) : null}

            {activeSection === 'overlay' ? (
              <SectionGrid>
                <ToggleRow
                  label='Always on top'
                  detail='Keep the overlay above other windows while it is visible.'
                  checked={settings.overlay.alwaysOnTop}
                  onChange={checked => {
                    void applySettings({
                      ...settings,
                      overlay: { ...settings.overlay, alwaysOnTop: checked },
                    });
                  }}
                />
              </SectionGrid>
            ) : null}

            {activeSection === 'logs' ? (
              <SectionGrid>
                <div className='min-h-155'>
                  <SegmentLogPanel
                    title='Diagnostics'
                    icon={<SquareTerminal size={16} />}
                    entries={diagnosticsEntries}
                    onCopyError={notifyError}
                    actions={
                      <>
                        <IconButton
                          label='Open log folder'
                          icon={<FolderOpen size={14} />}
                          onClick={() => {
                            if (appPaths?.diagnosticsLogFile) {
                              void runWithErrorToast(() =>
                                revealItemInDir(appPaths.diagnosticsLogFile)
                              );
                            }
                          }}
                        />
                        <ClearLogButton
                          label='Clear diagnostics log'
                          disabled={diagnosticsEntries.length === 0}
                          onClick={() => {
                            void clearDiagnostics()
                              .then(() => {
                                pushToast({
                                  title: 'Relay',
                                  message: 'Diagnostics cleared',
                                  tone: 'success',
                                });
                              })
                              .catch(notifyError);
                          }}
                        />
                      </>
                    }
                    footer={
                      <div className='flex w-full items-center justify-between gap-3'>
                        <span>{diagnosticsEntries.length} lines</span>
                        <span>{appPaths?.diagnosticsLogFile ?? 'Log file unavailable'}</span>
                      </div>
                    }
                    emptyText='Waiting for diagnostic events.'
                  />
                </div>
              </SectionGrid>
            ) : null}

            {activeSection === 'rawConfig' ? (
              <SectionGrid>
                <SectionCard
                  title='Raw config'
                  action={
                    <IconButton
                      label='Open config folder'
                      icon={<FolderOpen size={14} />}
                      onClick={() => {
                        if (appPaths?.configFile) {
                          void runWithErrorToast(() => revealItemInDir(appPaths.configFile));
                        }
                      }}
                    />
                  }
                >
                  <TomlPreview content={configPreview || 'Unable to load config preview.'} />
                </SectionCard>
              </SectionGrid>
            ) : null}

            {activeSection === 'about' ? (
              <SectionGrid>
                <LabeledInfoRow label='Version' value={version} />
                <LabeledInfoRow
                  label='Developer'
                  value='Ruslan Khasanshin <r.m.khasanshin@gmail.com>'
                  onClick={() => {
                    void openUrl('mailto:r.m.khasanshin@gmail.com');
                  }}
                />
                <LabeledInfoRow
                  label='Website'
                  value='hu553in.su'
                  onClick={() => {
                    void openUrl('https://hu553in.su');
                  }}
                  icon={<ExternalLink size={14} />}
                />
              </SectionGrid>
            ) : null}
          </div>
        </section>
      </div>

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}

function NavButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] transition ${
        active ? 'bg-white/6 text-white' : 'text-stone-300 hover:bg-white/7 hover:text-white'
      }`}
    >
      <span
        className={`grid h-4.5 w-4.5 place-items-center text-[11.5px] ${
          active ? 'text-stone-100' : 'text-stone-400'
        }`}
      >
        {icon}
      </span>
      <span className='flex-1 text-left'>{label}</span>
    </button>
  );
}

function SectionGrid({ cols = 1, children }: PropsWithChildren<{ cols?: 1 | 2 }>) {
  return <div className={`grid gap-2.5 ${cols === 2 ? 'lg:grid-cols-2' : ''}`}>{children}</div>;
}

function SectionCard({
  title,
  description,
  action,
  children,
}: PropsWithChildren<{ title: string; description?: ReactNode; action?: ReactNode }>) {
  return (
    <section className='rounded-xl border border-white/6 bg-(--relay-card-bg) p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.14)]'>
      <div className='mb-2.5 flex items-start justify-between gap-3'>
        <div>
          <h2 className='text-[13px] font-medium text-white'>{title}</h2>
          {description ? (
            <p className='mt-0.5 text-[11.5px] leading-5 text-stone-400'>{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className='grid gap-2.5'>{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: PropsWithChildren<{ label: string; hint?: string }>) {
  const labelId = useId();
  return (
    <div role='group' aria-labelledby={labelId} className='grid gap-1.5 text-[12px] text-stone-300'>
      <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1'>
        <span id={labelId} className='text-[12px] font-medium text-stone-200'>
          {label}
        </span>
        {hint ? (
          <span className='max-w-[64%] text-right text-[10.5px] text-stone-500'>{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function LanguageCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [query, setQuery] = useState('');

  const trimmedQuery = query.trim();
  const needle = trimmedQuery.toLowerCase();

  const filtered = !needle
    ? COMMON_LANGUAGES
    : COMMON_LANGUAGES.filter(code => {
        const name = LANGUAGE_NAMES[code] ?? code;
        return code.includes(needle) || name.toLowerCase().includes(needle);
      });

  const showCreate = trimmedQuery.length > 0 && !COMMON_LANGUAGES.includes(needle);

  const displayValue = (code: string) => {
    if (!code) return '';
    const name = LANGUAGE_NAMES[code];
    return name ? `${code.toUpperCase()} · ${name}` : code;
  };

  return (
    <Combobox
      value={value}
      onChange={(next: string | null) => {
        if (next !== null) onChange(next);
      }}
      onClose={() => {
        setQuery('');
      }}
    >
      <div className='relative'>
        <ComboboxInput
          aria-label='Target language'
          className='w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 pr-8 text-[12px] text-white outline-none transition placeholder:text-stone-500 focus:border-stone-300/45'
          displayValue={displayValue}
          onChange={event => {
            setQuery(event.target.value);
          }}
          placeholder='Search or type custom code'
        />
        <ComboboxButton className='absolute inset-y-0 right-2 grid place-items-center text-stone-400 transition hover:text-stone-200'>
          <ChevronDown size={16} />
        </ComboboxButton>
        <ComboboxOptions
          anchor='bottom start'
          className='relay-scroll z-20 mt-1 max-h-72 w-(--input-width) overflow-y-auto rounded-xl border border-white/10 bg-[rgba(24,24,22,0.96)] p-1 shadow-[0_18px_60px_rgba(0,0,0,0.4)] backdrop-blur-2xl empty:hidden'
        >
          {filtered.map(code => (
            <ComboboxOption
              key={code}
              value={code}
              className='group flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-[13px] text-stone-200 transition data-focus:bg-white/10 data-selected:text-stone-100'
            >
              <span className='flex items-center gap-2.5'>
                <span className='inline-block w-8 shrink-0 font-mono text-[11px] font-semibold tracking-(--relay-tracking-wide) text-stone-400 group-data-selected:text-stone-300'>
                  {code.toUpperCase()}
                </span>
                <span>{LANGUAGE_NAMES[code] ?? code}</span>
              </span>
              <Check
                size={14}
                className='text-stone-300 opacity-0 group-data-selected:opacity-100'
              />
            </ComboboxOption>
          ))}
          {showCreate ? (
            <ComboboxOption
              value={trimmedQuery}
              className='group mt-1 flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed border-white/10 px-2.5 py-2 text-[13px] text-stone-300 transition data-focus:border-stone-300/40 data-focus:bg-white/9'
            >
              <span className='inline-block w-8 shrink-0 font-mono text-[11px] font-semibold tracking-(--relay-tracking-wide) text-stone-300'>
                {trimmedQuery.slice(0, 3).toUpperCase()}
              </span>
              <span>
                Use custom language &quot;
                <span className='text-stone-200'>{trimmedQuery}</span>&quot;
              </span>
            </ComboboxOption>
          ) : null}
        </ComboboxOptions>
      </div>
    </Combobox>
  );
}

function ToggleRow({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className='flex items-start justify-between gap-4 rounded-xl border border-white/8 bg-white/2 px-3 py-2.5'>
      <div className='grid gap-1'>
        <span className='text-[12.5px] font-medium text-white'>{label}</span>
        <span className='text-[12px] leading-5 text-stone-400'>{detail}</span>
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

function ModelsList({
  kind,
  models,
  onUse,
  onDownload,
  downloading,
}: {
  kind: ModelKind;
  models: ModelRecord[];
  onUse: (kind: ModelKind, model: ModelRecord) => Promise<void>;
  onDownload: (kind: ModelKind) => Promise<void>;
  downloading: boolean;
}) {
  if (models.length === 0) {
    return (
      <EmptyState text='No local models discovered yet. Point Relay at a models directory first.' />
    );
  }

  return (
    <div className='grid gap-2'>
      {models.map(model => (
        <article
          key={`${kind}-${model.path}`}
          className='rounded-xl border border-white/8 bg-white/2 px-3 py-2.5 transition hover:border-white/12 hover:bg-white/7'
        >
          <div className='flex items-start justify-between gap-3'>
            <div className='min-w-0'>
              <p className='truncate text-[12.5px] font-medium text-white'>
                {model.relativePath || model.name}
              </p>
              <p className='mt-1 break-all text-[11.5px] text-stone-400'>{model.path}</p>
            </div>
            <div className='flex shrink-0 items-center gap-1.5'>
              {model.recommended ? (
                <Badge tone='warning' className='text-[10px]'>
                  Recommended
                </Badge>
              ) : null}
              <ModelStateBadge state={model.state} />
            </div>
          </div>
          <div className='mt-2 flex items-center justify-between gap-3'>
            <span className='text-[10.5px] text-stone-500'>{formatModelSize(model.sizeBytes)}</span>
            {model.state !== 'active' && model.recommended && model.state === 'missing' ? (
              <button
                type='button'
                onClick={() => void onDownload(kind)}
                disabled={downloading}
                className='inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/4 px-3 py-1.5 text-[12px] font-medium text-stone-100 transition hover:border-white/14 hover:bg-white/10 disabled:opacity-45'
              >
                <Download size={13} />
                {downloading ? 'Downloading...' : 'Download model'}
              </button>
            ) : model.state !== 'active' ? (
              <button
                type='button'
                onClick={() => void onUse(kind, model)}
                disabled={model.state === 'missing'}
                className='rounded-lg border border-white/10 bg-white/4 px-3 py-1.5 text-[12px] font-medium text-stone-100 transition hover:border-white/14 hover:bg-white/10 disabled:opacity-40'
              >
                Use model
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function HealthMessage({ health, detail }: { health: ServiceHealth; detail: string | null }) {
  if (!detail) return null;
  const tone =
    health === 'ready'
      ? 'border-emerald-500/15 bg-emerald-500/8 text-emerald-200'
      : health === 'degraded' || health === 'unavailable'
        ? 'border-rose-500/20 bg-rose-500/10 text-rose-100'
        : 'border-white/8 bg-white/[0.02] text-stone-300';
  return (
    <div className={`rounded-lg border px-2.5 py-2 text-[11.5px] leading-5 ${tone}`}>{detail}</div>
  );
}

function ShortcutRow({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
}) {
  return (
    <div className='flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/2 px-3 py-3'>
      <span className='text-[13px] text-stone-200'>{label}</span>
      <ShortcutInputField value={value} label={`${label} shortcut`} onCommit={onCommit} />
    </div>
  );
}

function BrowseLinkRow({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex cursor-pointer items-center justify-between rounded-xl border border-white/8 bg-white/2 px-3 py-2.5 text-left text-[12px] text-stone-100 transition hover:border-white/12 hover:bg-white/8'
    >
      <span className='inline-flex items-center gap-2'>
        {icon}
        <span>{label}</span>
      </span>
      <ChevronRight size={16} />
    </button>
  );
}

function LabeledInfoRow({
  label,
  value,
  onClick,
  icon,
}: {
  label: string;
  value: string;
  onClick?: () => void;
  icon?: ReactNode;
}) {
  const content = (
    <>
      <p className='text-[10.5px] text-stone-500'>{label}</p>
      {icon ? (
        <p className='mt-1 inline-flex items-center gap-2 break-all text-[13px] text-stone-100'>
          {icon}
          <span>{value}</span>
        </p>
      ) : (
        <p className='mt-1 break-all text-[13px] text-stone-100'>{value}</p>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type='button'
        onClick={onClick}
        className='cursor-pointer rounded-xl border border-white/8 bg-white/2 px-3 py-2.5 text-left transition hover:border-white/12 hover:bg-white/8'
      >
        {content}
      </button>
    );
  }

  return <div className='rounded-xl border border-white/8 bg-white/2 px-3 py-2.5'>{content}</div>;
}

function InlineNote({ children }: PropsWithChildren) {
  return (
    <div className='rounded-xl border border-white/8 bg-white/2 px-3 py-2.5 text-[12px] leading-5 text-stone-300'>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className='rounded-xl border border-transparent bg-transparent px-4 py-6 text-center text-[12px] leading-5 text-stone-500'>
      {text}
    </div>
  );
}

function TomlPreview({ content }: { content: string }) {
  return (
    <pre className='relay-scroll max-h-120 overflow-auto rounded-xl border border-white/8 bg-black/24 px-3.5 py-3 font-mono text-[11.5px] leading-5 text-stone-300'>
      <code>
        {content.split('\n').map((line, index) => (
          <span key={`${String(index)}-${line}`} className='block'>
            {renderTomlLine(line)}
          </span>
        ))}
      </code>
    </pre>
  );
}

function renderTomlLine(line: string) {
  if (!line.trim()) {
    return ' ';
  }
  if (line.trimStart().startsWith('#')) {
    return <span className='text-stone-500'>{line}</span>;
  }
  if (line.trimStart().startsWith('[') && line.trimEnd().endsWith(']')) {
    return <span className='text-stone-200'>{line}</span>;
  }

  const separatorIndex = line.indexOf('=');
  if (separatorIndex === -1) {
    return <span>{line}</span>;
  }

  const key = line.slice(0, separatorIndex);
  const value = line.slice(separatorIndex + 1);
  return (
    <>
      <span className='text-stone-200'>{key}</span>
      <span className='text-stone-500'>=</span>
      <span className='text-stone-300'>{value}</span>
    </>
  );
}

function ModelStateBadge({ state }: { state: ModelRecord['state'] }) {
  const tone = state === 'active' ? 'success' : state === 'missing' ? 'danger' : 'neutral';
  return (
    <Badge tone={tone} className='text-[10px]'>
      {MODEL_STATE_LABELS[state]}
    </Badge>
  );
}
