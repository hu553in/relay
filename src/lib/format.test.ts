import { describe, expect, it } from 'vitest';

import { formatByteSize, formatPercent, formatRelayCpu, formatTemperatureC } from '@/lib/format';
import type { SystemMetrics } from '@/lib/types';

function metrics(processCpuUsage: number | null): SystemMetrics {
  return {
    collectedAtMs: 0,
    cpuLogicalCores: 4,
    systemCpuUsage: 0,
    processCpuUsage,
    memoryUsedBytes: 0,
    memoryTotalBytes: 0,
    processMemoryBytes: null,
    swapUsedBytes: 0,
    swapTotalBytes: 0,
    temperatures: [],
  };
}

describe('numeric formatters', () => {
  it('uses fallbacks for non-finite percentages and byte sizes', () => {
    expect(formatPercent(Number.POSITIVE_INFINITY, 'Unavailable', 'en')).toBe('Unavailable');
    expect(formatPercent(Number.NaN, 'Unavailable', 'en')).toBe('Unavailable');
    expect(
      formatByteSize(Number.POSITIVE_INFINITY, {
        fallback: 'Unknown',
        detail: 'compact',
      })
    ).toBe('Unknown');
  });

  it('uses fallback for non-finite process cpu samples', () => {
    expect(formatRelayCpu(metrics(Number.POSITIVE_INFINITY), 'Unavailable', 'en')).toBe(
      'Unavailable'
    );
    expect(formatRelayCpu(metrics(Number.NaN), 'Unavailable', 'en')).toBe('Unavailable');
    expect(formatRelayCpu(metrics(200), 'Unavailable', 'en')).toBe('50%');
  });

  it('formats temperatures with the Celsius symbol and translated fallback', () => {
    expect(formatTemperatureC(37.4, 'Unavailable', 'en')).toBe('37 ℃');
    expect(formatTemperatureC(Number.NaN, 'Unavailable', 'en')).toBe('Unavailable');
  });
});
