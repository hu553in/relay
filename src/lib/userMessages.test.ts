import { describe, expect, it } from 'vitest';

import i18n from '@/i18n';
import { formatUserMessage } from '@/lib/userMessages';

describe('user-facing backend message formatting', () => {
  it('formats stable backend message codes through i18next', () => {
    expect(formatUserMessage({ code: 'source:readyDefaultInputDevice' }, i18n.t)).toBe(
      'Ready to capture the default input device'
    );
    expect(
      formatUserMessage(
        {
          code: 'diagnostics:startFailed',
          params: { error: i18n.t('runtime:whisperModelNotConfigured') },
        },
        i18n.t
      )
    ).toBe(
      'Failed to start listening: Whisper model is not configured. Set a local model directory and choose a .bin model in Settings.'
    );
  });

  it('passes through plain strings without translation', () => {
    expect(formatUserMessage('plain text', i18n.t)).toBe('plain text');
  });

  it('returns null for empty or missing input', () => {
    expect(formatUserMessage(null, i18n.t)).toBeNull();
    expect(formatUserMessage(undefined, i18n.t)).toBeNull();
  });

  it('falls back for unknown backend message codes', () => {
    expect(formatUserMessage({ code: 'missing:message' }, i18n.t)).toBe(
      'Unknown backend message: missing:message'
    );
  });

  it('falls back for unknown code even when params are present', () => {
    expect(formatUserMessage({ code: 'missing:message', params: { error: 'boom' } }, i18n.t)).toBe(
      'Unknown backend message: missing:message'
    );
  });

  it('translates model path detail without wrapping prefixes', () => {
    expect(
      formatUserMessage(
        { code: 'runtime:modelPath', params: { path: '/Users/you/models/ggml-small.bin' } },
        i18n.t
      )
    ).toBe('/Users/you/models/ggml-small.bin');

    expect(formatUserMessage({ code: 'runtime:chooseWhisperModel' }, i18n.t)).toBe(
      'Choose a Whisper model from the configured directory.'
    );
  });
});
