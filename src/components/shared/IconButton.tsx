import { BrushCleaning } from 'lucide-react';
import type { ReactNode } from 'react';

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
  label = 'Clear log',
  onClick,
  disabled = false,
}: {
  label?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <IconButton
      label={label}
      onClick={onClick}
      disabled={disabled}
      icon={<BrushCleaning size={14} />}
    />
  );
}
