import { Copy } from 'lucide-react';
import type { ReactNode } from 'react';

import { IconButton } from '@/components/shared/IconButton';
import { useLiveLogScroll } from '@/hooks/useLiveLogScroll';
import { formatTime } from '@/lib/format';
import type { InputSource, SegmentStatus } from '@/lib/types';

export interface LogEntry {
  id: string;
  timestampMs: number;
  source?: InputSource;
  text: string;
  status?: SegmentStatus;
  tone?: 'default' | 'info' | 'warning' | 'error';
}

export function SegmentLogPanel({
  title,
  language,
  icon,
  entries,
  compact = false,
  live = false,
  footer,
  actions,
  emptyText = 'Waiting for live segments.',
  onCopyError,
}: {
  title: string;
  language?: string;
  icon: ReactNode;
  entries: LogEntry[];
  compact?: boolean;
  live?: boolean;
  footer?: ReactNode;
  actions?: ReactNode;
  emptyText?: string;
  onCopyError?: (reason: unknown) => void;
}) {
  const { autoFollow, containerRef, handleScroll, jumpToLatest } = useLiveLogScroll(entries.length);

  async function copyLog() {
    const payload = entries
      .map(entry => `[${formatTime(entry.timestampMs)}] ${entry.text}`)
      .join('\n')
      .trim();
    if (!payload) {
      return;
    }
    try {
      await navigator.clipboard.writeText(payload);
    } catch (reason) {
      onCopyError?.(reason);
    }
  }

  return (
    <section className='flex min-h-0 min-w-0 flex-col rounded-[26px] border border-white/8 bg-[rgba(10,15,26,0.7)] shadow-[0_24px_80px_rgba(0,0,0,0.22)] backdrop-blur-2xl'>
      <header
        className={`flex items-center justify-between gap-3 border-b border-white/8 ${
          compact ? 'px-3.5 py-3' : 'px-4.5 py-3.5'
        }`}
      >
        <div className='flex min-w-0 items-center gap-2.5'>
          <span className='grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/4 text-[15px] text-cyan-200'>
            {icon}
          </span>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <h3
                className={`${compact ? 'text-[15px]' : 'text-[16px]'} font-medium tracking-tight text-white`}
              >
                {title}
              </h3>
              {language ? (
                <span className='rounded-full bg-white/6 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-slate-300'>
                  {language.toUpperCase()}
                </span>
              ) : null}
              {live ? (
                <span className='rounded-full bg-emerald-400/12 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-emerald-200'>
                  Live
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className='flex items-center gap-1.5'>
          {actions}
          <IconButton label='Copy log' onClick={() => void copyLog()} icon={<Copy size={14} />} />
        </div>
      </header>

      <div className='relative min-h-0 flex-1 px-2.5 pb-2'>
        <div
          ref={containerRef}
          onScroll={handleScroll}
          role='log'
          aria-live='polite'
          aria-relevant='additions'
          className={`relay-scroll h-full overflow-y-auto rounded-[20px] pr-1 ${
            compact ? 'px-3 py-2.5' : 'px-4 py-3'
          }`}
        >
          {entries.length === 0 ? (
            <div className='grid h-full min-h-32 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/2 px-4 py-6 text-center text-[13px] text-slate-500'>
              {emptyText}
            </div>
          ) : (
            <div className='grid gap-1.5'>
              {entries.map(entry => (
                <LogRow key={entry.id} entry={entry} compact={compact} />
              ))}
            </div>
          )}
        </div>

        {!autoFollow && entries.length > 0 ? (
          <button
            type='button'
            onClick={jumpToLatest}
            className='absolute bottom-4 right-4 rounded-full border border-cyan-300/20 bg-[rgba(13,21,36,0.92)] px-3 py-1.5 text-[11px] font-medium text-cyan-200 shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition hover:bg-[rgba(18,28,46,0.96)]'
          >
            Jump to latest
          </button>
        ) : null}
      </div>

      <footer
        className={`flex items-center justify-between gap-3 border-t border-white/8 text-[11px] ${
          compact ? 'px-3.5 py-2' : 'px-4.5 py-2.5'
        } text-slate-500`}
      >
        {footer ?? (
          <div className='flex w-full items-center justify-between gap-3'>
            <span>{autoFollow ? 'Auto-scroll enabled' : 'Browsing history'}</span>
            <span>{entries.length} lines</span>
          </div>
        )}
      </footer>
    </section>
  );
}

function LogRow({ entry, compact }: { entry: LogEntry; compact: boolean }) {
  const dotClass = entry.source
    ? entry.source === 'microphone'
      ? 'bg-cyan-300/85'
      : 'bg-emerald-300/85'
    : entry.tone === 'error'
      ? 'bg-rose-300/85'
      : entry.tone === 'warning'
        ? 'bg-amber-300/85'
        : entry.tone === 'info'
          ? 'bg-sky-300/85'
          : 'bg-slate-300/75';
  const textClass =
    entry.status === 'translationFailed' || entry.tone === 'error'
      ? 'text-rose-200/90'
      : entry.tone === 'warning'
        ? 'text-amber-100'
        : 'text-slate-100';

  return (
    <div className='grid grid-cols-[10px_64px_1fr] items-start gap-3 rounded-xl px-2.5 py-1.5 transition hover:bg-white/[0.035]'>
      <span className={`mt-1.75 h-2 w-2 rounded-full ${dotClass}`} />
      <span className='pt-px text-[11px] tabular-nums text-slate-500'>
        {formatTime(entry.timestampMs)}
      </span>
      <p
        className={`min-w-0 ${compact ? 'text-[13px] leading-[1.45]' : 'text-[13.5px] leading-normal'} ${textClass}`}
      >
        {entry.text}
      </p>
    </div>
  );
}
