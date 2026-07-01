import { NumberField as NumberFieldPrimitive } from '@base-ui/react/number-field';
import { MinusIcon, PlusIcon } from 'lucide-react';
import { createContext, type ReactNode, use, useId } from 'react';

import { cn } from '@/lib/utils';

const NumberFieldContext = createContext<boolean | null>(null);

const numberFieldGroupClassName =
  'relative flex h-8 w-full justify-between rounded-lg border border-input bg-transparent text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 focus-within:has-aria-invalid:border-destructive focus-within:has-aria-invalid:ring-destructive/20 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 dark:bg-input/30 dark:focus-within:has-aria-invalid:ring-destructive/40 dark:aria-invalid:ring-destructive/40';

const numberFieldButtonClassName =
  "relative flex shrink-0 cursor-pointer items-center justify-center px-2 transition-colors hover:bg-accent pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 [&_svg:not([class*='size-'])]:size-4";

const numberFieldInputClassName =
  'w-full min-w-0 flex-1 bg-transparent px-2.5 py-1 text-center tabular-nums outline-none';

function NumberField({ id, className, ...props }: NumberFieldPrimitive.Root.Props) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <NumberFieldContext value={true}>
      <NumberFieldPrimitive.Root
        className={cn('flex w-full flex-col items-start gap-2', className)}
        data-slot='number-field'
        id={fieldId}
        {...props}
      />
    </NumberFieldContext>
  );
}

function NumberFieldGroup({ className, ...props }: NumberFieldPrimitive.Group.Props) {
  const context = use(NumberFieldContext);
  if (!context) {
    throw new Error('NumberFieldGroup must be used within a NumberField component.');
  }

  return (
    <NumberFieldPrimitive.Group
      className={cn(numberFieldGroupClassName, className)}
      data-slot='number-field-group'
      {...props}
    />
  );
}

function NumberFieldDecrement({
  className,
  children,
  ...props
}: NumberFieldPrimitive.Decrement.Props & {
  children?: ReactNode;
}) {
  const context = use(NumberFieldContext);
  if (!context) {
    throw new Error('NumberFieldDecrement must be used within a NumberField component.');
  }

  return (
    <NumberFieldPrimitive.Decrement
      className={cn(numberFieldButtonClassName, 'rounded-s-lg border-e-0', className)}
      data-slot='number-field-decrement'
      {...props}
    >
      {children ?? <MinusIcon />}
    </NumberFieldPrimitive.Decrement>
  );
}

function NumberFieldIncrement({
  className,
  children,
  ...props
}: NumberFieldPrimitive.Increment.Props & {
  children?: ReactNode;
}) {
  const context = use(NumberFieldContext);
  if (!context) {
    throw new Error('NumberFieldIncrement must be used within a NumberField component.');
  }

  return (
    <NumberFieldPrimitive.Increment
      className={cn(numberFieldButtonClassName, 'rounded-e-lg border-s-0', className)}
      data-slot='number-field-increment'
      {...props}
    >
      {children ?? <PlusIcon />}
    </NumberFieldPrimitive.Increment>
  );
}

function NumberFieldInput({ className, ...props }: NumberFieldPrimitive.Input.Props) {
  const context = use(NumberFieldContext);
  if (!context) {
    throw new Error('NumberFieldInput must be used within a NumberField component.');
  }

  return (
    <NumberFieldPrimitive.Input
      className={cn(numberFieldInputClassName, className)}
      data-slot='number-field-input'
      {...props}
    />
  );
}

export {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
};
