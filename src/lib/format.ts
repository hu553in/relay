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

export function formatPercent(value: number | null | undefined, fallback = 'Unavailable'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return `${value.toFixed(0)}%`;
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

export function formatMemoryCompact(value: number | null | undefined): string {
  return formatByteSize(value, { fallback: 'Unavailable', detail: 'compact' });
}

export function formatMemoryPair(
  used: number | null | undefined,
  total: number | null | undefined
): string {
  if (
    typeof used !== 'number' ||
    typeof total !== 'number' ||
    !Number.isFinite(used) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return 'Unavailable';
  }
  return `${formatMemoryCompact(used)} / ${formatMemoryCompact(total)}`;
}

export function formatModelSize(value: number | null | undefined): string {
  return formatByteSize(value, { fallback: 'Unknown size', detail: 'detailed' });
}

export function listeningStateLabel(state: ListeningState): string {
  switch (state) {
    case 'listening':
      return 'Listening';
    case 'error':
      return 'Error';
    case 'starting':
      return 'Starting';
    default:
      return 'Idle';
  }
}

export function formatRelayCpu(metrics: SystemMetrics | null): string {
  if (
    !metrics ||
    typeof metrics.processCpuUsage !== 'number' ||
    !Number.isFinite(metrics.processCpuUsage)
  ) {
    return 'Unavailable';
  }
  const divisor = Math.max(1, metrics.cpuLogicalCores);
  return `${Math.min(100, metrics.processCpuUsage / divisor).toFixed(0)}%`;
}
