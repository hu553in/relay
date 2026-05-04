import type { Namespace, TFunction } from 'i18next';

import type { UserMessage } from '@/lib/types';

type DynamicTranslate = (key: string, options?: Record<string, unknown>) => string;

export function formatUserMessage(
  message: UserMessage | string | null | undefined,
  t: DynamicTranslate
): string | null;
export function formatUserMessage<Ns extends Namespace>(
  message: UserMessage | string | null | undefined,
  t: TFunction<Ns>
): string | null;
export function formatUserMessage(
  message: UserMessage | string | null | undefined,
  t: DynamicTranslate | TFunction
): string | null {
  if (!message) {
    return null;
  }
  if (typeof message === 'string') {
    return message;
  }

  const params = message.params ?? {};
  const translate = t as unknown as DynamicTranslate;
  // i18next returns defaultValue (here, the code itself) only when the
  // translation key does not exist in any loaded resource. A match means
  // we have no translation for this backend code.
  const formatted = translate(message.code, { ...params, defaultValue: message.code });
  if (formatted === message.code) {
    return translate('diagnostics:unknownBackendMessage', {
      code: message.code,
      defaultValue: `Unknown backend message: ${message.code}`,
    });
  }
  return formatted;
}
