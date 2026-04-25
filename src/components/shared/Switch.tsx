export function Switch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const cursorClass = disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer';
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition ${
        checked ? 'border-cyan-300/18 bg-cyan-500/35' : 'border-white/10 bg-white/5'
      } ${cursorClass}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
