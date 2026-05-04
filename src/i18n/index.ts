import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { defaultNS, fallbackLanguage, resources, supportedLanguages } from '@/i18n/resources';

void i18n.use(initReactI18next).init({
  defaultNS,
  fallbackLng: fallbackLanguage,
  interpolation: {
    escapeValue: false,
  },
  lng: fallbackLanguage,
  ns: Object.keys(resources[fallbackLanguage] ?? {}),
  react: {
    useSuspense: false,
  },
  resources,
  supportedLngs: supportedLanguages,
});

export default i18n;
