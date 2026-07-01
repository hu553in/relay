import { CheckIcon, MicIcon, Volume2Icon, XIcon } from 'lucide-react';

import { Field } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { RelaySettings } from '@/shared/types';

type SourceSettings = Pick<RelaySettings, 'microphone' | 'systemAudio'>;

interface SourceFieldProps extends SourceSettings {
  disabled?: boolean;
  onChange: (sources: SourceSettings) => void;
}

export function SourceField({
  disabled = false,
  microphone,
  systemAudio,
  onChange,
}: SourceFieldProps) {
  const value = [...(microphone ? ['microphone'] : []), ...(systemAudio ? ['system-audio'] : [])];

  return (
    <Field>
      <ToggleGroup
        aria-label='Audio sources'
        className='w-full'
        multiple
        disabled={disabled}
        spacing={0}
        value={value}
        onValueChange={sources => {
          onChange({
            microphone: sources.includes('microphone'),
            systemAudio: sources.includes('system-audio'),
          });
        }}
      >
        <ToggleGroupItem className='flex-1' disabled={disabled} value='microphone'>
          <MicIcon aria-hidden='true' data-icon='inline-start' />
          Microphone
          <SourceStatusIcon enabled={microphone} />
        </ToggleGroupItem>
        <ToggleGroupItem className='flex-1' disabled={disabled} value='system-audio'>
          <Volume2Icon aria-hidden='true' data-icon='inline-start' />
          System audio
          <SourceStatusIcon enabled={systemAudio} />
        </ToggleGroupItem>
      </ToggleGroup>
    </Field>
  );
}

function SourceStatusIcon({ enabled }: { enabled: boolean }) {
  const Icon = enabled ? CheckIcon : XIcon;

  return (
    <Icon
      aria-hidden='true'
      className={enabled ? 'text-green-500' : 'text-destructive'}
      data-icon='inline-end'
    />
  );
}
