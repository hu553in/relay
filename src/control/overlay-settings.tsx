import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@/components/ui/number-field';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import {
  OVERLAY_OPACITY_PERCENT_STEP,
  OVERLAY_OPACITY_PERCENT_STEPS,
  OVERLAY_ROWS_MAX,
  OVERLAY_ROWS_MIN,
} from '@/shared/defaults';
import type { RelaySettings } from '@/shared/types';

interface OverlaySettingsProps {
  disabled?: boolean;
  overlayOpacity: number;
  overlayRows: number;
  onUpdateSettings: (settings: Partial<RelaySettings>) => Promise<void>;
}

export function OverlaySettings({
  disabled = false,
  overlayOpacity,
  overlayRows,
  onUpdateSettings,
}: OverlaySettingsProps) {
  const opacityValue = Math.round(overlayOpacity * 100);

  return (
    <FieldGroup className='grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-4'>
      <Field data-disabled={disabled || undefined}>
        <FieldLabel htmlFor='overlay-rows'>Overlay rows</FieldLabel>
        <NumberField
          disabled={disabled}
          id='overlay-rows'
          max={OVERLAY_ROWS_MAX}
          min={OVERLAY_ROWS_MIN}
          step={1}
          value={overlayRows}
          onValueChange={value => {
            const nextRows = toFiniteNumber(value, overlayRows);
            void onUpdateSettings({
              overlayRows: nextRows,
            });
          }}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement />
            <NumberFieldInput className='min-w-8' />
            <NumberFieldIncrement />
          </NumberFieldGroup>
        </NumberField>
      </Field>
      <Field data-disabled={disabled || undefined}>
        <div className='flex items-center justify-between gap-3'>
          <FieldLabel htmlFor='overlay-opacity'>Overlay opacity</FieldLabel>
          <span className='text-sm text-muted-foreground'>{opacityValue}%</span>
        </div>
        <Slider
          disabled={disabled}
          id='overlay-opacity'
          max={100}
          min={OVERLAY_OPACITY_PERCENT_STEP}
          step={OVERLAY_OPACITY_PERCENT_STEP}
          value={[opacityValue]}
          onValueChange={(value: unknown) => {
            const nextOpacity = firstSliderValue(value, opacityValue);
            void onUpdateSettings({
              overlayOpacity: nextOpacity / 100,
            });
          }}
        />
        <div className='relative flex h-4 justify-between text-xs text-muted-foreground tabular-nums'>
          {OVERLAY_OPACITY_PERCENT_STEPS.map((step, index) => (
            <span
              key={step}
              className={cn(
                'w-4',
                index === 0
                  ? 'text-left'
                  : index === OVERLAY_OPACITY_PERCENT_STEPS.length - 1
                    ? 'text-right'
                    : 'text-center'
              )}
            >
              {step}
            </span>
          ))}
        </div>
      </Field>
    </FieldGroup>
  );
}

function toFiniteNumber(value: unknown, fallback: number): number {
  if (value === '' || value === null || value === undefined) {
    return fallback;
  }

  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function firstSliderValue(value: unknown, fallback: number): number {
  if (!Array.isArray(value)) {
    return toFiniteNumber(value, fallback);
  }
  return toFiniteNumber(value[0], fallback);
}
