import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import type { Namespace, TFunction } from 'i18next';
import {
  AudioLines,
  Captions,
  Check,
  ChevronDown,
  ChevronRight,
  ContactRound,
  ExternalLink,
  FileCode2,
  FileSearchCorner,
  FolderOpen,
  Info,
  Keyboard,
  Languages,
  Logs,
  Mic,
  Palette,
  SquareTerminal,
} from 'lucide-react';
import { type PropsWithChildren, type ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { InputSourceStatusCard } from '@/components/InputSourceStatusCard';
import { type LogEntry, SegmentLogPanel } from '@/components/SegmentLogPanel';
import { LanguageCombobox } from '@/components/settings/LanguageCombobox';
import { IntegerSettingField, MaxTokensField } from '@/components/settings/MaxTokensField';
import { compareModelRecords, ModelsList } from '@/components/settings/ModelsList';
import { PathInputField } from '@/components/settings/PathInputField';
import { ShortcutInputField } from '@/components/settings/ShortcutInputField';
import { HealthBadge } from '@/components/shared/HealthBadge';
import { ClearLogButton, IconButton } from '@/components/shared/IconButton';
import { Switch } from '@/components/shared/Switch';
import { WindowDragStrip, WindowShell } from '@/components/shared/WindowChrome';
import { ToastViewport } from '@/components/ToastViewport';
import { useAppConstants } from '@/hooks/useAppConstants';
import { useToastCenter } from '@/hooks/useToastCenter';
import { normalizeUiLanguage, uiLanguages } from '@/i18n/languages';
import { fallbackLanguage } from '@/i18n/resources';
import { diagnosticLevelTone } from '@/lib/diagnostics';
import { toErrorMessage } from '@/lib/errors';
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
  RelaySettings,
  RelaySnapshotState,
  ServiceHealth,
  SettingsSection,
  UserMessage,
} from '@/lib/types';
import { formatUserMessage } from '@/lib/userMessages';

interface SectionDescriptor {
  id: SettingsSection;
  label: string;
  icon: ReactNode;
  description: string;
}

const SECTION_ITEMS: Pick<SectionDescriptor, 'id' | 'icon'>[] = [
  {
    id: 'inputs',
    icon: <Mic size={14} />,
  },
  {
    id: 'transcription',
    icon: <AudioLines size={14} />,
  },
  {
    id: 'translation',
    icon: <Languages size={14} />,
  },
  {
    id: 'interface',
    icon: <Palette size={14} />,
  },
  {
    id: 'overlay',
    icon: <Captions size={14} />,
  },
  {
    id: 'shortcuts',
    icon: <Keyboard size={14} />,
  },
  { id: 'logs', icon: <Logs size={14} /> },
  {
    id: 'rawConfig',
    icon: <FileCode2 size={14} />,
  },
  {
    id: 'about',
    icon: <Info size={14} />,
  },
];

function sectionDescriptor<Ns extends Namespace>(
  id: SettingsSection,
  icon: ReactNode,
  t: TFunction<Ns>
): SectionDescriptor {
  const translate = t as unknown as (key: string) => string;
  return {
    id,
    icon,
    label: translate(`settings:sections.${id}.label`),
    description: translate(`settings:sections.${id}.description`),
  };
}

