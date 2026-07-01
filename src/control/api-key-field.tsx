import { useToggle } from '@reactuses/core';
import {
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  SaveIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import { cn } from '@/lib/utils';

interface ApiKeyFieldProps {
  apiKey: string;
  disabled?: boolean;
  hasApiKey: boolean;
  onApiKeyChange: (value: string) => void;
  onClearKey: () => void;
  onSaveKey: () => void;
}

export function ApiKeyField({
  apiKey,
  disabled = false,
  hasApiKey,
  onApiKeyChange,
  onClearKey,
  onSaveKey,
}: ApiKeyFieldProps) {
  const [isApiKeyVisible, toggleApiKeyVisible] = useToggle(false);
  const isStoredKeyVisible = hasApiKey && !apiKey.trim();
  const isMissingKeyVisible = !hasApiKey && !apiKey.trim();
  const hasEnteredKey = apiKey.trim().length > 0;
  const KeyStatusIcon = isStoredKeyVisible
    ? CheckIcon
    : isMissingKeyVisible
      ? TriangleAlertIcon
      : null;
  const placeholder = hasApiKey ? 'OpenAI API key stored' : 'OpenAI API key required';
  const VisibilityIcon = isApiKeyVisible ? EyeOffIcon : EyeIcon;
  const canSave = !disabled && hasEnteredKey;
  const canClear = !disabled && (hasApiKey || hasEnteredKey);
  const canToggleVisibility = !disabled && hasEnteredKey;

  return (
    <FieldSet>
      <FieldLegend className='sr-only'>API key</FieldLegend>
      <FieldGroup>
        <Field>
          <div className='flex items-center gap-2'>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>
                  <KeyRoundIcon aria-hidden='true' />
                  {KeyStatusIcon ? (
                    <KeyStatusIcon
                      aria-hidden='true'
                      className={cn(isStoredKeyVisible ? 'text-green-500' : 'text-yellow-500')}
                    />
                  ) : null}
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                aria-label='OpenAI API key'
                disabled={disabled}
                id='api-key'
                placeholder={placeholder}
                spellCheck={false}
                type={isApiKeyVisible ? 'text' : 'password'}
                value={apiKey}
                onChange={event => {
                  onApiKeyChange(event.currentTarget.value);
                }}
              />
              <InputGroupAddon align='inline-end'>
                <InputGroupButton
                  aria-label={isApiKeyVisible ? 'Hide entered API key' : 'Show entered API key'}
                  disabled={!canToggleVisibility}
                  onClick={() => {
                    toggleApiKeyVisible();
                  }}
                >
                  <VisibilityIcon data-icon='inline-start' />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <Button
              aria-label='Save API key'
              disabled={!canSave}
              size='icon-sm'
              type='button'
              variant='outline'
              onClick={onSaveKey}
            >
              <SaveIcon data-icon='inline-start' />
            </Button>
            <Button
              aria-label='Clear API key'
              disabled={!canClear}
              size='icon-sm'
              type='button'
              variant='destructive'
              onClick={onClearKey}
            >
              <Trash2Icon data-icon='inline-start' />
            </Button>
          </div>
        </Field>
      </FieldGroup>
    </FieldSet>
  );
}
