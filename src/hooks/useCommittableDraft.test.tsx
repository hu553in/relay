import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { useCommittableDraft } from '@/hooks/useCommittableDraft';

function DraftHarness({ value, onCommit }: { value: number; onCommit: (next: number) => void }) {
  const { inputProps } = useCommittableDraft<number>({
    value,
    toDraft: next => String(next),
    fromDraft: text => Number.parseInt(text.trim(), 10),
    commit: onCommit,
  });

  return <input aria-label='Draft value' {...inputProps} />;
}

describe('useCommittableDraft', () => {
  it('does not overwrite an actively edited draft when props change', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const view = render(<DraftHarness value={10} onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('expected draft field to be an input');
    }
    await user.clear(input);
    await user.type(input, '42');
    view.rerender(<DraftHarness value={11} onCommit={onCommit} />);

    expect(input.value).toBe('42');

    await user.tab();
    expect(onCommit).toHaveBeenCalledWith(42);
  });

  it('flushes the latest draft when unmounted while focused', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const view = render(<DraftHarness value={10} onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    await user.clear(input);
    await user.type(input, '64');
    view.unmount();

    expect(onCommit).toHaveBeenCalledWith(64);
  });
});
