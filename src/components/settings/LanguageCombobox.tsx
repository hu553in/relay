import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from '@headlessui/react';
import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  nl: 'Nederlands',
  pl: 'Polski',
  pt: 'Português',
  ru: 'Русский',
  tr: 'Türkçe',
  uk: 'Українська',
  zh: '中文',
};

// Keep this list explicit: the combobox must remain stable even if object
// insertion order changes during future edits to LANGUAGE_NAMES.
const COMMON_LANGUAGES = [
  'en',
  'de',
  'es',
  'fr',
  'it',
  'ja',
  'ko',
  'nl',
  'pl',
  'pt',
  'ru',
  'tr',
  'uk',
  'zh',
];

export function LanguageCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [query, setQuery] = useState('');

  const trimmedQuery = query.trim();
  const needle = trimmedQuery.toLowerCase();

  const filtered = !needle
    ? COMMON_LANGUAGES
    : COMMON_LANGUAGES.filter(code => {
        const name = LANGUAGE_NAMES[code] ?? code;
        return code.includes(needle) || name.toLowerCase().includes(needle);
      });

  const showCreate = trimmedQuery.length > 0 && !COMMON_LANGUAGES.includes(needle);

  const displayValue = (code: string) => {
    if (!code) return '';
    const name = LANGUAGE_NAMES[code];
    return name ? `${code.toUpperCase()} · ${name}` : code;
  };

  return (
    <Combobox
      value={value}
      onChange={(next: string | null) => {
        if (next !== null) onChange(next);
      }}
      onClose={() => {
        setQuery('');
      }}
    >
      <div className='relative'>
        <ComboboxInput
          aria-label='Target language'
          className='w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 pr-8 text-[12px] text-white outline-none transition placeholder:text-stone-500 focus:border-stone-300/45'
          displayValue={displayValue}
          onChange={event => {
            setQuery(event.target.value);
          }}
          placeholder='Search or type custom code'
        />
        <ComboboxButton className='absolute inset-y-0 right-2 grid place-items-center text-stone-400 transition hover:text-stone-200'>
          <ChevronDown size={16} />
        </ComboboxButton>
        <ComboboxOptions
          anchor='bottom start'
          className='relay-scroll z-20 mt-1 max-h-72 w-(--input-width) overflow-y-auto rounded-xl border border-white/10 bg-[rgba(24,24,22,0.96)] p-1 shadow-[0_18px_60px_rgba(0,0,0,0.4)] backdrop-blur-2xl empty:hidden'
        >
          {filtered.map(code => (
            <ComboboxOption
              key={code}
              value={code}
              className='group flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-[13px] text-stone-200 transition data-focus:bg-white/10 data-selected:text-stone-100'
            >
              <span className='flex items-center gap-2.5'>
                <span className='inline-block w-8 shrink-0 font-mono text-[11px] font-semibold tracking-(--relay-tracking-wide) text-stone-400 group-data-selected:text-stone-300'>
                  {code.toUpperCase()}
                </span>
                <span>{LANGUAGE_NAMES[code] ?? code}</span>
              </span>
              <Check
                size={14}
                className='text-stone-300 opacity-0 group-data-selected:opacity-100'
              />
            </ComboboxOption>
          ))}
          {showCreate ? (
            <ComboboxOption
              value={trimmedQuery}
              className='group mt-1 flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed border-white/10 px-2.5 py-2 text-[13px] text-stone-300 transition data-focus:border-stone-300/40 data-focus:bg-white/9'
            >
              <span className='inline-block w-8 shrink-0 font-mono text-[11px] font-semibold tracking-(--relay-tracking-wide) text-stone-300'>
                {trimmedQuery.slice(0, 3).toUpperCase()}
              </span>
              <span>
                Use custom language &quot;
                <span className='text-stone-200'>{trimmedQuery}</span>&quot;
              </span>
            </ComboboxOption>
          ) : null}
        </ComboboxOptions>
      </div>
    </Combobox>
  );
}
