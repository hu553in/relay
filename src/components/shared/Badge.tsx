import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-white/8 text-stone-300',
  success: 'bg-emerald-500/10 text-emerald-300',
  warning: 'bg-amber-300/15 text-amber-200',
  danger: 'bg-rose-500/10 text-rose-300',
};

const SIZE_CLASSES = {
  sm: 'px-2 py-0.5 text-[10.5px]',
  md: 'px-2.5 py-1 text-[10.5px]',
};

export function Badge({
  children,
  tone = 'neutral',
  size = 'sm',
  className = '',
}: {
  children: ReactNode;
  tone?: BadgeTone;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md font-medium ${SIZE_CLASSES[size]} ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
