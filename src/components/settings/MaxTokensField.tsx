import { useCommittableDraft } from '@/hooks/useCommittableDraft';

const FALLBACK_MAX_TOKENS = 96;

export function MaxTokensField({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (next: number) => void;
}) {
  const { inputProps } = useCommittableDraft<number>({
    value,
    toDraft: number => String(number),
    fromDraft: parseMaxTokens,
    commit: onCommit,
  });

  return (
    <input
      {...inputProps}
      type='number'
      className='w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-[12px] text-white outline-none transition placeholder:text-stone-500 focus:border-stone-300/45'
    />
  );
}

function parseMaxTokens(text: string): number {
  const parsed = Math.floor(Number(text));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_MAX_TOKENS;
}
