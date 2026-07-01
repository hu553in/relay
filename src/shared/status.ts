import type { AppStatus } from './types';

export function isRelayActive(status: AppStatus): boolean {
  return status === 'connecting' || status === 'listening';
}
