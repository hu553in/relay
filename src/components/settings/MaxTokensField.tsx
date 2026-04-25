import { useAppConstants } from '@/hooks/useAppConstants';
import { useCommittableDraft } from '@/hooks/useCommittableDraft';

export function MaxTokensField({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (next: number) => void;
}) {
  // All bounds come from the backend constants snapshot — fallback default,
  // hard min, hard max. Keeping them here means the UI and `settings.toml`
  // and the generation cap can never disagree: one value lives in
  // `src-tauri/src/constants.rs`, everything else reads from there.
  const constants = useAppConstants();
  const { inputProps } = useCommittableDraft<number>({
    value,
    toDraft: number => String(number),
    fromDraft: text =>
      parseMaxTokens(text, {
        fallback: constants.defaultMaxTokens,
        min: constants.minGenerationTokens,
        max: constants.maxGenerationTokens,
      }),
    commit: onCommit,
  });

  return (
    <input
      {...inputProps}
      type='number'
      min={constants.minGenerationTokens}
      max={constants.maxGenerationTokens}
      step={1}
      className='w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-[12px] text-white outline-none transition placeholder:text-stone-500 focus:border-stone-300/45'
    />
  );
}

function parseMaxTokens(
  text: string,
  bounds: { fallback: number; min: number; max: number }
): number {
  const parsed = Math.floor(Number(text));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return bounds.fallback;
  }
  // Clamp to backend-supported range so what the user sees is what runs.
  return Math.min(Math.max(parsed, bounds.min), bounds.max);
}
