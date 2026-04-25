import type { ToastItem } from '@/hooks/useToastCenter';

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      role='status'
      aria-live='polite'
      className='pointer-events-none fixed bottom-4 right-4 z-50 grid w-full max-w-sm gap-2'
    >
      {toasts.map(toast => (
        <article
          key={toast.id}
          className={`relay-toast pointer-events-auto rounded-xl border px-4 py-3 shadow-[0_12px_36px_var(--relay-shadow-soft)] ${toneClass(
            toast.tone
          )}`}
        >
          <div className='flex items-start justify-between gap-3'>
            <div className='flex min-w-0 items-start gap-2.5'>
              <span
                aria-hidden
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${iconClass(
                  toast.tone
                )}`}
              >
                {iconFor(toast.tone)}
              </span>
              <div className='min-w-0'>
                <p className='text-[13px] font-medium text-white'>{toast.title}</p>
                <p className='mt-0.5 text-[12.5px] leading-5 text-stone-200'>{toast.message}</p>
              </div>
            </div>
            <button
              type='button'
              onClick={() => {
                onDismiss(toast.id);
              }}
              aria-label='Dismiss'
              className='rounded-lg border border-white/10 px-2 py-0.5 text-[11px] text-stone-300 transition hover:border-white/14 hover:bg-white/12 hover:text-white'
            >
              <span aria-hidden='true'>×</span>
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function toneClass(tone: ToastItem['tone']) {
  if (tone === 'success') {
    return 'border-emerald-400/25 bg-[rgba(8,24,20,0.9)]';
  }
  if (tone === 'warning') {
    return 'border-amber-300/25 bg-[rgba(26,20,8,0.9)]';
  }
  if (tone === 'error') {
    return 'border-rose-500/25 bg-[rgba(32,10,16,0.92)]';
  }
  return 'border-white/12 bg-[rgba(30,30,28,0.92)]';
}

function iconClass(tone: ToastItem['tone']) {
  if (tone === 'success') return 'bg-emerald-400/20 text-emerald-200';
  if (tone === 'warning') return 'bg-amber-300/20 text-amber-200';
  if (tone === 'error') return 'bg-rose-500/20 text-rose-200';
  return 'bg-stone-300/15 text-stone-200';
}

function iconFor(tone: ToastItem['tone']) {
  if (tone === 'success') return '✓';
  if (tone === 'warning') return '!';
  if (tone === 'error') return '×';
  return 'i';
}
