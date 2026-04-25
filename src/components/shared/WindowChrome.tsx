export function WindowDragStrip() {
  return <div role='none' data-tauri-drag-region className='h-9 w-full shrink-0' />;
}

export function WindowShell({ message }: { message: string }) {
  return (
    <main className='bg-(--relay-app-bg) grid h-screen place-items-center text-stone-100'>
      <div className='rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-stone-300 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl'>
        {message}
      </div>
    </main>
  );
}

const LOGO_BARS: { height: string; animationDelay: string }[] = [0.4, 0.9, 0.6, 1, 0.5].map(
  (height, index) => ({
    height: `${String(height * 18)}px`,
    animationDelay: `${String(index * 0.12)}s`,
  })
);

export function LogoMark({ listening, shrink = false }: { listening: boolean; shrink?: boolean }) {
  const shrinkClass = shrink ? 'shrink-0 ' : '';
  return (
    <div
      className={`relative grid h-9 w-9 ${shrinkClass}place-items-center overflow-hidden rounded-xl bg-linear-to-br from-stone-200/16 via-stone-500/10 to-neutral-950/20 ring-1 ring-white/10`}
    >
      <div className='flex items-end gap-0.5'>
        {LOGO_BARS.map((bar, index) => (
          <span
            key={index}
            className={`block w-0.75 rounded-full bg-white ${listening ? 'relay-level-bar' : ''}`}
            style={{
              height: bar.height,
              animationDelay: bar.animationDelay,
              opacity: listening ? 1 : 0.92,
            }}
          />
        ))}
      </div>
    </div>
  );
}
