import enLocale, { resources as englishResources } from '@/i18n/locales/en';

export const fallbackLanguage = 'en';
export const defaultNS = 'common';
export const enResources = englishResources;

export interface UiLanguageMetadata {
  code: string;
  label: string;
  nativeLabel: string;
}

export interface LocaleModule extends UiLanguageMetadata {
  resources: Partial<typeof enResources>;
}

const localeModules = import.meta.glob<{ default: LocaleModule }>('./locales/*/index.ts', {
  eager: true,
});

const loadedLocales = Object.values(localeModules).map(module => module.default);
const localeList = loadedLocales.some(locale => locale.code === enLocale.code)
  ? loadedLocales
  : [enLocale, ...loadedLocales];

export const resources = Object.fromEntries(
  localeList.map(locale => [locale.code, locale.resources])
) as Record<string, Partial<typeof enResources>>;

export const uiLanguages = [...localeList]
  .map(({ code, label, nativeLabel }) => ({ code, label, nativeLabel }))
  .sort((left, right) => left.label.localeCompare(right.label));

export const supportedLanguages = uiLanguages.map(language => language.code);
