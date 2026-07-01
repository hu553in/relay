import type { RelayBridge } from './shared/types';

declare global {
  interface Window {
    relay: RelayBridge;
  }
}

export {};
