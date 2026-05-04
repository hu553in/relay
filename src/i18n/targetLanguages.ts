export const commonTargetLanguages = [
  'en',
  'de',
  'es',
  'fr',
  'it',
  'ja',
  'ko',
  'nl',
  'pl',
  'pt',
  'ru',
  'tr',
  'uk',
  'zh',
] as const;

const fallbackNames: Record<string, string> = {
  de: 'German',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  nl: 'Dutch',
  pl: 'Polish',
  pt: 'Portuguese',
  ru: 'Russian',
  tr: 'Turkish',
  uk: 'Ukrainian',
  zh: 'Chinese',
};

export function targetLanguageName(code: string, uiLanguage: string): string {
  const normalized = code.trim().toLowerCase();
  if (!normalized) {
    return code;
  }
  if (!commonTargetLanguages.includes(normalized as (typeof commonTargetLanguages)[number])) {
    return code;
  }

  try {
    const displayNames = new Intl.DisplayNames([uiLanguage], { type: 'language' });
    const name = displayNames.of(normalized);
    if (name && name.toLowerCase() !== normalized) {
      return name;
    }
  } catch {
    // Some custom user-entered values are not valid BCP 47 language codes.
  }

  return fallbackNames[normalized] ?? code;
}
