import { listen } from '@tauri-apps/api/event';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { useAppConstants } from '@/hooks/useAppConstants';
import { toErrorMessage } from '@/lib/errors';
import { getSnapshot } from '@/lib/relay';
import type { AppSnapshot, RelaySnapshotState } from '@/lib/types';

export function useRelaySnapshot(): RelaySnapshotState {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bootstrappedRef = useRef(false);
  const constants = useAppConstants();

  const load = useEffectEvent(async () => {
    try {
      setError(null);
      const next = await getSnapshot();
      setSnapshot(current => current ?? next);
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setIsLoading(false);
    }
  });

  useEffect(() => {
    const state = { mounted: true };
    let unlisten: (() => void) | undefined;

    void (async () => {
      const cleanup = await listen<AppSnapshot>(constants.snapshotEvent, event => {
        if (!state.mounted) {
          return;
        }
        setSnapshot(event.payload);
        setIsLoading(false);
      });
      if (!state.mounted) {
        cleanup();
        return;
      }
      unlisten = cleanup;
      if (bootstrappedRef.current) {
        return;
      }
      bootstrappedRef.current = true;
      await load();
    })();

    return () => {
      state.mounted = false;
      unlisten?.();
    };
  }, [load, constants.snapshotEvent]);

  return {
    snapshot,
    isLoading,
    error,
    refresh: load,
  };
}
