import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ShortcutInputField } from '@/components/settings/ShortcutInputField';

describe('ShortcutInputField', () => {
  it('commits trimmed shortcut text on blur', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <ShortcutInputField
        label='Toggle listening shortcut'
        value='CmdOrCtrl+Shift+L'
        onCommit={onCommit}
      />
    );

    const input = screen.getByLabelText('Toggle listening shortcut');
    await user.clear(input);
    await user.type(input, '  CmdOrCtrl+Shift+J  ');
    await user.tab();

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('CmdOrCtrl+Shift+J');
  });

  it('commits when Enter causes the input to blur', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <ShortcutInputField
        label='Show overlay shortcut'
        value='CmdOrCtrl+Shift+O'
        onCommit={onCommit}
      />
    );

    const input = screen.getByLabelText('Show overlay shortcut');
    await user.clear(input);
    await user.type(input, 'CmdOrCtrl+Shift+K{Enter}');

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('CmdOrCtrl+Shift+K');
  });
});
