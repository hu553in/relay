import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>) {
  return (
    <fieldset data-slot='field-set' className={cn('flex flex-col gap-4', className)} {...props} />
  );
}

function FieldLegend({ className, ...props }: React.ComponentProps<'legend'>) {
  return (
    <legend
      data-slot='field-legend'
      className={cn('mb-1.5 text-base font-medium', className)}
      {...props}
    />
  );
}

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='field-group'
      className={cn(
        'group/field-group @container/field-group flex w-full flex-col gap-5',
        className
      )}
      {...props}
    />
  );
}

function Field({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='field'
      className={cn(
        'group/field flex w-full flex-col gap-2 *:w-full data-[invalid=true]:text-destructive [&>.sr-only]:w-auto',
        className
      )}
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot='field-label'
      className={cn(
        'group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet };
