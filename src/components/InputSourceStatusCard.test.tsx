import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InputSourceStatusCard } from '@/components/InputSourceStatusCard';
import type { SourceState } from '@/lib/types';

function source(overrides: Partial<SourceState>): SourceState {
  return {
    enabled: true,
    available: true,
    capturing: false,
    health: 'ready',
    inputLevel: 0,
    detail: null,
    ...overrides,
  };
}

describe('InputSourceStatusCard', () => {
  it('allows disabling an enabled source even when that source is unavailable', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <InputSourceStatusCard
        title='System audio'
        source={source({
          available: false,
          health: 'unavailable',
          detail: { code: 'source:systemAudioNeedsLoopback' },
        })}
        onToggle={onToggle}
      />
    );

    const toggle = screen.getByRole('switch');
    if (!(toggle instanceof HTMLButtonElement)) {
      throw new Error('expected switch to be a button');
    }
    expect(toggle.disabled).toBe(false);

    await user.click(toggle);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('does not allow enabling a disabled source that is unavailable', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <InputSourceStatusCard
        title='System audio'
        source={source({
          enabled: false,
          available: false,
          health: 'unavailable',
        })}
        onToggle={onToggle}
      />
    );

    const toggle = screen.getByRole('switch');
    if (!(toggle instanceof HTMLButtonElement)) {
      throw new Error('expected switch to be a button');
    }
    expect(toggle.disabled).toBe(true);

    await user.click(toggle);

    expect(onToggle).not.toHaveBeenCalled();
  });

  it('hides level meter while the source is enabled but not capturing', () => {
    render(
      <InputSourceStatusCard
        title='Microphone'
        source={source({ capturing: false, inputLevel: 80 })}
        onToggle={vi.fn()}
      />
    );

    expect(screen.queryByText('Input level')).toBeNull();
  });

  it('shows level meter while the source is actively capturing', () => {
    render(
      <InputSourceStatusCard
        title='Microphone'
        source={source({ capturing: true, inputLevel: 80 })}
        onToggle={vi.fn()}
      />
    );

    expect(screen.getByText('Input level')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
  });
});
