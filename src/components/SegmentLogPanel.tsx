import { Copy } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/shared/Badge';
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
    <section className='flex min-h-0 min-w-0 flex-col rounded-2xl border border-white/8 bg-[rgba(17,17,16,0.74)] shadow-[0_12px_36px_rgba(0,0,0,0.18)]'>
      <header className='flex items-center justify-between gap-3 border-b border-white/8 px-4.5 py-3.5'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <span className='grid h-8 w-8 shrink-0 place-items-center text-[14px] text-stone-300'>
            {icon}
          </span>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <h3 className='text-[14.5px] font-medium text-white'>{title}</h3>
              {language ? (
                <Badge className='text-[10px] font-semibold tracking-(--relay-tracking-wide)'>
                  {language.toUpperCase()}
                </Badge>
              ) : null}
              {live ? (
                <Badge
                  tone='success'
                  className='text-[10px] font-semibold tracking-(--relay-tracking-wide)'
                >
                  Live
                </Badge>
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
          className='relay-scroll h-full overflow-y-auto rounded-[20px] px-4 py-3'
        >
          {entries.length === 0 ? (
            <div className='grid h-full min-h-32 place-items-center rounded-2xl border border-transparent bg-transparent px-4 py-6 text-center text-[12.5px] text-stone-500'>
              {emptyText}
            </div>
          ) : (
            <div className='grid gap-1.5'>
              {entries.map(entry => (
                <LogRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>

        {!autoFollow && entries.length > 0 ? (
          <button
            type='button'
            onClick={jumpToLatest}
            className='absolute bottom-4 right-4 rounded-lg border border-white/12 bg-[rgba(34,34,32,0.94)] px-3 py-1.5 text-[11px] font-medium text-stone-200 shadow-[0_10px_24px_var(--relay-shadow-soft)] transition hover:border-white/16 hover:bg-[rgba(50,50,47,0.96)] hover:text-white'
          >
            Jump to latest
          </button>
        ) : null}
      </div>

      <footer className='flex items-center justify-between gap-3 border-t border-white/8 px-4.5 py-2.5 text-[11px] text-stone-500'>
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

function LogRow({ entry }: { entry: LogEntry }) {
  const dotClass = entry.source
    ? entry.source === 'microphone'
      ? 'bg-stone-300/85'
      : 'bg-orange-300/85'
    : entry.tone === 'error'
      ? 'bg-rose-300/85'
      : entry.tone === 'warning'
        ? 'bg-amber-300/85'
        : entry.tone === 'info'
          ? 'bg-stone-300/85'
          : 'bg-stone-300/75';
  const textClass =
    entry.status === 'translationFailed' || entry.tone === 'error'
      ? 'text-rose-200/90'
      : entry.tone === 'warning'
        ? 'text-amber-100'
        : 'text-stone-100';

  return (
    <div className='grid grid-cols-[10px_64px_1fr] items-start gap-3 rounded-xl px-2.5 py-1.5 transition hover:bg-white/6.5'>
      <span className={`mt-1.75 h-2 w-2 rounded-full ${dotClass}`} />
      <span className='pt-px text-[11px] text-stone-500 tabular-nums'>
        {formatTime(entry.timestampMs)}
      </span>
      <p className={`min-w-0 wrap-break-word text-[13px] leading-normal ${textClass}`}>
        {entry.text}
      </p>
    </div>
  );
}
