import { useCommittableDraft } from '@/hooks/useCommittableDraft';

export function ShortcutInputField({
  value,
  label,
  onCommit,
}: {
  value: string;
  label: string;
  onCommit: (next: string) => void;
}) {
  const { inputProps } = useCommittableDraft<string>({
    value,
    toDraft: text => text,
    fromDraft: text => text.trim(),
    commit: onCommit,
  });

  return (
    <input
      {...inputProps}
      aria-label={label}
      spellCheck={false}
      autoCapitalize='off'
      className='min-w-58 rounded-lg border border-white/10 bg-black/25 px-2.5 py-1.5 font-mono text-[12px] text-stone-200 outline-none transition placeholder:text-stone-500 focus:border-stone-300/45'
    />
  );
}
