import type { LogEntry } from '@/components/SegmentLogPanel';
import type { SegmentRecord } from '@/lib/types';

export interface SegmentLogText {
  translationFailed: string;
  translationPending: string;
  translationUnavailable: string;
}

export function translationText(
  segment: Pick<SegmentRecord, 'translation' | 'status'>,
  text: SegmentLogText
): string {
  if (segment.translation) {
    return segment.translation;
  }
  if (segment.status === 'translationFailed') {
    return text.translationFailed;
  }
  if (segment.status === 'translated' || segment.status === 'transcribed') {
    return text.translationUnavailable;
  }
  return text.translationPending;
}

function afterClear(segments: SegmentRecord[], clearedAtMs: number | null): SegmentRecord[] {
  if (clearedAtMs === null) {
    return segments;
  }
  return segments.filter(segment => segment.createdAtMs > clearedAtMs);
}

export interface SegmentLogs {
  transcriptSegments: SegmentRecord[];
  translatedSegments: SegmentRecord[];
  originalEntries: LogEntry[];
  translationEntries: LogEntry[];
}

export interface BuildSegmentLogsOptions {
  idPrefix: string;
  maxRows?: number;
  transcriptClearedAtMs: number | null;
  translationClearedAtMs: number | null;
  text: SegmentLogText;
}

export function buildSegmentLogs(
  segments: SegmentRecord[],
  options: BuildSegmentLogsOptions
): SegmentLogs {
  const ordered = [...segments].reverse();

  let transcriptSegments = afterClear(ordered, options.transcriptClearedAtMs);
  let translatedSegments = afterClear(ordered, options.translationClearedAtMs);

  if (typeof options.maxRows === 'number') {
    transcriptSegments = transcriptSegments.slice(-options.maxRows);
    translatedSegments = translatedSegments.slice(-options.maxRows);
  }

  const originalEntries: LogEntry[] = transcriptSegments.map(segment => ({
    id: `${options.idPrefix}original-${segment.id}`,
    timestampMs: segment.createdAtMs,
    source: segment.source,
    text: segment.transcript,
    status: segment.status,
  }));
  const translationEntries: LogEntry[] = translatedSegments.map(segment => ({
    id: `${options.idPrefix}translation-${segment.id}`,
    timestampMs: segment.createdAtMs,
    source: segment.source,
    text: translationText(segment, options.text),
    status: segment.status,
  }));

  return { transcriptSegments, translatedSegments, originalEntries, translationEntries };
}
