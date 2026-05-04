import '@/i18n';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
  configurable: true,
  value: () => undefined,
});

afterEach(() => {
  cleanup();
});
