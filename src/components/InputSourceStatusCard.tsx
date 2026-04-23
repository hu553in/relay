import { Switch } from '@/components/shared/Switch';
import type { SourceState } from '@/lib/types';

type SourceStatusKey = 'disabled' | 'unavailable' | 'error' | 'active' | 'ready';

const STATUS_LABELS: Record<SourceStatusKey, string> = {
  disabled: 'Disabled',
  unavailable: 'Unavailable',
  error: 'Error',
  active: 'Active',
  ready: 'Ready',
};

export function InputSourceStatusCard({
  title,
  source,
  onToggle,
}: {
  title: string;
  source: SourceState;
  onToggle: (enabled: boolean) => void;
}) {
  const status = sourceStatus(source);
  const barPercent = source.enabled && source.available ? (source.inputLevel ?? 0) : 0;
  const barClass =
    barPercent >= 75 ? 'bg-rose-500' : barPercent >= 45 ? 'bg-amber-400' : 'bg-emerald-400';
  const statusTone =
    status === 'active' || status === 'ready'
      ? 'ready'
      : status === 'disabled'
        ? 'neutral'
        : 'error';
  const showLevel = source.enabled && source.available;
  const showError = source.health === 'degraded' || source.health === 'unavailable';

  return (
    <article className='rounded-2xl border border-white/8 bg-white/3 p-4'>
      <div className='flex items-center justify-between gap-3'>
        <p className='text-sm font-medium text-white'>{title}</p>
        <div className='flex items-center gap-2'>
          <StatusBadge value={status} tone={statusTone} />
          <Switch checked={source.enabled} disabled={!source.available} onChange={onToggle} />
        </div>
      </div>

      {showLevel ? (
        <div className='mt-4'>
          <div className='mb-2 flex items-center justify-between text-[11px] tracking-[0.12em] text-slate-500'>
            <span>Input level</span>
            <span className='tabular-nums'>{barPercent}%</span>
          </div>
          <div className='h-1.5 rounded-full bg-white/5'>
            <div
              className={`h-1.5 rounded-full transition-all duration-200 ${barClass}`}
              style={{ width: `${String(barPercent)}%` }}
            />
          </div>
        </div>
      ) : null}

      {showError ? (
        <p className='mt-3 text-[12px] leading-5 text-rose-200/90'>
          {source.detail ?? 'Input unavailable'}
        </p>
      ) : null}
    </article>
  );
}

function sourceStatus(source: SourceState): SourceStatusKey {
  if (!source.enabled) return 'disabled';
  if (!source.available) return 'unavailable';
  if (source.health === 'degraded') return 'error';
  if (source.capturing) return 'active';
  return 'ready';
}

function StatusBadge({
  value,
  tone,
}: {
  value: SourceStatusKey;
  tone: 'ready' | 'neutral' | 'error';
}) {
  const className =
    tone === 'ready'
      ? 'bg-emerald-400/15 text-emerald-200'
      : tone === 'error'
        ? 'bg-rose-500/15 text-rose-200'
        : 'bg-white/8 text-slate-300';
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.04em] ${className}`}
    >
      {STATUS_LABELS[value]}
    </span>
  );
}
