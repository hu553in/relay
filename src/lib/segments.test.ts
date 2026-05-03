import { describe, expect, it } from 'vitest';

import { buildSegmentLogs, translationText } from '@/lib/segments';
import type { SegmentRecord } from '@/lib/types';

function segment(overrides: Partial<SegmentRecord>): SegmentRecord {
  return {
    id: 'segment',
    source: 'microphone',
    createdAtMs: 0,
    transcript: 'hello',
    translation: null,
    status: 'transcribed',
    ...overrides,
  };
}

describe('buildSegmentLogs', () => {
  it('keeps the latest rows in chronological display order for bounded overlays', () => {
    const logs = buildSegmentLogs(
      [
        segment({ id: 'newest', createdAtMs: 30, transcript: 'newest' }),
        segment({ id: 'middle', createdAtMs: 20, transcript: 'middle' }),
        segment({ id: 'oldest', createdAtMs: 10, transcript: 'oldest' }),
      ],
      {
        idPrefix: 'overlay-',
        maxRows: 2,
        transcriptClearedAtMs: null,
        translationClearedAtMs: null,
      }
    );

    expect(logs.originalEntries.map(entry => entry.id)).toEqual([
      'overlay-original-middle',
      'overlay-original-newest',
    ]);
    expect(logs.originalEntries.map(entry => entry.text)).toEqual(['middle', 'newest']);
  });

  it('filters transcript and translation logs by their independent clear markers', () => {
    const logs = buildSegmentLogs(
      [
        segment({
          id: 'after',
          createdAtMs: 30,
          transcript: 'after transcript',
          translation: 'after translation',
          status: 'translated',
        }),
        segment({
          id: 'between',
          createdAtMs: 20,
          transcript: 'between transcript',
          translation: 'between translation',
          status: 'translated',
        }),
        segment({
          id: 'before',
          createdAtMs: 10,
          transcript: 'before transcript',
          translation: 'before translation',
          status: 'translated',
        }),
      ],
      {
        idPrefix: '',
        transcriptClearedAtMs: 15,
        translationClearedAtMs: 25,
      }
    );

    expect(logs.originalEntries.map(entry => entry.id)).toEqual([
      'original-between',
      'original-after',
    ]);
    expect(logs.translationEntries.map(entry => entry.id)).toEqual(['translation-after']);
  });
});

describe('translationText', () => {
  it('uses explicit failure text only when no translation payload exists', () => {
    expect(translationText({ translation: null, status: 'translationFailed' })).toBe(
      'Translation failed'
    );
    expect(
      translationText({ translation: 'backend failure text', status: 'translationFailed' })
    ).toBe('backend failure text');
  });
});
