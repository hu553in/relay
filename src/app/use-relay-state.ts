import { useCallback, useEffect, useState } from 'react';

import { startAudioCapture } from '@/audio';
import { createEmptyRelayState } from '@/shared/defaults';
import { logError, logWarn } from '@/shared/log';
import type { RelayState, StartCaptureRequest } from '@/shared/types';

type StopCapture = () => void;

export function useRelayState() {
  const [state, setState] = useState<RelayState>(createEmptyRelayState);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const clearCaptureError = useCallback(() => {
    setCaptureError(null);
  }, []);

  useEffect(() => {
    let mounted = true;
    let stopCapture: StopCapture | null = null;
    let captureGeneration = 0;
    let unsubscribeState: (() => void) | null = null;
    let unsubscribeStart: (() => void) | null = null;
    let unsubscribeStop: (() => void) | null = null;

    const load = async () => {
      try {
        const next = await window.relay.getState();
        if (mounted) {
          setState(next);
        }
      } catch (reason) {
        logError('Failed to load relay state.', reason);
      }
    };

    const safeUnsubscribe = (unsubscribe: (() => void) | null, label: string) => {
      if (!unsubscribe) {
        return;
      }
      try {
        unsubscribe();
      } catch (reason) {
        logWarn(`Failed to unsubscribe from ${label}.`, reason);
      }
    };

    const stopCurrentCapture = () => {
      captureGeneration += 1;
      try {
        stopCapture?.();
      } catch (reason) {
        logWarn('Failed to stop current audio capture.', reason);
      }
      stopCapture = null;
    };
    const startCapture = async (request: StartCaptureRequest) => {
      stopCurrentCapture();
      const generation = captureGeneration;
      setCaptureError(null);
      try {
        const nextStopCapture = await startAudioCapture(request);
        if (!mounted || generation !== captureGeneration) {
          try {
            nextStopCapture();
          } catch (reason) {
            logWarn('Failed to stop stale audio capture.', reason);
          }
          return;
        }
        stopCapture = nextStopCapture;
      } catch (reason) {
        if (!mounted || generation !== captureGeneration) {
          return;
        }
        const message = reason instanceof Error ? reason.message : String(reason);
        logError('Audio capture failed.', reason);
        setCaptureError(message);
        await window.relay.stop().catch((stopReason: unknown) => {
          logError('Failed to stop Relay after audio capture failure.', stopReason);
        });
      }
    };

    try {
      unsubscribeState = window.relay.onState(next => {
        setState(next);
        if (
          next.status === 'connecting' ||
          next.status === 'listening' ||
          next.status === 'error'
        ) {
          setCaptureError(null);
        }
      });
      unsubscribeStart = window.relay.onStartCapture((request: StartCaptureRequest) => {
        void startCapture(request);
      });
      unsubscribeStop = window.relay.onStopCapture(() => {
        stopCurrentCapture();
      });

      void load();
    } catch (reason) {
      logError('Failed to initialize relay state subscriptions.', reason);
    }

    return () => {
      mounted = false;
      safeUnsubscribe(unsubscribeState, 'state updates');
      safeUnsubscribe(unsubscribeStart, 'start capture events');
      safeUnsubscribe(unsubscribeStop, 'stop capture events');
      stopCurrentCapture();
    };
  }, []);

  return { captureError, clearCaptureError, setState, state };
}
