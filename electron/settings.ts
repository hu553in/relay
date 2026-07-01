import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { app, safeStorage } from 'electron';

import {
  createDefaultSettings,
  OVERLAY_OPACITY_MAX,
  OVERLAY_OPACITY_MIN,
  OVERLAY_OPACITY_STEP,
  OVERLAY_ROWS_MAX,
  OVERLAY_ROWS_MIN,
} from '@/shared/defaults';
import { isSupportedLanguage, isSupportedTranslationLanguage } from '@/shared/languages';
import { logError, logWarn } from '@/shared/log';
import type { RelaySettings } from '@/shared/types';

const SETTINGS_VERSION = 1;
const defaultSettings: RelaySettings = createDefaultSettings();

interface SettingsFile {
  version: number;
  settings: RelaySettings;
  encryptedApiKey?: string;
  plainApiKey?: string;
}

function cloneSettingsFile(file: SettingsFile): SettingsFile {
  return {
    version: file.version,
    settings: { ...file.settings },
    ...(file.encryptedApiKey === undefined ? {} : { encryptedApiKey: file.encryptedApiKey }),
    ...(file.plainApiKey === undefined ? {} : { plainApiKey: file.plainApiKey }),
  };
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

function invalidSettingsBackupPath(path: string): string {
  return `${path}.invalid-${Date.now().toString()}`;
}

function normalizeSettings(value: Partial<RelaySettings> | undefined): RelaySettings {
  return {
    microphone: normalizeBoolean(value?.microphone, defaultSettings.microphone),
    systemAudio: normalizeBoolean(value?.systemAudio, defaultSettings.systemAudio),
    originalLanguage: normalizeLanguage(
      value?.originalLanguage,
      defaultSettings.originalLanguage,
      isSupportedLanguage
    ),
    translationLanguage: normalizeLanguage(
      value?.translationLanguage,
      defaultSettings.translationLanguage,
      isSupportedTranslationLanguage
    ),
    overlayRows: clampInt(
      value?.overlayRows ?? defaultSettings.overlayRows,
      OVERLAY_ROWS_MIN,
      OVERLAY_ROWS_MAX
    ),
    overlayOpacity: normalizeOverlayOpacity(
      value?.overlayOpacity ?? defaultSettings.overlayOpacity
    ),
  };
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalizeLanguage(
  value: unknown,
  fallback: string,
  isSupported: (code: string) => boolean
): string {
  if (typeof value === 'string' && isSupported(value)) {
    return value;
  }
  return fallback;
}

function clampInt(value: number, min: number, max: number): number {
  const safeValue = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, Math.round(safeValue)));
}

function clampNumber(value: number, min: number, max: number): number {
  const safeValue = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, safeValue));
}

function normalizeOverlayOpacity(value: number): number {
  const stepped = Math.round(
    clampNumber(value, OVERLAY_OPACITY_MIN, OVERLAY_OPACITY_MAX) / OVERLAY_OPACITY_STEP
  );
  return Number((stepped * OVERLAY_OPACITY_STEP).toFixed(2));
}

function isFileNotFound(reason: unknown): boolean {
  return reason instanceof Error && 'code' in reason && reason.code === 'ENOENT';
}

export class SettingsStore {
  private apiKeyDecryptFailureLogged = false;

  private writeQueue: Promise<void> = Promise.resolve();

  private file: SettingsFile = {
    version: SETTINGS_VERSION,
    settings: createDefaultSettings(),
  };

