import {
  AudioLines,
  Captions,
  CaptionsOff,
  HeartPulse,
  Languages,
  Play,
  Settings,
  Square,
} from 'lucide-react';
import { type PropsWithChildren, useEffect, useState } from 'react';

import { InputSourceStatusCard } from '@/components/InputSourceStatusCard';
import { SegmentLogPanel } from '@/components/SegmentLogPanel';
import { HealthBadge } from '@/components/shared/HealthBadge';
import { ClearLogButton, IconButton } from '@/components/shared/IconButton';
import { LogoMark, WindowDragStrip, WindowShell } from '@/components/shared/WindowChrome';
import { ToastViewport } from '@/components/ToastViewport';
import { useSegmentLogEntries } from '@/hooks/useSegmentLogEntries';
import { useToastCenter } from '@/hooks/useToastCenter';
import { toErrorMessage } from '@/lib/errors';
import {
  formatDuration,
  formatMemoryCompact,
  formatMemoryPair,
  formatPercent,
  formatRelayCpu,
  listeningStateLabel,
} from '@/lib/format';
import {
  clearSegments,
  clearTranslationLog,
  getSystemMetrics,
  hideOverlay,
  showOverlay,
  showSettingsSection,
  startListening,
  stopListening,
  updateSettings,
} from '@/lib/relay';
import type {
  ListeningState,
  ModelRecord,
  RelaySnapshotState,
  ServiceHealth,
  SystemMetrics,
} from '@/lib/types';

