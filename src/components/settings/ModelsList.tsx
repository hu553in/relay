import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/shared/Badge';
import { formatModelSize } from '@/lib/format';
import type { ModelKind, ModelRecord, ModelState } from '@/lib/types';

const MODEL_STATE_ORDER: Record<ModelState, number> = {
  active: 0,
  available: 1,
  missing: 2,
};

export function compareModelRecords(left: ModelRecord, right: ModelRecord) {
  if (left.recommended !== right.recommended) {
    return left.recommended ? -1 : 1;
  }
  const stateDelta = MODEL_STATE_ORDER[left.state] - MODEL_STATE_ORDER[right.state];
  if (stateDelta !== 0) return stateDelta;
  return left.relativePath.localeCompare(right.relativePath);
}

export function ModelsList({
  kind,
  models,
  onUse,
  onDownload,
  downloading,
}: {
  kind: ModelKind;
  models: ModelRecord[];
  onUse: (kind: ModelKind, model: ModelRecord) => Promise<void>;
  onDownload: (kind: ModelKind) => Promise<void>;
  downloading: boolean;
}) {
  const { t } = useTranslation(['models']);
  if (models.length === 0) {
    return <EmptyState text={t('models:empty')} />;
  }

  return (
    <div className='grid gap-2'>
      {models.map(model => (
        <article
          key={`${kind}-${model.path}`}
          className='rounded-xl border border-white/8 bg-white/2 px-3 py-2.5 transition hover:border-white/12 hover:bg-white/7'
        >
          <div className='flex items-start justify-between gap-3'>
            <div className='min-w-0'>
              <p className='truncate text-[12.5px] font-medium text-white'>
                {model.relativePath || model.name}
              </p>
              <p className='mt-1 break-all text-[11.5px] text-stone-400'>{model.path}</p>
            </div>
            <div className='flex shrink-0 items-center gap-1.5'>
              {model.recommended ? (
                <Badge tone='warning' className='text-[10px]'>
                  {t('models:recommended')}
                </Badge>
              ) : null}
              <ModelStateBadge state={model.state} />
            </div>
          </div>
          <div className='mt-2 flex items-center justify-between gap-3'>
            <span className='text-[10.5px] text-stone-500'>
              {formatModelSize(model.sizeBytes, t('models:unknownSize'))}
            </span>
            {model.state !== 'active' && model.recommended && model.state === 'missing' ? (
              <button
                type='button'
                onClick={() => void onDownload(kind)}
                disabled={downloading}
                className='inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/4 px-3 py-1.5 text-[12px] font-medium text-stone-100 transition hover:border-white/14 hover:bg-white/10 disabled:opacity-45'
              >
                <Download size={13} />
                {downloading ? t('models:downloading') : t('models:download')}
              </button>
            ) : model.state !== 'active' ? (
              <button
                type='button'
                onClick={() => void onUse(kind, model)}
                disabled={model.state === 'missing'}
                className='rounded-lg border border-white/10 bg-white/4 px-3 py-1.5 text-[12px] font-medium text-stone-100 transition hover:border-white/14 hover:bg-white/10 disabled:opacity-40'
              >
                {t('models:use')}
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function ModelStateBadge({ state }: { state: ModelRecord['state'] }) {
  const { t } = useTranslation('models');
  const labels: Record<ModelState, string> = {
    active: t('active'),
    available: t('available'),
    missing: t('missing'),
  };
  const tone = state === 'active' ? 'success' : state === 'missing' ? 'danger' : 'neutral';
  return (
    <Badge tone={tone} className='text-[10px]'>
      {labels[state]}
    </Badge>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className='rounded-xl border border-transparent bg-transparent px-4 py-6 text-center text-[12px] leading-5 text-stone-500'>
      {text}
    </div>
  );
}