  async load(): Promise<void> {
    try {
      const content = await readFile(settingsPath(), 'utf8');
      const parsed = JSON.parse(content) as Partial<SettingsFile>;
      const encryptedApiKey = normalizeOptionalString(parsed.encryptedApiKey);
      const plainApiKey = normalizeOptionalString(parsed.plainApiKey);
      this.file = {
        version: SETTINGS_VERSION,
        settings: normalizeSettings(parsed.settings),
        ...(encryptedApiKey === undefined ? {} : { encryptedApiKey }),
        ...(plainApiKey === undefined ? {} : { plainApiKey }),
      };
      await this.migrateApiKeyStorage().catch((reason: unknown) => {
        logWarn('Failed to migrate API key storage.', reason);
      });
    } catch (reason) {
      this.file = {
        version: SETTINGS_VERSION,
        settings: createDefaultSettings(),
      };
      if (isFileNotFound(reason)) {
        await this.save();
        return;
      }

      logWarn('Failed to load settings; resetting to defaults.', reason);
      const path = settingsPath();
      await rename(path, invalidSettingsBackupPath(path)).catch((renameReason: unknown) => {
        logWarn('Failed to back up invalid settings file.', renameReason);
      });
      await this.save().catch((saveReason: unknown) => {
        logError('Failed to write default settings after load failure.', saveReason);
      });
    }
  }

  get settings(): RelaySettings {
    return this.file.settings;
  }

  async updateSettings(next: Partial<RelaySettings>): Promise<RelaySettings> {
    return this.updateFile(() => {
      this.file.settings = normalizeSettings({ ...this.file.settings, ...next });
      return this.file.settings;
    });
  }

  hasApiKey(): boolean {
    return this.getApiKey().trim().length > 0;
  }

  getApiKey(): string {
    if (this.file.encryptedApiKey) {
      try {
        return safeStorage.decryptString(Buffer.from(this.file.encryptedApiKey, 'base64'));
      } catch (reason) {
        if (!this.apiKeyDecryptFailureLogged) {
          this.apiKeyDecryptFailureLogged = true;
          logWarn('Failed to decrypt stored API key.', reason);
        }
        // Fall back to a legacy plain key below if one exists.
      }
    }
    return this.file.plainApiKey ?? '';
  }

  async saveApiKey(apiKey: string): Promise<void> {
    await this.updateFile(() => {
      const trimmed = apiKey.trim();
      if (!trimmed) {
        delete this.file.encryptedApiKey;
        delete this.file.plainApiKey;
        this.apiKeyDecryptFailureLogged = false;
        return;
      }

      if (safeStorage.isEncryptionAvailable()) {
        this.file.encryptedApiKey = safeStorage.encryptString(trimmed).toString('base64');
        delete this.file.plainApiKey;
      } else {
        this.file.plainApiKey = trimmed;
        delete this.file.encryptedApiKey;
      }
      this.apiKeyDecryptFailureLogged = false;
    });
  }

  async clearApiKey(): Promise<void> {
    await this.updateFile(() => {
      delete this.file.encryptedApiKey;
      delete this.file.plainApiKey;
      this.apiKeyDecryptFailureLogged = false;
    });
  }

  private async writeFile(): Promise<void> {
    const path = settingsPath();
    const tempPath = `${path}.tmp`;
    const content = `${JSON.stringify(this.file, null, 2)}\n`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, path);
  }

  private async save(): Promise<void> {
    // The awaiting caller logs write failures; these catches only keep the queue usable.
    const nextWrite = this.writeQueue.catch(() => undefined).then(() => this.writeFile());
    this.writeQueue = nextWrite.catch(() => undefined);
    await nextWrite;
  }

  private async updateFile<Result>(mutate: () => Result): Promise<Result> {
    const write = async () => {
      const previousFile = cloneSettingsFile(this.file);
      const previousApiKeyDecryptFailureLogged = this.apiKeyDecryptFailureLogged;
      try {
        const result = mutate();
        await this.writeFile();
        return result;
      } catch (reason) {
        this.file = previousFile;
        this.apiKeyDecryptFailureLogged = previousApiKeyDecryptFailureLogged;
        throw reason;
      }
    };

    // The awaiting caller logs write failures; these catches only keep the queue usable.
    const nextWrite = this.writeQueue.catch(() => undefined).then(write);
    this.writeQueue = nextWrite.then(
      () => undefined,
      () => undefined
    );
    return nextWrite;
  }

  private async migrateApiKeyStorage(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable() || !this.file.plainApiKey) {
      return;
    }

    await this.saveApiKey(this.getApiKey());
  }
}
