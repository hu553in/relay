import { AudioLines, Languages, X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { SegmentLogPanel } from '@/components/SegmentLogPanel';
import { Badge } from '@/components/shared/Badge';
import { ClearLogButton, IconButton } from '@/components/shared/IconButton';
import { LogoMark, WindowDragStrip } from '@/components/shared/WindowChrome';
import { ToastViewport } from '@/components/ToastViewport';
import { useAppConstants } from '@/hooks/useAppConstants';
import { useSegmentLogEntries } from '@/hooks/useSegmentLogEntries';
import { useToastCenter } from '@/hooks/useToastCenter';
import { toErrorMessage } from '@/lib/errors';
import { listeningStateLabel, listeningStateLabels, type TranslateFn } from '@/lib/format';
import { clearSegments, clearTranslationLog, hideOverlay } from '@/lib/relay';
import type { ListeningState, RelaySnapshotState } from '@/lib/types';

const OVERLAY_MAX_ROWS = 28;

export function OverlayWindow({ relay }: { relay: RelaySnapshotState }) {
  const { t } = useTranslation(['app', 'common', 'controls', 'listening', 'logs', 'overlay']);
  const snapshot = relay.snapshot;
  const constants = useAppConstants();
  const { toasts, pushToast, dismissToast } = useToastCenter(snapshot?.diagnostics);
  const { originalEntries, translationEntries } = useSegmentLogEntries(snapshot, {
    idPrefix: 'overlay-',
    maxRows: OVERLAY_MAX_ROWS,
  });

  useEffect(() => {
    document.body.classList.remove('bg-relay-bg');
    document.body.classList.add('bg-transparent');
    return () => {
      document.body.classList.remove('bg-transparent');
      document.body.classList.add('bg-relay-bg');
    };
  }, []);

  const state = snapshot?.listeningState ?? 'idle';
  const isLive = state === 'listening';
  const targetLanguage =
    snapshot?.settings.translation.targetLanguage ?? constants.defaultTargetLanguage;

  return (
    <main className='flex h-screen w-screen flex-col overflow-hidden bg-transparent text-stone-50'>
      <WindowDragStrip />
      <div className='flex min-h-0 flex-1 w-full overflow-hidden p-2.5'>
        <section className='flex h-full w-full flex-col overflow-hidden rounded-2xl border border-white/14 bg-[rgba(30,30,28,0.9)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_24px_72px_rgba(0,0,0,0.36)] backdrop-blur-xl [clip-path:inset(0_round_16px)]'>
          <header
            data-tauri-drag-region
            className='flex items-center justify-between gap-4 border-b border-white/8 px-5 py-3.5'
          >
            <div className='flex min-w-0 items-center gap-3'>
              <LogoMark listening={isLive} shrink />
              <div className='flex min-w-0 items-center gap-2'>
                <h1 className='mt-0.5 truncate text-[13px] font-medium text-white'>
                  {t('overlay:liveTranscription')}
                </h1>
                <StatusChip state={state} />
              </div>
            </div>
            <div data-tauri-drag-region='false' className='flex items-center gap-1.5'>
              <IconButton
                label={t('controls:hideOverlay')}
                icon={<X size={14} />}
                onClick={() => void hideOverlay()}
              />
            </div>
          </header>

          <div className='grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2.5 overflow-hidden p-2.5'>
            <SegmentLogPanel
              title={t('logs:original')}
              language='EN'
              icon={<AudioLines size={16} />}
              entries={originalEntries}
              live={isLive}
              onCopyError={reason => {
                pushToast({
                  title: t('app:toastTitle'),
                  message: toErrorMessage(reason),
                  tone: 'error',
                });
              }}
              actions={
                <ClearLogButton
                  label={t('logs:clearTranscript')}
                  disabled={originalEntries.length === 0}
                  onClick={() => void clearSegments()}
                />
              }
              footer={
                <div className='flex w-full items-center justify-between gap-3'>
                  <span>
                    {listeningStateLabel(state, listeningStateLabels(t as unknown as TranslateFn))}
                  </span>
                  <span>{t('common:lineCount', { count: originalEntries.length })}</span>
                </div>
              }
            />
            <SegmentLogPanel
              title={t('logs:translation')}
              language={targetLanguage}
              icon={<Languages size={16} />}
              entries={translationEntries}
              live={isLive}
              onCopyError={reason => {
                pushToast({
                  title: t('app:toastTitle'),
                  message: toErrorMessage(reason),
                  tone: 'error',
                });
              }}
              actions={
                <ClearLogButton
                  label={t('logs:clearTranslation')}
                  disabled={translationEntries.length === 0}
                  onClick={() => void clearTranslationLog()}
                />
              }
              footer={
                <div className='flex w-full items-center justify-between gap-3'>
                  <span>{targetLanguage.toUpperCase()}</span>
                  <span>{t('common:lineCount', { count: translationEntries.length })}</span>
                </div>
              }
            />
          </div>
        </section>
      </div>

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}

function StatusChip({ state }: { state: ListeningState }) {
  const { t } = useTranslation(['common', 'listening']);
  const tone =
    state === 'listening'
      ? 'success'
      : state === 'error'
        ? 'danger'
        : state === 'starting'
          ? 'warning'
          : 'neutral';
  return (
    <Badge tone={tone} size='md'>
      {state === 'listening' ? (
        <span className='relay-dot-live block h-1.5 w-1.5 rounded-full bg-emerald-300' />
      ) : null}
      {listeningStateLabel(state, listeningStateLabels(t as unknown as TranslateFn))}
    </Badge>
  );
}
