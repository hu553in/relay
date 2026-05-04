import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useToastCenter } from '@/hooks/useToastCenter';
import type { DiagnosticsEntry, UserMessage } from '@/lib/types';

interface HookProps {
  diagnostics: DiagnosticsEntry[] | null | undefined;
}

function diagnostic(id: string, message: UserMessage): DiagnosticsEntry {
  return {
    id,
    timestampMs: Date.now(),
    level: 'warning',
    message,
  };
}

describe('useToastCenter', () => {
  it('baselines the first loaded diagnostics snapshot without replaying old entries', () => {
    const oldEntry = diagnostic('old', { code: 'diagnostics:listeningStopped' });
    const initialProps: HookProps = { diagnostics: undefined };
    const { result, rerender } = renderHook(
      ({ diagnostics }: HookProps) => useToastCenter(diagnostics),
      { initialProps }
    );

    rerender({ diagnostics: [oldEntry] });

    expect(result.current.toasts).toEqual([]);
  });

  it('toasts the first new diagnostic after an empty loaded snapshot', async () => {
    const newEntry = diagnostic('new', {
      code: 'diagnostics:globalShortcutFailed',
      params: { error: 'First live warning' },
    });
    const initialProps: HookProps = { diagnostics: [] };
    const { result, rerender } = renderHook(
      ({ diagnostics }: HookProps) => useToastCenter(diagnostics),
      { initialProps }
    );

    rerender({ diagnostics: [newEntry] });

    await waitFor(() => {
      expect(result.current.toasts).toHaveLength(1);
    });
    expect(result.current.toasts[0]?.message).toBe('Global shortcut failed: First live warning');
  });
});
