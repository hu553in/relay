import { useDeferredValue, useMemo } from 'react';

import { buildSegmentLogs, type SegmentLogs } from '@/lib/segments';
import type { AppSnapshot, SegmentRecord } from '@/lib/types';

const EMPTY_SEGMENTS: SegmentRecord[] = [];

export function useSegmentLogEntries(
  snapshot: AppSnapshot | null,
  options: { idPrefix: string; maxRows?: number }
): SegmentLogs {
  const segments = useDeferredValue(snapshot?.segments ?? EMPTY_SEGMENTS);
  const transcriptClearedAtMs = snapshot?.transcriptClearedAtMs ?? null;
  const translationClearedAtMs = snapshot?.translationClearedAtMs ?? null;
  const { idPrefix, maxRows } = options;

  return useMemo(
    () =>
      buildSegmentLogs(segments, {
        idPrefix,
        transcriptClearedAtMs,
        translationClearedAtMs,
        ...(maxRows === undefined ? {} : { maxRows }),
      }),
    [segments, transcriptClearedAtMs, translationClearedAtMs, idPrefix, maxRows]
  );
}
