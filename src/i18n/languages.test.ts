import { describe, expect, it } from 'vitest';

import { normalizeUiLanguage, uiLanguages } from '@/i18n/languages';
import { fallbackLanguage, resources, supportedLanguages } from '@/i18n/resources';
import { targetLanguageName } from '@/i18n/targetLanguages';

describe('i18n language registry', () => {
  it('falls back unsupported UI language values to English', () => {
    expect(normalizeUiLanguage('en')).toBe('en');
    expect(normalizeUiLanguage(' EN ')).toBe('en');
    expect(normalizeUiLanguage('missing')).toBe('en');
    expect(normalizeUiLanguage('')).toBe('en');
    expect(normalizeUiLanguage(null)).toBe('en');
  });

  it('discovers English as the source-of-truth locale', () => {
    expect(uiLanguages.some(language => language.code === 'en')).toBe(true);
    expect(resources['en']?.settings?.interface.uiLanguage).toBe('UI language');
  });

  it('does not duplicate English in language lists', () => {
    const enCountSupported = supportedLanguages.filter(code => code === 'en').length;
    const enCountUiLanguages = uiLanguages.filter(language => language.code === 'en').length;
    expect(enCountSupported).toBe(1);
    expect(enCountUiLanguages).toBe(1);
  });

  it('uses English as the fallback language', () => {
    expect(fallbackLanguage).toBe('en');
    expect(supportedLanguages.includes(fallbackLanguage)).toBe(true);
  });

  it('formats target language names through Intl.DisplayNames', () => {
    expect(targetLanguageName('de', 'en')).toBe('German');
    expect(targetLanguageName('custom-language', 'en')).toBe('custom-language');
  });
});
