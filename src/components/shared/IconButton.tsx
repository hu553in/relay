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
      className='inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/4 text-slate-100 transition hover:bg-white/8'
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
