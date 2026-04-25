import { invoke } from '@tauri-apps/api/core';

import type { AppConstants, AppPaths, AppSnapshot, RelaySettings, SystemMetrics } from './types';

export function getSnapshot() {
  return invoke<AppSnapshot>('get_snapshot');
}

export function updateSettings(settings: RelaySettings) {
  return invoke<AppSnapshot>('update_settings', { settings });
}

export function startListening() {
  return invoke('start_listening');
}

export function stopListening() {
  return invoke('stop_listening');
}

export function showOverlay() {
  return invoke('show_overlay');
}

export function hideOverlay() {
  return invoke('hide_overlay');
}

export function showControls() {
  return invoke('show_controls');
}

export function showSettings() {
  return invoke('show_settings');
}

export function hideSettings() {
  return invoke('hide_settings');
}

export function showSettingsSection(section: string) {
  return invoke('show_settings_section', { section });
}

export function clearSegments() {
  return invoke('clear_transcript_log');
}

export function clearTranslationLog() {
  return invoke('clear_translation_log');
}

export function clearDiagnostics() {
  return invoke('clear_diagnostics');
}

export function getConfigPreview() {
  return invoke<string>('get_config_preview');
}

export function getAppPaths() {
  return invoke<AppPaths>('get_app_paths');
}

export function getSystemMetrics() {
  return invoke<SystemMetrics>('get_system_metrics');
}

export function getAppConstants() {
  return invoke<AppConstants>('get_app_constants');
}
