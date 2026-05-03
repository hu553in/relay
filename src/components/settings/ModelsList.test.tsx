import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { compareModelRecords, ModelsList } from '@/components/settings/ModelsList';
import type { ModelRecord } from '@/lib/types';

function model(overrides: Partial<ModelRecord>): ModelRecord {
  return {
    kind: 'translation',
    name: 'model.gguf',
    relativePath: 'model.gguf',
    path: '/models/model.gguf',
    sizeBytes: 10,
    state: 'available',
    recommended: false,
    downloadUrl: null,
    ...overrides,
  };
}

describe('ModelsList', () => {
  it('keeps recommended rows first even when the local model is still missing', () => {
    const rows = [
      model({ relativePath: 'local.gguf', path: '/models/local.gguf', state: 'active' }),
      model({
        relativePath: 'recommended.gguf',
        path: '/models/recommended.gguf',
        state: 'missing',
        recommended: true,
      }),
    ].sort(compareModelRecords);

    expect(rows.map(row => row.relativePath)).toEqual(['recommended.gguf', 'local.gguf']);
  });

  it('downloads a missing recommended model through the current model kind', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(
      <ModelsList
        kind='translation'
        models={[
          model({
            relativePath: 'recommended.gguf',
            path: '/models/recommended.gguf',
            state: 'missing',
            recommended: true,
            downloadUrl: 'https://example.com/recommended.gguf',
          }),
        ]}
        onUse={vi.fn()}
        onDownload={onDownload}
        downloading={false}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Download model' }));

    expect(onDownload).toHaveBeenCalledWith('translation');
  });
});
