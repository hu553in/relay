import type { ServiceHealth } from '@/lib/types';

const HEALTH_LABELS: Record<ServiceHealth, string> = {
  ready: 'Ready',
  degraded: 'Degraded',
  unavailable: 'Unavailable',
  busy: 'Busy',
  unknown: 'Unknown',
};

export function HealthBadge({ health }: { health: ServiceHealth }) {
  const tone =
    health === 'ready'
      ? 'bg-emerald-400/15 text-emerald-200'
      : health === 'degraded' || health === 'unavailable'
        ? 'bg-rose-500/15 text-rose-200'
        : 'bg-white/8 text-slate-300';
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] ${tone}`}
    >
      {HEALTH_LABELS[health]}
    </span>
  );
}
