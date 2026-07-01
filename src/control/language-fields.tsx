import { ArrowRightIcon, CaptionsIcon, LanguagesIcon, type LucideIcon } from 'lucide-react';

import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { originalLanguageOptions, translationLanguageOptions } from '@/shared/languages';
import type { LanguageOption } from '@/shared/types';

const originalLanguageItems = createLanguageItems(originalLanguageOptions);
const translationLanguageItems = createLanguageItems(translationLanguageOptions);

function createLanguageItems(options: LanguageOption[]) {
  return options.map(language => ({
    label: language.label,
    value: language.code,
  }));
}

interface LanguageFieldsProps {
  disabled?: boolean;
  originalLanguage: string;
  translationLanguage: string;
  onOriginalLanguageChange: (value: string) => void;
  onTranslationLanguageChange: (value: string) => void;
}

export function LanguageFields({
  disabled = false,
  originalLanguage,
  translationLanguage,
  onOriginalLanguageChange,
  onTranslationLanguageChange,
}: LanguageFieldsProps) {
  return (
    <FieldSet>
      <FieldLegend className='sr-only'>Languages</FieldLegend>
      <FieldGroup className='grid items-end gap-3 min-[481px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'>
        <LanguageField
          icon={CaptionsIcon}
          id='original-language'
          items={originalLanguageItems}
          label='Original'
          value={originalLanguage}
          disabled={disabled}
          onChange={onOriginalLanguageChange}
        />
        <ArrowRightIcon
          aria-hidden='true'
          className='hidden size-5 self-center text-muted-foreground min-[481px]:block'
        />
        <LanguageField
          icon={LanguagesIcon}
          id='translation-language'
          items={translationLanguageItems}
          label='Translation'
          value={translationLanguage}
          disabled={disabled}
          onChange={onTranslationLanguageChange}
        />
      </FieldGroup>
    </FieldSet>
  );
}

function LanguageField({
  disabled = false,
  id,
  items,
  label,
  value,
  onChange,
  icon: Icon,
}: {
  disabled?: boolean;
  id: string;
  items: ReturnType<typeof createLanguageItems>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon: LucideIcon;
}) {
  return (
    <Field>
      <FieldLabel className='sr-only' htmlFor={id}>
        {label}
      </FieldLabel>
      <Select
        disabled={disabled}
        items={items}
        value={value}
        onValueChange={nextValue => {
          onChange(String(nextValue));
        }}
      >
        <SelectTrigger className='w-full' disabled={disabled} id={id}>
          <Icon aria-hidden='true' />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map(language => (
              <SelectItem key={language.value} value={language.value}>
                {language.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
