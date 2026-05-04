import { FolderSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { IconButton } from '@/components/shared/IconButton';
import { useCommittableDraft } from '@/hooks/useCommittableDraft';

export function PathInputField({
  value,
  placeholder,
  onCommit,
  onBrowse,
}: {
  value: string;
  placeholder?: string | undefined;
  onCommit: (next: string) => void;
  onBrowse: () => void;
}) {
  const { t } = useTranslation('common');
  const { inputProps } = useCommittableDraft<string>({
    value,
    toDraft: text => text,
    fromDraft: text => text.trim(),
    commit: onCommit,
  });

  return (
    <div className='flex gap-2'>
      <input
        {...inputProps}
        placeholder={placeholder}
        className='w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-[12px] text-white outline-none transition placeholder:text-stone-500 focus:border-stone-300/45'
      />
      <IconButton label={t('browse')} icon={<FolderSearch size={16} />} onClick={onBrowse} />
    </div>
  );
}
