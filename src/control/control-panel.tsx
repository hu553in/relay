import { useState } from 'react';

import { WindowFrame } from '@/app/window-frame';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field';
import { logError } from '@/shared/log';
import { isRelayActive } from '@/shared/status';
import type { RelaySettings, RelayState } from '@/shared/types';

import { ApiKeyField } from './api-key-field';
import { ControlBar } from './control-bar';
import { LanguageFields } from './language-fields';
import { OverlaySettings } from './overlay-settings';
import { SourceField } from './source-field';

interface ControlPanelProps {
  captureError: string | null;
  state: RelayState;
  onClearCaptureError: () => void;
  onStateChange: (state: RelayState) => void;
}

export function ControlPanel({
  captureError,
  state,
  onClearCaptureError,
  onStateChange,
}: ControlPanelProps) {
  const [apiKey, setApiKey] = useState('');
  const [controlError, setControlError] = useState<string | null>(null);
  const isActive = isRelayActive(state.status);
  const isConnecting = state.status === 'connecting';
  const settingsDisabled = isActive;
  const apiKeyDisabled = isActive;
  const hasAudioSource = state.settings.microphone || state.settings.systemAudio;
  const externalError = captureError ?? state.error;
  const error = externalError ?? controlError;

  function reportControlError(message: string, reason: unknown) {
    logError(message, reason);
    setControlError(message);
  }

  async function updateSettings(settings: Partial<RelaySettings>) {
    if (settingsDisabled) {
      return;
    }
    try {
      const next = await window.relay.saveSettings(settings);
      if (settings.microphone !== undefined || settings.systemAudio !== undefined) {
        onClearCaptureError();
      }
      setControlError(null);
      onStateChange(next);
    } catch (reason) {
      reportControlError('Failed to save settings.', reason);
    }
  }

  async function toggleRelay(nextActive: boolean) {
    if (isConnecting || (nextActive && (!state.apiKey.hasApiKey || !hasAudioSource))) {
      return;
    }
    try {
      const next = nextActive ? await window.relay.start() : await window.relay.stop();
      setControlError(null);
      onStateChange(next);
    } catch (reason) {
      reportControlError(nextActive ? 'Failed to start Relay.' : 'Failed to stop Relay.', reason);
    }
  }

  async function saveKey() {
    if (apiKeyDisabled || !apiKey.trim()) {
      return;
    }
    try {
      const next = await window.relay.saveApiKey(apiKey);
      setApiKey('');
      setControlError(null);
      onStateChange(next);
    } catch (reason) {
      reportControlError('Failed to save API key.', reason);
    }
  }

  async function clearKey() {
    if (apiKeyDisabled) {
      return;
    }
    try {
      const next = await window.relay.clearApiKey();
      setApiKey('');
      setControlError(null);
      onStateChange(next);
    } catch (reason) {
      reportControlError('Failed to clear API key.', reason);
    }
  }

  async function openRepository() {
    try {
      await window.relay.openRepository();
      setControlError(null);
    } catch (reason) {
      reportControlError('Failed to open repository.', reason);
    }
  }

  async function quitRelay() {
    try {
      await window.relay.quit();
      setControlError(null);
    } catch (reason) {
      reportControlError('Failed to quit Relay.', reason);
    }
  }

  async function saveTranscripts() {
    try {
      await window.relay.saveTranscripts();
      setControlError(null);
    } catch (reason) {
      reportControlError('Failed to save transcripts.', reason);
    }
  }

  async function toggleOverlay() {
    try {
      await (state.overlayVisible ? window.relay.hideOverlay() : window.relay.showOverlay());
      setControlError(null);
    } catch (reason) {
      reportControlError('Failed to toggle overlay.', reason);
    }
  }

  return (
    <WindowFrame className='w-screen p-2'>
      <Card className='w-full [-webkit-app-region:no-drag]'>
        <CardHeader className='block'>
          <ControlBar
            state={state}
            onOpenRepository={() => void openRepository()}
            onQuit={() => void quitRelay()}
            onSaveTranscripts={() => void saveTranscripts()}
            onToggleOverlay={() => void toggleOverlay()}
            onToggleRelay={checked => void toggleRelay(checked)}
          />
        </CardHeader>

        <CardContent className='flex flex-col gap-4'>
          <FieldGroup className='gap-4'>
            <FieldGroup className='grid gap-4 min-[720px]:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]'>
              <FieldSet>
                <FieldLegend className='sr-only'>Sources</FieldLegend>
                <SourceField
                  microphone={state.settings.microphone}
                  systemAudio={state.settings.systemAudio}
                  disabled={settingsDisabled}
                  onChange={sources => void updateSettings(sources)}
                />
              </FieldSet>

              <LanguageFields
                disabled={settingsDisabled}
                originalLanguage={state.settings.originalLanguage}
                translationLanguage={state.settings.translationLanguage}
                onOriginalLanguageChange={originalLanguage =>
                  void updateSettings({ originalLanguage })
                }
                onTranslationLanguageChange={translationLanguage =>
                  void updateSettings({ translationLanguage })
                }
              />
            </FieldGroup>

            <ApiKeyField
              apiKey={apiKey}
              disabled={apiKeyDisabled}
              hasApiKey={state.apiKey.hasApiKey}
              onApiKeyChange={value => {
                setApiKey(value);
                setControlError(null);
              }}
              onClearKey={() => void clearKey()}
              onSaveKey={() => void saveKey()}
            />
            <OverlaySettings
              disabled={settingsDisabled}
              overlayOpacity={state.settings.overlayOpacity}
              overlayRows={state.settings.overlayRows}
              onUpdateSettings={updateSettings}
            />
          </FieldGroup>

          {error ? (
            <Alert className='mt-auto'>
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </WindowFrame>
  );
}
