import { BrushCleaning } from 'lucide-react';
import type { ReactNode } from 'react';

export function IconButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={label}
      title={label}
      className='inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-transparent text-stone-300 transition hover:bg-white/10 hover:text-white'
    >
      {icon}
    </button>
  );
}

export function ClearLogButton({
  label = 'Clear log',
  onClick,
}: {
  label?: string;
  onClick: () => void;
}) {
  return <IconButton label={label} onClick={onClick} icon={<BrushCleaning size={14} />} />;
}
