import { describe, expect, it } from 'vitest';

import { parseIntegerSetting } from '@/components/settings/MaxTokensField';

describe('parseIntegerSetting', () => {
  const bounds = { fallback: 10, min: 1, max: 20 };

  it('clamps finite integer-like input to backend bounds', () => {
    expect(parseIntegerSetting('21', bounds)).toBe(20);
    expect(parseIntegerSetting('-4', bounds)).toBe(10);
    expect(parseIntegerSetting('1.9', bounds)).toBe(1);
  });

  it('uses fallback for empty or non-numeric input', () => {
    expect(parseIntegerSetting('', bounds)).toBe(10);
    expect(parseIntegerSetting('not a number', bounds)).toBe(10);
  });
});
