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
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  AudioLines,
  Captions,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileSearchCorner,
  FolderOpen,
  FolderSearch,
  Info,
  Keyboard,
  Languages,
  Logs,
  Mic,
  Save,
  SquareTerminal,
} from 'lucide-react';
import { type PropsWithChildren, type ReactNode, useEffect, useId, useMemo, useState } from 'react';

import { InputSourceStatusCard } from '@/components/InputSourceStatusCard';
import { type LogEntry, SegmentLogPanel } from '@/components/SegmentLogPanel';
import { HealthBadge } from '@/components/shared/HealthBadge';
import { ClearLogButton, IconButton } from '@/components/shared/IconButton';
import { Switch } from '@/components/shared/Switch';
import { WindowDragStrip, WindowShell } from '@/components/shared/WindowChrome';
import { ToastViewport } from '@/components/ToastViewport';
import { useToastCenter } from '@/hooks/useToastCenter';
import { diagnosticLevelTone } from '@/lib/diagnostics';
import { toErrorMessage } from '@/lib/errors';
import { formatModelSize } from '@/lib/format';
import {
  clearDiagnostics,
  getAppPaths,
  getConfigPreview,
  SETTINGS_NAVIGATE_EVENT,
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

const COMMON_LANGUAGES = Object.keys(LANGUAGE_NAMES);

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

export function SettingsWindow({ relay }: { relay: RelaySnapshotState }) {
  const snapshot = relay.snapshot;
  const [draftState, setDraftState] = useState<RelaySettings | null>(null);
  const [hasLocalEdits, setHasLocalEdits] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>('inputs');
  const [isSaving, setIsSaving] = useState(false);
  const [version, setVersion] = useState('0.1.0');
  const [configPreview, setConfigPreview] = useState('');
  const [appPaths, setAppPaths] = useState<AppPaths | null>(null);
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

    void listen<string>(SETTINGS_NAVIGATE_EVENT, event => {
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
  }, []);

  const draft = hasLocalEdits ? draftState : (draftState ?? snapshot?.settings ?? null);
  const isDirty = useMemo(() => {
    if (!snapshot || !draft) return false;
    return !settingsEqual(snapshot.settings, draft);
  }, [draft, snapshot]);

  const allModels = snapshot?.models;
  const sttSelectedModel = draft?.sttSelectedModel;
  const translationSelectedModel = draft?.translation.selectedModel;
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
        })),
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
        })),
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

  if (relay.isLoading || !snapshot || !draft) {
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

  const replaceDraft = (next: RelaySettings) => {
    setHasLocalEdits(true);
    setDraftState(next);
  };

  const commitDraft = (next: RelaySettings) => {
    setDraftState(next);
    setHasLocalEdits(false);
  };

  const saveSettings = async (nextSettings?: RelaySettings) => {
    const settings = nextSettings ?? draft;
    setIsSaving(true);
    try {
      const updated = await updateSettings(settings);
      commitDraft(updated.settings);
      await refreshConfigPreview();
      pushToast({ title: 'Relay', message: 'Settings saved', tone: 'success' });
    } catch (reason: unknown) {
      notifyError(reason);
    } finally {
      setIsSaving(false);
    }
  };

  const pickModelDirectory = async (kind: ModelKind) => {
    const selected = await open({ multiple: false, directory: true });
    if (!selected) return;

    const next =
      kind === 'transcription'
        ? { ...draft, sttModelPath: selected, sttSelectedModel: '' }
        : {
            ...draft,
            translation: {
              ...draft.translation,
              modelPath: selected,
              selectedModel: '',
            },
          };
    commitDraft(next);
    await saveSettings(next);
  };

  const chooseModel = async (kind: ModelKind, model: ModelRecord) => {
    const next =
      kind === 'transcription'
        ? { ...draft, sttSelectedModel: model.relativePath }
        : {
            ...draft,
            translation: {
              ...draft.translation,
              selectedModel: model.relativePath,
            },
          };
    commitDraft(next);
    await saveSettings(next);
  };

  const active = SECTION_BY_ID[activeSection];

  return (
    <main className='relay-app-bg flex h-screen w-screen flex-col overflow-hidden text-slate-100'>
      <WindowDragStrip />
      <div className='flex min-h-0 flex-1'>
        <aside className='flex h-full w-65 shrink-0 flex-col border-r border-white/6 bg-[rgba(8,13,22,0.72)] px-3 pb-3 pt-10 backdrop-blur-2xl'>
          <div className='rounded-2xl border border-white/8 bg-white/3 px-3.5 py-3'>
            <p className='text-sm font-semibold tracking-tight text-white'>Settings</p>
            <p className='mt-1 text-[11px] text-slate-500'>Relay v{version}</p>
          </div>

          <nav className='relay-scroll mt-3 grid gap-0.5 overflow-y-auto pr-1'>
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
          <div className='sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/6 bg-[rgba(7,11,20,0.72)] px-8 py-5 backdrop-blur-xl'>
            <div>
              <h1 className='text-[22px] font-semibold tracking-tight text-white'>
                {active.label}
              </h1>
              <p className='mt-0.5 text-[13px] text-slate-400'>{active.description}</p>
            </div>

            <div className='flex items-center gap-2'>
              {isDirty ? (
                <span className='rounded-full bg-amber-300/15 px-2.5 py-1 text-[11px] tracking-[0.16em] text-amber-200'>
                  Unsaved
                </span>
              ) : null}
              <button
                type='button'
                onClick={() => void saveSettings()}
                disabled={isSaving || !isDirty}
                className='inline-flex items-center gap-2 rounded-xl bg-linear-to-br from-cyan-300 to-sky-400 px-4 py-2 text-sm font-medium text-slate-950 shadow-[0_8px_24px_rgba(56,182,255,0.3)] transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none'
              >
                <Save size={14} />
                {isSaving ? 'Saving...' : 'Save settings'}
              </button>
            </div>
          </div>

          <div className='mx-auto w-full max-w-260 px-8 py-6'>
            {activeSection === 'inputs' ? (
              <SectionGrid cols={2}>
                <InputSourceStatusCard
                  title='Microphone'
                  source={{ ...snapshot.microphone, enabled: draft.microphoneEnabled }}
                  onToggle={enabled => {
                    replaceDraft({ ...draft, microphoneEnabled: enabled });
                  }}
                />
                <InputSourceStatusCard
                  title='System audio'
                  source={{ ...snapshot.systemAudio, enabled: draft.systemAudioEnabled }}
                  onToggle={enabled => {
                    replaceDraft({ ...draft, systemAudioEnabled: enabled });
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
                    hint='App scans this folder and all subfolders for .bin files.'
                  >
                    <PathField
                      value={draft.sttModelPath}
                      onChange={value => {
                        replaceDraft({ ...draft, sttModelPath: value });
                      }}
                      onPick={() => void pickModelDirectory('transcription')}
                      placeholder='/Users/you/models/whisper'
                      buttonLabel='Browse'
                    />
                  </Field>
                  <Field label='Found models'>
                    <ModelsList
                      kind='transcription'
                      models={transcriptionModels}
                      onUse={chooseModel}
                    />
                  </Field>
                  <InlineNote>
                    ⚠️ Whisper GGML *.bin models are supported here. Multilingual models cover many
                    languages. English-only variants (with &quot;en&quot; in name) are faster, but
                    they will not handle mixed or non-English speech.
                  </InlineNote>
                  <ActionRow
                    label='Browse Whisper transcription models on Hugging Face 🤗'
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
                  <Field label='Target language' hint='Language used for translated output.'>
                    <LanguageCombobox
                      value={draft.translation.targetLanguage}
                      onChange={next => {
                        replaceDraft({
                          ...draft,
                          translation: { ...draft.translation, targetLanguage: next },
                        });
                      }}
                    />
                  </Field>
                  <Field
                    label='Translation models directory'
                    hint='App scans this folder and all subfolders for .gguf files.'
                  >
                    <PathField
                      value={draft.translation.modelPath}
                      onChange={value => {
                        replaceDraft({
                          ...draft,
                          translation: { ...draft.translation, modelPath: value },
                        });
                      }}
                      onPick={() => void pickModelDirectory('translation')}
                      placeholder='/Users/you/models/translation'
                      buttonLabel='Browse'
                    />
                  </Field>
                  <Field label='Found models'>
                    <ModelsList kind='translation' models={translationModels} onUse={chooseModel} />
                  </Field>
                  <Field
                    label='Max tokens'
                    hint='Max generated translation tokens per segment. Lower is faster. Higher helps longer sentences.'
                  >
                    <Input
                      type='number'
                      value={String(draft.translation.maxTokens)}
                      onChange={value => {
                        const parsed = Math.floor(Number(value));
                        const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : 96;
                        replaceDraft({
                          ...draft,
                          translation: {
                            ...draft.translation,
                            maxTokens: safe,
                          },
                        });
                      }}
                    />
                  </Field>
                  <InlineNote>
                    ⚠️ Use llama.cpp-compatible instruct or chat GGUF models. The Hugging Face
                    filter below is a good starting point, but every result still needs a chat
                    template and practical translation quality.
                  </InlineNote>
                  <ActionRow
                    label='Browse translation model candidates on Hugging Face 🤗'
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
                  description='Edit shortcuts only in the config file. App validates them on app startup and falls back to defaults if needed.'
                >
                  <ShortcutRow label='Toggle listening' value={draft.shortcuts.toggleListening} />
                  <ShortcutRow label='Show / hide overlay' value={draft.shortcuts.toggleOverlay} />
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
                  checked={draft.overlay.alwaysOnTop}
                  onChange={checked => {
                    replaceDraft({
                      ...draft,
                      overlay: { ...draft.overlay, alwaysOnTop: checked },
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
                        if (appPaths?.configDir) {
                          void runWithErrorToast(() => openPath(appPaths.configDir));
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
                <MetricRow label='Version' value={version} />
                <MetricRow label='Developer' value='r.m.khasanshin@gmail.com' />
              </SectionGrid>
            ) : null}
          </div>
        </section>
      </div>

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}

function settingsEqual(left: RelaySettings, right: RelaySettings): boolean {
  return (
    left.microphoneEnabled === right.microphoneEnabled &&
    left.systemAudioEnabled === right.systemAudioEnabled &&
    left.sttModelPath === right.sttModelPath &&
    left.sttSelectedModel === right.sttSelectedModel &&
    left.translation.modelPath === right.translation.modelPath &&
    left.translation.selectedModel === right.translation.selectedModel &&
    left.translation.targetLanguage === right.translation.targetLanguage &&
    left.translation.maxTokens === right.translation.maxTokens &&
    left.overlay.visible === right.overlay.visible &&
    left.overlay.compactMode === right.overlay.compactMode &&
    left.overlay.alwaysOnTop === right.overlay.alwaysOnTop &&
    left.shortcuts.toggleListening === right.shortcuts.toggleListening &&
    left.shortcuts.toggleOverlay === right.shortcuts.toggleOverlay
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
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition ${
        active ? 'bg-white/8 text-white' : 'text-slate-300 hover:bg-white/4 hover:text-white'
      }`}
    >
      <span
        className={`grid h-6 w-6 place-items-center rounded-md text-[13px] ${
          active ? 'bg-cyan-300/15 text-cyan-200' : 'bg-white/4 text-slate-400'
        }`}
      >
        {icon}
      </span>
      <span className='flex-1 text-left'>{label}</span>
    </button>
  );
}

function SectionGrid({ cols = 1, children }: PropsWithChildren<{ cols?: 1 | 2 }>) {
  return <div className={`grid gap-4 ${cols === 2 ? 'lg:grid-cols-2' : ''}`}>{children}</div>;
}

function SectionCard({
  title,
  description,
  action,
  children,
}: PropsWithChildren<{ title: string; description?: string; action?: ReactNode }>) {
  return (
    <section className='rounded-2xl border border-white/8 bg-[rgba(10,15,26,0.6)] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.18)]'>
      <div className='mb-3 flex items-start justify-between gap-3'>
        <div>
          <h2 className='text-[15px] font-medium tracking-tight text-white'>{title}</h2>
          {description ? (
            <p className='mt-0.5 text-[12.5px] leading-5 text-slate-400'>{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className='grid gap-3'>{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: PropsWithChildren<{ label: string; hint?: string }>) {
  const labelId = useId();
  return (
    <div role='group' aria-labelledby={labelId} className='grid gap-2 text-sm text-slate-300'>
      <div className='flex items-center justify-between gap-3'>
        <span id={labelId} className='text-[13px] font-medium text-slate-200'>
          {label}
        </span>
        {hint ? <span className='text-[11px] text-slate-500'>{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
}) {
  return (
    <input
      className='w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60'
      value={value}
      type={type}
      onChange={event => {
        onChange(event.currentTarget.value);
      }}
      placeholder={placeholder}
    />
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

  const filtered = useMemo(() => {
    if (!needle) return COMMON_LANGUAGES;
    return COMMON_LANGUAGES.filter(code => {
      const name = LANGUAGE_NAMES[code] ?? code;
      return code.includes(needle) || name.toLowerCase().includes(needle);
    });
  }, [needle]);

  const showCreate = trimmedQuery.length > 0 && !COMMON_LANGUAGES.includes(needle);

  const displayValue = (code: string) => {
    if (!code) return '';
    const name = LANGUAGE_NAMES[code];
    return name ? `${code.toUpperCase()} · ${name}` : code.toUpperCase();
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
          className='w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 pr-9 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60'
          displayValue={displayValue}
          onChange={event => {
            setQuery(event.target.value);
          }}
          placeholder='Search or type custom code'
        />
        <ComboboxButton className='absolute inset-y-0 right-2 grid place-items-center text-slate-400 transition hover:text-slate-200'>
          <ChevronDown size={16} />
        </ComboboxButton>
        <ComboboxOptions
          anchor='bottom start'
          className='relay-scroll z-20 mt-1 max-h-72 w-(--input-width) overflow-y-auto rounded-xl border border-white/10 bg-[rgba(10,15,26,0.96)] p-1 shadow-[0_18px_60px_rgba(0,0,0,0.4)] backdrop-blur-2xl empty:hidden'
        >
          {filtered.map(code => (
            <ComboboxOption
              key={code}
              value={code}
              className='group flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-[13px] text-slate-200 transition data-focus:bg-white/8 data-selected:text-cyan-200'
            >
              <span className='flex items-center gap-2.5'>
                <span className='inline-block w-8 shrink-0 font-mono text-[11px] font-semibold tracking-[0.08em] text-slate-400 group-data-selected:text-cyan-300'>
                  {code.toUpperCase()}
                </span>
                <span>{LANGUAGE_NAMES[code] ?? code}</span>
              </span>
              <Check
                size={14}
                className='text-cyan-300 opacity-0 group-data-selected:opacity-100'
              />
            </ComboboxOption>
          ))}
          {showCreate ? (
            <ComboboxOption
              value={needle}
              className='group mt-1 flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed border-white/10 px-2.5 py-2 text-[13px] text-slate-300 transition data-focus:border-cyan-300/40 data-focus:bg-white/6'
            >
              <span className='inline-block w-8 shrink-0 font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan-300'>
                {needle.toUpperCase()}
              </span>
              <span>
                Use custom code &quot;<span className='text-cyan-200'>{needle}</span>&quot;
              </span>
            </ComboboxOption>
          ) : null}
        </ComboboxOptions>
      </div>
    </Combobox>
  );
}

function PathField({
  value,
  onChange,
  onPick,
  placeholder,
  buttonLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onPick: () => void;
  placeholder: string;
  buttonLabel: string;
}) {
  return (
    <div className='flex gap-2'>
      <Input value={value} onChange={onChange} placeholder={placeholder} />
      <button
        type='button'
        onClick={onPick}
        aria-label={buttonLabel}
        title={buttonLabel}
        className='inline-flex h-10.5 w-10.5 items-center justify-center rounded-full border border-white/10 bg-white/4 text-slate-100 transition hover:bg-white/8'
      >
        <FolderSearch size={16} />
      </button>
    </div>
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
    <div className='flex items-start justify-between gap-4 rounded-xl border border-white/8 bg-white/2 px-3.5 py-3'>
      <div className='grid gap-1'>
        <span className='text-sm font-medium text-white'>{label}</span>
        <span className='text-[13px] leading-5 text-slate-400'>{detail}</span>
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

function ModelsList({
  kind,
  models,
  onUse,
}: {
  kind: ModelKind;
  models: ModelRecord[];
  onUse: (kind: ModelKind, model: ModelRecord) => Promise<void>;
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
          className='rounded-xl border border-white/8 bg-white/2 px-3 py-3 transition hover:bg-white/4'
        >
          <div className='flex items-start justify-between gap-3'>
            <div className='min-w-0'>
              <p className='truncate text-sm font-medium text-white'>
                {model.relativePath || model.name}
              </p>
              <p className='mt-1 break-all text-[12.5px] text-slate-400'>{model.path}</p>
            </div>
            <span className={modelStateClass(model.state)}>{MODEL_STATE_LABELS[model.state]}</span>
          </div>
          <div className='mt-3 flex items-center justify-between gap-3'>
            <span className='text-[11px] text-slate-500'>{formatModelSize(model.sizeBytes)}</span>
            <button
              type='button'
              onClick={() => void onUse(kind, model)}
              disabled={model.state === 'missing' || model.state === 'active'}
              className='rounded-full border border-white/10 bg-white/4 px-3 py-1.5 text-[12px] font-medium text-slate-100 transition hover:bg-white/8 disabled:opacity-40'
            >
              {model.state === 'active' ? 'Selected' : 'Use model'}
            </button>
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
      ? 'border-emerald-400/15 bg-emerald-400/8 text-emerald-100'
      : health === 'degraded' || health === 'unavailable'
        ? 'border-rose-500/20 bg-rose-500/10 text-rose-100'
        : 'border-white/8 bg-white/[0.02] text-slate-300';
  return (
    <div className={`rounded-xl border px-3 py-2.5 text-[12px] leading-5 ${tone}`}>{detail}</div>
  );
}

function ShortcutRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/2 px-3 py-3'>
      <span className='text-sm text-slate-200'>{label}</span>
      <span className='rounded-lg bg-black/30 px-2.5 py-1 font-mono text-[12px] text-slate-300'>
        {value}
      </span>
    </div>
  );
}

function ActionRow({
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
      className='flex items-center justify-between rounded-xl border border-white/8 bg-white/2 px-3 py-3 text-left text-sm text-slate-100 transition hover:bg-white/5'
    >
      <span className='inline-flex items-center gap-2'>
        {icon}
        <span>{label}</span>
      </span>
      <ChevronRight size={16} />
    </button>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-xl border border-white/8 bg-white/2 px-3 py-3'>
      <p className='text-[11px] text-slate-500'>{label}</p>
      <p className='mt-1 break-all text-sm text-slate-100'>{value}</p>
    </div>
  );
}

function InlineNote({ children }: PropsWithChildren) {
  return (
    <div className='rounded-xl border border-white/8 bg-white/2 px-3.5 py-3 text-[13px] leading-6 text-slate-300'>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className='rounded-xl border border-dashed border-white/10 bg-white/1.5 px-4 py-8 text-center text-sm leading-6 text-slate-500'>
      {text}
    </div>
  );
}

function TomlPreview({ content }: { content: string }) {
  return (
    <pre className='relay-scroll max-h-130 overflow-auto rounded-xl border border-white/8 bg-black/30 px-4 py-3 font-mono text-[12px] leading-6 text-slate-300'>
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
    return <span className='text-slate-500'>{line}</span>;
  }
  if (line.trimStart().startsWith('[') && line.trimEnd().endsWith(']')) {
    return <span className='text-cyan-200'>{line}</span>;
  }

  const separatorIndex = line.indexOf('=');
  if (separatorIndex === -1) {
    return <span>{line}</span>;
  }

  const key = line.slice(0, separatorIndex);
  const value = line.slice(separatorIndex + 1);
  return (
    <>
      <span className='text-sky-200'>{key}</span>
      <span className='text-slate-500'>=</span>
      <span className='text-slate-300'>{value}</span>
    </>
  );
}

function modelStateClass(state: ModelRecord['state']) {
  if (state === 'active') {
    return 'rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold tracking-[0.04em] text-emerald-200';
  }
  if (state === 'missing') {
    return 'rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-[0.04em] text-rose-200';
  }
  return 'rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold tracking-[0.04em] text-slate-300';
}
