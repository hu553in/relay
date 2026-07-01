import type { RelaySettings, RelayState } from './types';

export const OVERLAY_ROWS_MIN = 2;
export const OVERLAY_ROWS_MAX = 12;
export const OVERLAY_OPACITY_MIN = 0.1;
export const OVERLAY_OPACITY_MAX = 1;
export const OVERLAY_OPACITY_PERCENT_STEP = 10;
export const OVERLAY_OPACITY_PERCENT_STEPS = Array.from(
  { length: 10 },
  (_, index) => (index + 1) * OVERLAY_OPACITY_PERCENT_STEP
);
export const OVERLAY_OPACITY_STEP = OVERLAY_OPACITY_PERCENT_STEP / 100;

export function createDefaultSettings(): RelaySettings {
  return {
    microphone: true,
    systemAudio: true,
    originalLanguage: 'en',
    translationLanguage: 'ru',
    overlayRows: 4,
    overlayOpacity: 0.8,
  };
}

export function createEmptyRelayState(): RelayState {
  return {
    status: 'idle',
    settings: createDefaultSettings(),
    apiKey: { hasApiKey: false },
    overlayVisible: false,
    captions: [],
    error: null,
  };
}
