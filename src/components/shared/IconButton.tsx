import { BrushCleaning } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export function IconButton({
  label,
  icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className='inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-transparent text-stone-300 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-35'
    >
      {icon}
    </button>
  );
}

export function ClearLogButton({
  label,
  onClick,
  disabled = false,
}: {
  label?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('common');
  return (
    <IconButton
      label={label ?? t('clearLog')}
      onClick={onClick}
      disabled={disabled}
      icon={<BrushCleaning size={14} />}
    />
  );
}
