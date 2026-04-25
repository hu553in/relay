import { createContext, type PropsWithChildren, useContext, useEffect, useState } from 'react';

import { WindowShell } from '@/components/shared/WindowChrome';
import { toErrorMessage } from '@/lib/errors';
import { getAppConstants } from '@/lib/relay';
import type { AppConstants } from '@/lib/types';

// Constants are immutable for the life of the process: they ship from the
// Rust binary, never change at runtime, and are tiny (a handful of fields).
// Fetching once at boot and storing in a Context means every consumer gets
// a non-nullable value with no per-render `await` and no prop drilling.
const AppConstantsContext = createContext<AppConstants | null>(null);

export function AppConstantsProvider({ children }: PropsWithChildren) {
  const [constants, setConstants] = useState<AppConstants | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const state = { cancelled: false };
    void (async () => {
      try {
        const next = await getAppConstants();
        if (!state.cancelled) {
          setConstants(next);
        }
      } catch (reason) {
        if (!state.cancelled) {
          setError(toErrorMessage(reason));
        }
      }
    })();
    return () => {
      state.cancelled = true;
    };
  }, []);

  if (error) {
    // Render the same chrome as the snapshot loading screen so the boot
    // experience stays consistent. A failure here is unrecoverable from
    // the webview side — it means the Tauri command pipe is broken.
    return <WindowShell message={`Failed to load app constants: ${error}`} />;
  }

  if (!constants) {
    return <WindowShell message='Loading Relay constants...' />;
  }

  return <AppConstantsContext.Provider value={constants}>{children}</AppConstantsContext.Provider>;
}

/// Returns the immutable bundle of backend-defined constants.
///
/// Throws if called outside of `<AppConstantsProvider>`. The provider gates
/// rendering of its children until constants are loaded, so by the time any
/// component reads this value it is guaranteed non-null — no fallback paths
/// or default literals are needed at consumption sites.
export function useAppConstants(): AppConstants {
  const value = useContext(AppConstantsContext);
  if (!value) {
    throw new Error('useAppConstants must be used inside <AppConstantsProvider>');
  }
  return value;
}
