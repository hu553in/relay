import 'i18next';

import { defaultNS, enResources } from '@/i18n/resources';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: typeof enResources;
    returnNull: false;
  }
}
