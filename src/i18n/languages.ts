import { fallbackLanguage, supportedLanguages, uiLanguages } from '@/i18n/resources';

export { uiLanguages };

export function normalizeUiLanguage(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallbackLanguage;
  }
  return supportedLanguages.includes(normalized) ? normalized : fallbackLanguage;
}
