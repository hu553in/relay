import * as React from 'react';

import { cn } from '@/lib/utils';

const alertClassName =
  "group/alert relative grid w-full gap-0.5 rounded-lg border bg-card px-2.5 py-2 text-left text-sm text-destructive has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:data-[slot=alert-description]:text-destructive/90 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4";

function Alert({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot='alert' role='alert' className={cn(alertClassName, className)} {...props} />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='alert-title'
      className={cn(
        'font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground',
        className
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='alert-description'
      className={cn(
        'text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4',
        className
      )}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle };
