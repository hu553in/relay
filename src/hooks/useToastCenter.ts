import { useCallback, useEffect, useRef, useState } from 'react';

import { diagnosticLevelTone } from '@/lib/diagnostics';
import type { DiagnosticsEntry } from '@/lib/types';

export interface ToastItem {
  id: string;
  title: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

const MAX_VISIBLE = 4;
const DIAGNOSTIC_TOAST_MS = 4200;
const MANUAL_TOAST_MS = 3200;

export function useToastCenter(diagnostics: DiagnosticsEntry[] | null | undefined) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seenRef = useRef<Set<string> | null>(null);
  const timersRef = useRef<Map<string, number>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const scheduleDismiss = useCallback(
    (id: string, delay: number) => {
      const handle = window.setTimeout(() => {
        timersRef.current.delete(id);
        setToasts(current => current.filter(item => item.id !== id));
      }, delay);
      timersRef.current.set(id, handle);
    },
    [setToasts]
  );

  const enqueue = useCallback(
    (toast: ToastItem, delay: number) => {
      setToasts(current => {
        const next = [...current, toast];
        if (next.length <= MAX_VISIBLE) {
          return next;
        }
        const overflow = next.length - MAX_VISIBLE;
        for (let index = 0; index < overflow; index += 1) {
          const dropped = next[index];
          if (dropped) {
            clearTimer(dropped.id);
          }
        }
        return next.slice(overflow);
      });
      scheduleDismiss(toast.id, delay);
    },
    [clearTimer, scheduleDismiss]
  );

  useEffect(() => {
    // Baseline with the first real snapshot of diagnostics. Callers pass
    // `null`/`undefined` until the backend snapshot is loaded, so an empty
    // first snapshot is still a real baseline and the next diagnostic is
    // correctly treated as new.
    if (!diagnostics) {
      return;
    }
    if (seenRef.current === null) {
      seenRef.current = new Set(diagnostics.map(entry => entry.id));
      return;
    }

    const seen = seenRef.current;
    const fresh: DiagnosticsEntry[] = [];
    for (const entry of diagnostics) {
      if (!seen.has(entry.id)) {
        fresh.push(entry);
      }
    }

    // Re-sync to prune IDs no longer in snapshot, preventing unbounded growth.
    seenRef.current = new Set(diagnostics.map(entry => entry.id));

    if (fresh.length === 0) {
      return;
    }

    fresh.reverse();
    for (const entry of fresh) {
      enqueue(
        {
          id: entry.id,
          title: 'Relay',
          message: entry.message,
          tone: diagnosticLevelTone(entry.level),
        },
        DIAGNOSTIC_TOAST_MS
      );
    }
  }, [diagnostics, enqueue]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(handle => {
        window.clearTimeout(handle);
      });
      timers.clear();
    };
  }, []);

  const pushToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = `toast-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
      enqueue({ ...toast, id }, MANUAL_TOAST_MS);
    },
    [enqueue]
  );

  const dismissToast = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts(current => current.filter(item => item.id !== id));
    },
    [clearTimer]
  );

  return { toasts, pushToast, dismissToast };
}