export function SettingsWindow({ relay }: { relay: RelaySnapshotState }) {
  const { t } = useTranslation([
    'app',
    'boot',
    'common',
    'controls',
    'diagnostics',
    'logs',
    'models',
    'runtime',
    'settings',
    'source',
  ]);
  const snapshot = relay.snapshot;
  const [activeSection, setActiveSection] = useState<SettingsSection>('inputs');
  const [version, setVersion] = useState('0.1.0');
  const [configPreview, setConfigPreview] = useState('');
  const [appPaths, setAppPaths] = useState<AppPaths | null>(null);
  const [downloadingModelKind, setDownloadingModelKind] = useState<ModelKind | null>(null);
  const constants = useAppConstants();
  const { toasts, pushToast, dismissToast } = useToastCenter(snapshot?.diagnostics);
  const sections = useMemo(
    () => SECTION_ITEMS.map(item => sectionDescriptor(item.id, item.icon, t)),
    [t]
  );
  const sectionById = useMemo(
    () =>
      Object.fromEntries(sections.map(item => [item.id, item])) as Record<
        SettingsSection,
        SectionDescriptor
      >,
    [sections]
  );

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
      const requested = event.payload;
      const nextSection = SECTION_ITEMS.find(item => item.id === requested)?.id ?? 'inputs';
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
        text: formatUserMessage(entry.message, t) ?? '',
        tone: diagnosticLevelTone(entry.level),
      })),
    [diagnostics, t]
  );

  if (relay.isLoading || !snapshot || !settings) {
    return <WindowShell message={relay.error ?? t('boot:loadingSettings')} />;
  }

  const notifyError = (reason: unknown) => {
    pushToast({ title: t('app:toastTitle'), message: toErrorMessage(reason), tone: 'error' });
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

  const active = sectionById[activeSection];
  const fillsAvailableHeight = activeSection === 'logs' || activeSection === 'rawConfig';

  return (
    <main className='bg-(--relay-app-bg) flex h-screen w-screen flex-col overflow-hidden text-stone-100'>
      <WindowDragStrip />
      <div className='flex min-h-0 flex-1'>
        <aside className='flex h-full w-52 shrink-0 flex-col border-r border-white/6 bg-[rgba(15,15,14,0.82)] px-2.5 pb-3 pt-3'>
          <div className='rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2.5'>
            <p className='text-[12.5px] font-semibold text-white'>{t('settings:title')}</p>
            <p className='mt-0.5 text-[10.5px] text-stone-500'>
              {t('settings:version', { version })}
            </p>
          </div>

          <nav className='relay-scroll mt-2.5 grid gap-0.5 overflow-y-auto pr-1'>
            {sections.map(item => (
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

        <section className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <div className='sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/6 bg-[rgba(31,31,29,0.96)] px-5 py-3'>
            <div>
              <h1 className='text-[17px] font-semibold text-white'>{active.label}</h1>
              <p className='mt-0.5 text-[11.5px] text-stone-400'>{active.description}</p>
            </div>
          </div>

          <div
            className={`relay-scroll mx-auto w-full min-h-0 flex-1 px-5 py-4 ${
              fillsAvailableHeight
                ? 'flex min-h-0 max-w-none flex-1 flex-col overflow-hidden'
                : 'max-w-230 overflow-y-auto'
            }`}
          >
            {activeSection === 'inputs' ? (
              <SectionGrid cols={2}>
                <InputSourceStatusCard
                  title={t('controls:microphone')}
                  source={snapshot.microphone}
                  onToggle={enabled => {
                    void applySettings({ ...settings, microphoneEnabled: enabled });
                  }}
                />
                <InputSourceStatusCard
                  title={t('controls:systemAudio')}
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
                  title={t('settings:transcription.modelTitle')}
                  description={t('settings:transcription.modelDescription')}
                  action={<HealthBadge health={snapshot.sttHealth} />}
                >
                  <HealthMessage health={snapshot.sttHealth} detail={snapshot.sttDetail} />
                  <Field
                    label={t('settings:transcription.modelsDirectory')}
                    hint={t('settings:transcription.modelsDirectoryHint', {
                      depth: String(constants.maxModelWalkDepth),
                      extensions: formatExtensions(constants.whisperModelExtensions),
                    })}
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
                  <Field label={t('models:models')}>
                    <ModelsList
                      kind='transcription'
                      models={transcriptionModels}
                      onUse={chooseModel}
                      onDownload={downloadRecommended}
                      downloading={downloadingModelKind !== null}
                    />
                  </Field>
                  <Field
                    label={t('settings:transcription.threads')}
                    hint={t('settings:transcription.threadsHint', {
                      min: String(constants.minWorkerThreads),
                      max: String(constants.maxWorkerThreads),
                    })}
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
                    label={t('settings:transcription.window')}
                    hint={t('settings:transcription.windowHint', {
                      min: String(constants.minTranscriptionWindowSeconds),
                      max: String(constants.maxTranscriptionWindowSeconds),
                    })}
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
                    label={t('settings:transcription.hop')}
                    hint={t('settings:transcription.hopHint', {
                      min: String(constants.minTranscriptionHopSeconds),
                      max: String(constants.maxTranscriptionHopSeconds),
                    })}
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
                    label={t('settings:transcription.sentenceTimeout')}
                    hint={t('settings:transcription.sentenceTimeoutHint', {
                      min: String(constants.minTranscriptionSentenceTimeoutMs),
                      max: String(constants.maxTranscriptionSentenceTimeoutMs),
                    })}
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
                    {t('settings:transcription.note', {
                      extensions: formatGlobExtensions(constants.whisperModelExtensions),
                    })}
                  </InlineNote>
                  <BrowseLinkRow
                    label={t('settings:transcription.browseModels')}
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
                  title={t('settings:translation.modelTitle')}
                  description={t('settings:translation.modelDescription')}
                  action={<HealthBadge health={snapshot.translationHealth} />}
                >
                  <HealthMessage
                    health={snapshot.translationHealth}
                    detail={snapshot.translationDetail}
                  />
                  <Field
                    label={t('settings:translation.targetLanguage')}
                    hint={t('settings:translation.targetLanguageHint')}
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
                    label={t('settings:translation.modelsDirectory')}
                    hint={t('settings:translation.modelsDirectoryHint', {
                      depth: String(constants.maxModelWalkDepth),
                      extensions: formatExtensions(constants.translationModelExtensions),
                    })}
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
                  <Field label={t('models:models')}>
                    <ModelsList
                      kind='translation'
                      models={translationModels}
                      onUse={chooseModel}
                      onDownload={downloadRecommended}
                      downloading={downloadingModelKind !== null}
                    />
                  </Field>
                  <Field
                    label={t('settings:translation.maxTokens')}
                    hint={t('settings:translation.maxTokensHint', {
                      min: String(constants.minGenerationTokens),
                      max: String(constants.maxGenerationTokens),
                    })}
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
                    label={t('settings:translation.contextTokens')}
                    hint={t('settings:translation.contextTokensHint', {
                      min: String(constants.minTranslationContextTokens),
                      max: String(constants.maxTranslationContextTokens),
                    })}
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
                    label={t('settings:translation.threads')}
                    hint={t('settings:translation.threadsHint', {
                      min: String(constants.minWorkerThreads),
                      max: String(constants.maxWorkerThreads),
                    })}
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
                  <InlineNote>{t('settings:translation.note')}</InlineNote>
                  <BrowseLinkRow
                    label={t('settings:translation.browseModels')}
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
                  title={t('settings:shortcuts.title')}
                  description={
                    <>
                      {t('settings:shortcuts.descriptionPrefix')}{' '}
                      <button
                        type='button'
                        className='text-stone-200 underline decoration-white/20 underline-offset-3 transition hover:text-white hover:decoration-white/45 cursor-pointer'
                        onClick={() => {
                          void openUrl(
                            'https://github.com/tauri-apps/global-hotkey/blob/dev/src/hotkey.rs'
                          );
                        }}
                      >
                        {t('settings:shortcuts.syntaxLink')}
                      </button>
                      .
                    </>
                  }
                >
                  <ShortcutRow
                    label={t('settings:shortcuts.toggleListening')}
                    value={settings.shortcuts.toggleListening}
                    onCommit={value => {
                      void applySettings({
                        ...settings,
                        shortcuts: { ...settings.shortcuts, toggleListening: value },
                      });
                    }}
                  />
                  <ShortcutRow
                    label={t('settings:shortcuts.toggleOverlay')}
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
                          key={`${warning.code}-${JSON.stringify(warning.params ?? {})}`}
                          className='rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2.5 text-[12px] leading-5 text-amber-100'
                        >
                          {formatUserMessage(warning, t)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </SectionCard>
              </SectionGrid>
            ) : null}

            {activeSection === 'interface' ? (
              <SectionGrid>
                <SectionCard
                  title={t('settings:interface.uiLanguage')}
                  description={t('settings:interface.uiLanguageHint')}
                >
                  <UiLanguageSelect
                    value={normalizeUiLanguage(settings.interface.uiLanguage)}
                    onChange={value => {
                      void applySettings({
                        ...settings,
                        interface: { ...settings.interface, uiLanguage: value },
                      });
                    }}
                  />
                </SectionCard>
              </SectionGrid>
            ) : null}

            {activeSection === 'overlay' ? (
              <SectionGrid>
                <ToggleRow
                  label={t('settings:overlay.alwaysOnTop')}
                  detail={t('settings:overlay.alwaysOnTopDetail')}
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
              <SectionGrid fill>
                <SegmentLogPanel
                  title={t('logs:diagnostics')}
                  icon={<SquareTerminal size={16} />}
                  entries={diagnosticsEntries}
                  onCopyError={notifyError}
                  actions={
                    <>
                      <IconButton
                        label={t('logs:openLogFolder')}
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
                        label={t('logs:clearDiagnostics')}
                        disabled={diagnosticsEntries.length === 0}
                        onClick={() => {
                          void clearDiagnostics()
                            .then(() => {
                              pushToast({
                                title: t('app:toastTitle'),
                                message: t('logs:diagnosticsCleared'),
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
                      <span>{t('common:lineCount', { count: diagnosticsEntries.length })}</span>
                      <span>{appPaths?.diagnosticsLogFile ?? t('logs:logFileUnavailable')}</span>
                    </div>
                  }
                  emptyText={t('logs:emptyDiagnostics')}
                />
              </SectionGrid>
            ) : null}

            {activeSection === 'rawConfig' ? (
              <SectionGrid fill>
                <SectionCard
                  title={t('settings:rawConfig.title')}
                  fill
                  action={
                    <IconButton
                      label={t('settings:rawConfig.openFolder')}
                      icon={<FolderOpen size={14} />}
                      onClick={() => {
                        if (appPaths?.configFile) {
                          void runWithErrorToast(() => revealItemInDir(appPaths.configFile));
                        }
                      }}
                    />
                  }
                >
                  <TomlPreview content={configPreview || t('settings:rawConfig.loadFailed')} />
                </SectionCard>
              </SectionGrid>
            ) : null}

            {activeSection === 'about' ? (
              <SectionGrid>
                <LabeledInfoRow label={t('settings:about.version')} value={version} />
                <LabeledInfoRow
                  label={t('settings:about.developer')}
                  value='Ruslan Khasanshin <r.m.khasanshin@gmail.com>'
                  onClick={() => {
                    void openUrl('mailto:r.m.khasanshin@gmail.com');
                  }}
                  icon={<ContactRound size={14} />}
                />
                <LabeledInfoRow
                  label={t('settings:about.website')}
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

function SectionGrid({
  cols = 1,
  fill = false,
  children,
}: PropsWithChildren<{ cols?: 1 | 2; fill?: boolean }>) {
  return (
    <div
      className={`grid gap-2.5 ${
        cols === 2 ? 'lg:grid-cols-2' : ''
      } ${fill ? 'h-full min-h-0 flex-1' : ''}`}
    >
      {children}
    </div>
  );
}

function SectionCard({
  title,
  description,
  action,
  fill = false,
  children,
}: PropsWithChildren<{
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  fill?: boolean;
}>) {
  return (
    <section
      className={`rounded-xl border border-white/6 bg-(--relay-card-bg) p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.14)] ${
        fill ? 'flex h-full min-h-0 flex-1 flex-col' : ''
      }`}
    >
      <div className='mb-2.5 flex items-start justify-between gap-3'>
        <div>
          <h2 className='text-[13px] font-medium text-white'>{title}</h2>
          {description ? (
            <p className='mt-0.5 text-[11.5px] leading-5 text-stone-400'>{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className={`grid gap-2.5 ${fill ? 'min-h-0 flex-1' : ''}`}>{children}</div>
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

function HealthMessage({ health, detail }: { health: ServiceHealth; detail: UserMessage | null }) {
  const { t } = useTranslation(['diagnostics', 'runtime', 'source']);
  const text = formatUserMessage(detail, t);
  if (!text) return null;
  const tone =
    health === 'ready'
      ? 'border-emerald-500/15 bg-emerald-500/8 text-emerald-200'
      : health === 'degraded' || health === 'unavailable'
        ? 'border-rose-500/20 bg-rose-500/10 text-rose-100'
        : 'border-white/8 bg-white/[0.02] text-stone-300';
  return (
    <div className={`rounded-lg border px-2.5 py-2 text-[11.5px] leading-5 ${tone}`}>{text}</div>
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
  const { t } = useTranslation('settings');
  return (
    <div className='flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/2 px-3 py-3'>
      <span className='text-[13px] text-stone-200'>{label}</span>
      <ShortcutInputField
        value={value}
        label={t('shortcuts.shortcutAria', { label })}
        onCommit={onCommit}
      />
    </div>
  );
}

function UiLanguageSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const selected = uiLanguages.find(language => language.code === value) ??
    uiLanguages.find(language => language.code === fallbackLanguage) ??
    uiLanguages[0] ?? {
      code: 'en',
      label: 'English',
      nativeLabel: 'English',
    };

  return (
    <Listbox
      value={value}
      onChange={next => {
        if (typeof next === 'string') onChange(normalizeUiLanguage(next));
      }}
    >
      <div className='relative'>
        <ListboxButton className='flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/2 px-3 py-2.5 text-left text-[12px] text-stone-100 outline-none transition hover:border-white/12 hover:bg-white/8 focus:border-stone-300/45'>
          <span className='flex min-w-0 items-center gap-2.5'>
            <LanguageBadge code={selected.code} />
            <span className='min-w-0 truncate'>{selected.label}</span>
            {selected.nativeLabel !== selected.label ? (
              <span className='truncate text-stone-500'>{selected.nativeLabel}</span>
            ) : null}
          </span>
          <ChevronDown size={16} className='shrink-0 text-stone-400' />
        </ListboxButton>
        <ListboxOptions
          anchor='bottom start'
          className='relay-scroll z-20 mt-1 max-h-72 w-(--button-width) overflow-y-auto rounded-xl border border-white/8 bg-[rgba(24,24,22,0.96)] p-1 shadow-[0_18px_60px_rgba(0,0,0,0.4)] backdrop-blur-2xl'
        >
          {uiLanguages.map(language => (
            <ListboxOption
              key={language.code}
              value={language.code}
              className='group flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-[13px] text-stone-200 transition data-focus:bg-white/10 data-selected:bg-white/6 data-selected:text-stone-100'
            >
              <span className='flex min-w-0 items-center gap-2.5'>
                <LanguageBadge code={language.code} />
                <span className='min-w-0 truncate'>{language.label}</span>
                {language.nativeLabel !== language.label ? (
                  <span className='truncate text-[12px] text-stone-500'>
                    {language.nativeLabel}
                  </span>
                ) : null}
              </span>
              <Check
                size={14}
                className='shrink-0 text-stone-300 opacity-0 group-data-selected:opacity-100'
              />
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}

function LanguageBadge({ code }: { code: string }) {
  return (
    <span className='inline-flex h-5 min-w-8 shrink-0 items-center justify-center rounded-md border border-white/8 bg-white/6 px-1.5 font-mono text-[10px] font-semibold text-stone-300'>
      {code.toUpperCase()}
    </span>
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

function TomlPreview({ content }: { content: string }) {
  const normalizedContent = content.replace(/\n+$/, '');
  const lines = normalizedContent.length > 0 ? normalizedContent.split('\n') : [];

  return (
    <pre className='relay-scroll h-full min-h-0 flex-1 overflow-auto rounded-xl border border-white/8 bg-black/24 px-3.5 py-3 font-mono text-[11.5px] leading-5 text-stone-300'>
      <code>
        {lines.map((line, index) => (
          <span key={`${String(index)}-${line}`} className='block'>
            {renderTomlLine(line)}
          </span>
        ))}
      </code>
    </pre>
  );
}

function formatExtensions(extensions: string[]): string {
  return extensions.map(extension => `.${extension}`).join(', ');
}

function formatGlobExtensions(extensions: string[]): string {
  return extensions.map(extension => `*.${extension}`).join(', ');
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