export function ControlsWindow({ relay }: { relay: RelaySnapshotState }) {
  const snapshot = relay.snapshot;
  const [actionError, setActionError] = useState<string | null>(null);
  const { toasts, pushToast, dismissToast } = useToastCenter(snapshot?.diagnostics ?? []);
  const [showStats, setShowStats] = useState(false);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);

  const { originalEntries, translationEntries } = useSegmentLogEntries(snapshot, { idPrefix: '' });

  useEffect(() => {
    if (!showStats) {
      return;
    }

    let cancelled = false;
    const loadMetrics = async () => {
      try {
        const metrics = await getSystemMetrics();
        if (!cancelled) {
          setSystemMetrics(metrics);
        }
      } catch {
        if (!cancelled) {
          setSystemMetrics(null);
        }
      }
    };

    void loadMetrics();
    const handle = window.setInterval(() => {
      void loadMetrics();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [showStats]);

  const activeTranscription = snapshot?.models.find(
    model => model.kind === 'transcription' && model.state === 'active'
  );
  const activeTranslation = snapshot?.models.find(
    model => model.kind === 'translation' && model.state === 'active'
  );

  const sessionStartedAtMs = snapshot?.sessionStartedAtMs ?? null;

  if (relay.isLoading || !snapshot) {
    return <WindowShell message={relay.error ?? 'Loading Relay overview...'} />;
  }

  const state = snapshot.listeningState;
  const isListening = state === 'listening';
  const isBusy = state === 'starting' || state === 'stopping';
  const canStartListening = snapshot.sttHealth === 'ready';

  async function run(action: () => Promise<unknown>) {
    try {
      setActionError(null);
      await action();
    } catch (reason) {
      const message = toErrorMessage(reason);
      setActionError(message);
      pushToast({ title: 'Relay', message, tone: 'error' });
    }
  }

  return (
    <main className='relay-app-bg flex h-screen w-screen flex-col overflow-hidden text-slate-100'>
      <WindowDragStrip />
      <section className='min-h-0 flex-1 overflow-hidden'>
        <div className='mx-auto flex h-full max-w-350 min-h-0 flex-col gap-5 px-8 pb-6 pt-2'>
          <header className='rounded-[28px] border border-white/8 bg-[rgba(10,15,26,0.72)] px-6 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur-2xl'>
            <div className='flex flex-wrap items-center justify-between gap-4'>
              <div className='flex min-w-0 items-center gap-3'>
                <LogoMark listening={isListening} />
                <div className='min-w-0'>
                  <div className='flex items-center gap-3'>
                    <h1 className='text-[28px] font-semibold tracking-tight text-white'>Relay</h1>
                    <LiveBadge state={state} />
                  </div>
                </div>
              </div>

              <div className='flex flex-wrap items-center gap-2'>
                <IconButton
                  label={showStats ? 'Hide stats' : 'Show stats'}
                  onClick={() => {
                    setShowStats(value => !value);
                  }}
                  icon={<HeartPulse size={15} />}
                />
                <IconButton
                  label='Open settings'
                  onClick={() => void run(() => showSettingsSection('inputs'))}
                  icon={<Settings size={15} />}
                />
                <IconButton
                  label={snapshot.settings.overlay.visible ? 'Hide overlay' : 'Show overlay'}
                  onClick={() =>
                    void run(snapshot.settings.overlay.visible ? hideOverlay : showOverlay)
                  }
                  icon={
                    snapshot.settings.overlay.visible ? (
                      <CaptionsOff size={15} />
                    ) : (
                      <Captions size={15} />
                    )
                  }
                />
                <PrimaryButton
                  tone={isListening ? 'danger' : 'primary'}
                  disabled={isBusy || (!isListening && !canStartListening)}
                  onClick={() => void run(isListening ? stopListening : startListening)}
                >
                  {isListening ? <Square size={14} /> : <Play size={14} />}
                  <span>
                    {state === 'starting'
                      ? 'Starting...'
                      : state === 'stopping'
                        ? 'Stopping...'
                        : isListening
                          ? 'Stop listening'
                          : 'Start listening'}
                  </span>
                </PrimaryButton>
              </div>
            </div>
          </header>

          {actionError ? (
            <div className='rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100'>
              {actionError}
            </div>
          ) : null}

          {showStats ? (
            <div className='relay-scroll grid min-h-0 flex-1 content-start gap-3 overflow-y-auto rounded-3xl border border-white/8 bg-[rgba(10,15,26,0.58)] p-3'>
              <div className='grid gap-3 md:grid-cols-2'>
                <ModelCard
                  title='Transcription'
                  model={activeTranscription}
                  health={snapshot.sttHealth}
                />
                <ModelCard
                  title='Translation'
                  model={activeTranslation}
                  health={snapshot.translationHealth}
                />
              </div>
              <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
                <SessionClockPill
                  key={sessionStartedAtMs ?? 'idle'}
                  startedAtMs={sessionStartedAtMs}
                  accent={isListening}
                />
                <StatPill label='Segments' value={String(snapshot.sessionSegmentCount)} />
                <StatPill label='Translated' value={String(snapshot.sessionTranslationCount)} />
                <StatPill
                  label='Failed'
                  value={String(snapshot.sessionTranslationFailureCount)}
                  warn={snapshot.sessionTranslationFailureCount > 0}
                />
              </div>
              <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
                <MetricPill
                  label='System CPU'
                  value={formatPercent(systemMetrics?.systemCpuUsage)}
                />
                <MetricPill label='App CPU' value={formatRelayCpu(systemMetrics)} />
                <MetricPill
                  label='System memory'
                  value={formatMemoryPair(
                    systemMetrics?.memoryUsedBytes,
                    systemMetrics?.memoryTotalBytes
                  )}
                />
                <MetricPill
                  label='App memory'
                  value={formatMemoryCompact(systemMetrics?.processMemoryBytes)}
                />
                <TemperatureChipsCard metrics={systemMetrics} />
              </div>
            </div>
          ) : (
            <>
              <div className='grid shrink-0 gap-3 md:grid-cols-2'>
                <InputSourceStatusCard
                  title='Microphone'
                  source={snapshot.microphone}
                  onToggle={enabled =>
                    void run(() =>
                      updateSettings({
                        ...snapshot.settings,
                        microphoneEnabled: enabled,
                      })
                    )
                  }
                />
                <InputSourceStatusCard
                  title='System audio'
                  source={snapshot.systemAudio}
                  onToggle={enabled =>
                    void run(() =>
                      updateSettings({
                        ...snapshot.settings,
                        systemAudioEnabled: enabled,
                      })
                    )
                  }
                />
              </div>

              <section className='grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 overflow-hidden'>
                <SegmentLogPanel
                  title='Original'
                  language='EN'
                  icon={<AudioLines size={16} />}
                  entries={originalEntries}
                  live={isListening}
                  onCopyError={reason => {
                    pushToast({ title: 'Relay', message: toErrorMessage(reason), tone: 'error' });
                  }}
                  actions={
                    <ClearLogButton
                      label='Clear transcript log'
                      onClick={() => void run(clearSegments)}
                    />
                  }
                  footer={
                    <div className='flex w-full items-center justify-between gap-3'>
                      <SessionClockText
                        key={sessionStartedAtMs ?? 'idle'}
                        startedAtMs={sessionStartedAtMs}
                      />
                      <span>{listeningStateLabel(state)}</span>
                    </div>
                  }
                />
                <SegmentLogPanel
                  title='Translation'
                  language={snapshot.settings.translation.targetLanguage}
                  icon={<Languages size={16} />}
                  entries={translationEntries}
                  live={isListening}
                  onCopyError={reason => {
                    pushToast({ title: 'Relay', message: toErrorMessage(reason), tone: 'error' });
                  }}
                  actions={
                    <ClearLogButton
                      label='Clear translation log'
                      onClick={() => void run(clearTranslationLog)}
                    />
                  }
                  footer={
                    <div className='flex w-full items-center justify-between gap-3'>
                      <span>{snapshot.sessionTranslationCount} translated</span>
                      <span>{snapshot.sessionTranslationFailureCount} failed</span>
                    </div>
                  }
                />
              </section>
            </>
          )}
        </div>
      </section>
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}

function ModelCard({
  title,
  model,
  health,
}: {
  title: string;
  model: ModelRecord | undefined;
  health: ServiceHealth;
}) {
  return (
    <article className='rounded-2xl border border-white/8 bg-black/20 px-4 py-3'>
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <p className='text-[11px] font-medium text-slate-500'>{title}</p>
          <p className='mt-1 truncate text-sm text-cyan-200'>
            {model?.relativePath ?? model?.name ?? 'No model selected'}
          </p>
        </div>
        <HealthBadge health={health} />
      </div>
      <p className='mt-2 min-w-0 truncate text-[12px] text-slate-400'>
        {model?.path ?? model?.relativePath ?? 'Not selected'}
      </p>
    </article>
  );
}

function StatPill({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  const valueClass = warn ? 'text-rose-200' : accent ? 'text-cyan-200' : 'text-white';
  return (
    <div className='rounded-2xl border border-white/8 bg-black/20 px-4 py-3'>
      <p className='text-[11px] font-medium text-slate-500'>{label}</p>
      <p className={`mt-1 text-xl font-medium tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-2xl border border-white/8 bg-black/20 px-4 py-3'>
      <p className='text-[11px] font-medium text-slate-500'>{label}</p>
      <p className='mt-1 text-sm text-white tabular-nums' title={value}>
        {value}
      </p>
    </div>
  );
}

function TemperatureChipsCard({ metrics }: { metrics: SystemMetrics | null }) {
  const readings = hotTemperatureReadings(metrics);

  return (
    <div className='rounded-2xl border border-white/8 bg-black/20 px-4 py-3 sm:col-span-2'>
      <p className='text-[11px] font-medium text-slate-500'>Temperature sensors</p>
      {readings.length > 0 ? (
        <div className='mt-2 flex flex-wrap gap-2'>
          {readings.map(reading => (
            <span
              key={`${reading.label}-${String(reading.temperatureC)}`}
              className='inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/4 px-2.5 py-1 text-[12px] text-slate-300'
              title={reading.label}
            >
              <span className='max-w-40 truncate'>{reading.label}</span>
              <span className='font-medium tabular-nums text-white'>
                {reading.temperatureC.toFixed(0)} ℃
              </span>
            </span>
          ))}
        </div>
      ) : (
        <p className='mt-1 text-sm text-slate-400'>Unavailable</p>
      )}
    </div>
  );
}

function PrimaryButton({
  children,
  tone,
  onClick,
  disabled,
}: PropsWithChildren<{
  tone: 'primary' | 'secondary' | 'danger';
  onClick: () => void;
  disabled?: boolean;
}>) {
  const className =
    tone === 'primary'
      ? 'bg-gradient-to-br from-cyan-300 to-sky-400 text-slate-950 shadow-[0_8px_24px_rgba(56,182,255,0.35)] hover:brightness-110'
      : tone === 'danger'
        ? 'bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-[0_8px_24px_rgba(244,63,94,0.28)] hover:brightness-110'
        : 'border border-white/10 bg-white/[0.05] text-white hover:bg-white/[0.1]';
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

function LiveBadge({ state }: { state: ListeningState }) {
  if (state === 'listening') {
    return (
      <span className='inline-flex items-center gap-1.5 rounded-full bg-emerald-400/12 px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] text-emerald-200'>
        <span className='relay-dot-live block h-1.5 w-1.5 rounded-full bg-emerald-300' />
        Live
      </span>
    );
  }
  const tone =
    state === 'error'
      ? 'bg-rose-500/15 text-rose-200'
      : state === 'starting' || state === 'stopping'
        ? 'bg-amber-300/15 text-amber-200'
        : 'bg-white/8 text-slate-300';
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] ${tone}`}
    >
      {listeningStateLabel(state)}
    </span>
  );
}

function useSessionElapsed(startedAtMs: number | null): string {
  // Parent remounts this hook's host via `key={startedAtMs ?? 'idle'}` when the
  // session start changes, so the lazy initializer always reads a fresh `now`.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (startedAtMs === null) {
      return;
    }
    const handle = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(handle);
    };
  }, [startedAtMs]);
  return startedAtMs === null ? '00:00:00' : formatDuration(nowMs - startedAtMs);
}

function SessionClockPill({
  startedAtMs,
  accent,
}: {
  startedAtMs: number | null;
  accent: boolean;
}) {
  const elapsed = useSessionElapsed(startedAtMs);
  return <StatPill label='Live session' value={elapsed} accent={accent} />;
}

function SessionClockText({ startedAtMs }: { startedAtMs: number | null }) {
  const elapsed = useSessionElapsed(startedAtMs);
  return <span>{elapsed}</span>;
}

function hotTemperatureReadings(metrics: SystemMetrics | null) {
  if (!metrics || metrics.temperatures.length === 0) {
    return [];
  }
  return [...metrics.temperatures].sort((left, right) => right.temperatureC - left.temperatureC);
}
