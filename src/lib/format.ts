import type { ListeningState, SystemMetrics } from '@/lib/types';

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function formatTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatPercent(
  value: number | null | undefined,
  fallback: string,
  language: string
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return new Intl.NumberFormat(language, {
    maximumFractionDigits: 0,
    style: 'percent',
  }).format(value / 100);
}

interface ByteFormatOptions {
  fallback: string;
  detail: 'compact' | 'detailed';
}

export function formatByteSize(
  value: number | null | undefined,
  { fallback, detail }: ByteFormatOptions
): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  if (detail === 'detailed' && value < 1024 * 1024) {
    return `${String(Math.round(value / 1024))} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    const mb = value / (1024 * 1024);
    return detail === 'detailed' ? `${mb.toFixed(1)} MB` : `${mb.toFixed(0)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatMemoryCompact(value: number | null | undefined, fallback: string): string {
  return formatByteSize(value, { fallback, detail: 'compact' });
}

export function formatMemoryPair(
  used: number | null | undefined,
  total: number | null | undefined,
  fallback: string
): string {
  if (
    typeof used !== 'number' ||
    typeof total !== 'number' ||
    !Number.isFinite(used) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return fallback;
  }
  return `${formatMemoryCompact(used, fallback)} / ${formatMemoryCompact(total, fallback)}`;
}

export function formatModelSize(value: number | null | undefined, fallback: string): string {
  return formatByteSize(value, { fallback, detail: 'detailed' });
}

export interface ListeningStateLabels {
  error: string;
  idle: string;
  listening: string;
  starting: string;
}

export function listeningStateLabel(state: ListeningState, labels: ListeningStateLabels): string {
  switch (state) {
    case 'listening':
      return labels.listening;
    case 'error':
      return labels.error;
    case 'starting':
      return labels.starting;
    default:
      return labels.idle;
  }
}

export type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export function listeningStateLabels(
  t: (key: string, options?: Record<string, unknown>) => string
): ListeningStateLabels {
  return {
    error: t('common:error'),
    idle: t('common:idle'),
    listening: t('listening:listening'),
    starting: t('listening:starting'),
  };
}

export function formatRelayCpu(
  metrics: SystemMetrics | null,
  fallback: string,
  language: string
): string {
  if (
    !metrics ||
    typeof metrics.processCpuUsage !== 'number' ||
    !Number.isFinite(metrics.processCpuUsage)
  ) {
    return fallback;
  }
  const divisor = Math.max(1, metrics.cpuLogicalCores);
  return formatPercent(Math.min(100, metrics.processCpuUsage / divisor), fallback, language);
}

export function formatTemperatureC(
  value: number | null | undefined,
  fallback: string,
  language: string
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const formatted = new Intl.NumberFormat(language, {
    maximumFractionDigits: 0,
  }).format(value);
  return `${formatted} ℃`;
}
