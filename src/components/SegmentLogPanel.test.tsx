import { render, screen } from '@testing-library/react';
import { FileText } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { SegmentLogPanel } from '@/components/SegmentLogPanel';

describe('SegmentLogPanel', () => {
  it('disables copy action when the concrete log is empty', () => {
    render(<SegmentLogPanel title='Diagnostics' icon={<FileText />} entries={[]} />);

    const copy = screen.getByRole('button', { name: 'Copy log' });
    expect(copy).toBeInstanceOf(HTMLButtonElement);
    expect((copy as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables copy action when the concrete log has text', () => {
    render(
      <SegmentLogPanel
        title='Diagnostics'
        icon={<FileText />}
        entries={[{ id: '1', timestampMs: 1, text: 'Ready' }]}
      />
    );

    const copy = screen.getByRole('button', { name: 'Copy log' });
    expect(copy).toBeInstanceOf(HTMLButtonElement);
    expect((copy as HTMLButtonElement).disabled).toBe(false);
  });
});
