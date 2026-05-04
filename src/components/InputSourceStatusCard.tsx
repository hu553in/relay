import { useTranslation } from 'react-i18next';

import { Badge, type BadgeTone } from '@/components/shared/Badge';
import { Switch } from '@/components/shared/Switch';
import type { SourceState } from '@/lib/types';
import { formatUserMessage } from '@/lib/userMessages';

type SourceStatusKey = 'disabled' | 'unavailable' | 'error' | 'active' | 'ready';

export function InputSourceStatusCard({
  title,
  source,
  onToggle,
}: {
  title: string;
  source: SourceState;
  onToggle: (enabled: boolean) => void;
}) {
  const { t } = useTranslation(['common', 'controls', 'diagnostics', 'source']);
  const status = sourceStatus(source);
  const showLevel = source.enabled && source.available && source.capturing;
  const barPercent = showLevel ? (source.inputLevel ?? 0) : 0;
  const barClass =
    barPercent >= 75 ? 'bg-rose-500' : barPercent >= 45 ? 'bg-orange-400' : 'bg-stone-300';
  const statusTone =
    status === 'active' || status === 'ready'
      ? 'success'
      : status === 'disabled'
        ? 'neutral'
        : 'danger';
  const showError =
    source.enabled && (source.health === 'degraded' || source.health === 'unavailable');
  const switchDisabled = !source.enabled && !source.available;

  return (
    <article className='rounded-xl border border-white/6 bg-[rgba(24,24,22,0.58)] px-3.5 py-3'>
      <div className='flex items-center justify-between gap-3'>
        <p className='text-[13px] font-medium text-white'>{title}</p>
        <div className='flex items-center gap-2'>
          <StatusBadge value={status} tone={statusTone} />
          <Switch checked={source.enabled} disabled={switchDisabled} onChange={onToggle} />
        </div>
      </div>

      {showLevel ? (
        <div className='mt-3'>
          <div className='mb-1.5 flex items-center justify-between text-[10.5px] font-medium text-stone-500'>
            <span>{t('controls:inputLevel')}</span>
            <span className='tabular-nums'>{barPercent}%</span>
          </div>
          <div className='h-1 rounded-full bg-white/5'>
            <div
              className={`h-1 rounded-full transition-all duration-200 ${barClass}`}
              style={{ width: `${String(barPercent)}%` }}
            />
          </div>
        </div>
      ) : null}

      {showError ? (
        <p className='mt-2.5 text-[12px] leading-5 text-rose-200/90'>
          {source.detail ? formatUserMessage(source.detail, t) : t('controls:inputUnavailable')}
        </p>
      ) : null}
    </article>
  );
}

function sourceStatus(source: SourceState): SourceStatusKey {
  if (!source.enabled) return 'disabled';
  if (!source.available) return 'unavailable';
  if (source.health === 'degraded' || source.health === 'unavailable') return 'error';
  if (source.capturing) return 'active';
  return 'ready';
}

function StatusBadge({ value, tone }: { value: SourceStatusKey; tone: BadgeTone }) {
  const { t } = useTranslation('common');
  const labels: Record<SourceStatusKey, string> = {
    disabled: t('disabled'),
    unavailable: t('unavailable'),
    error: t('error'),
    active: t('active'),
    ready: t('ready'),
  };
  return <Badge tone={tone}>{labels[value]}</Badge>;
}
