import { useDeferredValue, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { buildSegmentLogs, type SegmentLogs } from '@/lib/segments';
import type { AppSnapshot, SegmentRecord } from '@/lib/types';

const EMPTY_SEGMENTS: SegmentRecord[] = [];

export function useSegmentLogEntries(
  snapshot: AppSnapshot | null,
  options: { idPrefix: string; maxRows?: number }
): SegmentLogs {
  const { t } = useTranslation('logs');
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
        text: {
          translationFailed: t('translationFailed'),
          translationPending: t('translationPending'),
          translationUnavailable: t('translationUnavailable'),
        },
        ...(maxRows === undefined ? {} : { maxRows }),
      }),
    [segments, transcriptClearedAtMs, translationClearedAtMs, t, idPrefix, maxRows]
  );
}
