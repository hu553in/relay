import { AudioLines, Languages, X } from 'lucide-react';
import { useEffect } from 'react';

import { SegmentLogPanel } from '@/components/SegmentLogPanel';
import { ClearLogButton, IconButton } from '@/components/shared/IconButton';
import { LogoMark, WindowDragStrip } from '@/components/shared/WindowChrome';
import { ToastViewport } from '@/components/ToastViewport';
import { useSegmentLogEntries } from '@/hooks/useSegmentLogEntries';
import { useToastCenter } from '@/hooks/useToastCenter';
import { toErrorMessage } from '@/lib/errors';
import { listeningStateLabel } from '@/lib/format';
import { clearSegments, clearTranslationLog, hideOverlay } from '@/lib/relay';
import type { ListeningState, RelaySnapshotState } from '@/lib/types';

const OVERLAY_MAX_ROWS = 28;

export function OverlayWindow({ relay }: { relay: RelaySnapshotState }) {
  const snapshot = relay.snapshot;
  const { toasts, pushToast, dismissToast } = useToastCenter(snapshot?.diagnostics ?? []);
  const { originalEntries, translationEntries } = useSegmentLogEntries(snapshot, {
    idPrefix: 'overlay-',
    maxRows: OVERLAY_MAX_ROWS,
  });

  useEffect(() => {
    document.body.classList.add('relay-transparent');
    return () => {
      document.body.classList.remove('relay-transparent');
    };
  }, []);

  const state = snapshot?.listeningState ?? 'idle';
  const isLive = state === 'listening';
  const targetLanguage = snapshot?.settings.translation.targetLanguage ?? 'en';

  return (
    <main className='flex h-screen w-screen flex-col overflow-hidden bg-transparent text-slate-50'>
      <WindowDragStrip />
      <div className='flex min-h-0 flex-1 w-full overflow-hidden p-3'>
        <section className='flex h-full w-full flex-col overflow-hidden rounded-[28px] border border-white/14 bg-[linear-gradient(145deg,rgba(10,14,24,0.78),rgba(16,20,38,0.62))] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_40px_120px_rgba(0,0,0,0.45)] backdrop-blur-[36px] [clip-path:inset(0_round_28px)]'>
          <header
            data-tauri-drag-region
            className='flex items-center justify-between gap-4 border-b border-white/8 px-5 py-3.5'
          >
            <div className='flex min-w-0 items-center gap-3'>
              <LogoMark listening={isLive} shrink />
              <div className='flex min-w-0 items-center gap-2'>
                <h1 className='mt-0.5 truncate text-sm font-medium tracking-tight text-white'>
                  Live transcription
                </h1>
                <StatusChip state={state} />
              </div>
            </div>
            <div data-tauri-drag-region='false' className='flex items-center gap-1.5'>
              <IconButton
                label='Hide overlay'
                icon={<X size={14} />}
                onClick={() => void hideOverlay()}
              />
            </div>
          </header>

          <div className='grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 overflow-hidden p-3'>
            <SegmentLogPanel
              title='Original'
              language='EN'
              icon={<AudioLines size={16} />}
              entries={originalEntries}
              compact
              live={isLive}
              onCopyError={reason => {
                pushToast({ title: 'Relay', message: toErrorMessage(reason), tone: 'error' });
              }}
              actions={
                <ClearLogButton label='Clear transcript log' onClick={() => void clearSegments()} />
              }
              footer={
                <div className='flex w-full items-center justify-between gap-3'>
                  <span>{listeningStateLabel(state)}</span>
                  <span>{originalEntries.length} lines</span>
                </div>
              }
            />
            <SegmentLogPanel
              title='Translation'
              language={targetLanguage}
              icon={<Languages size={16} />}
              entries={translationEntries}
              compact
              live={isLive}
              onCopyError={reason => {
                pushToast({ title: 'Relay', message: toErrorMessage(reason), tone: 'error' });
              }}
              actions={
                <ClearLogButton
                  label='Clear translation log'
                  onClick={() => void clearTranslationLog()}
                />
              }
              footer={
                <div className='flex w-full items-center justify-between gap-3'>
                  <span>{targetLanguage.toUpperCase()}</span>
                  <span>{translationEntries.length} lines</span>
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
  const tone =
    state === 'listening'
      ? 'bg-emerald-400/12 text-emerald-200'
      : state === 'error'
        ? 'bg-rose-500/15 text-rose-200'
        : state === 'starting' || state === 'stopping'
          ? 'bg-amber-300/15 text-amber-200'
          : 'bg-white/8 text-slate-300';
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.04em] ${tone}`}
    >
      {listeningStateLabel(state)}
    </span>
  );
}
