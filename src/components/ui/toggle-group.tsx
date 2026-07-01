'use client';

import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { createContext, type CSSProperties, use, useMemo } from 'react';

import { toggleClassName } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';

const ToggleGroupContext = createContext<{
  spacing?: number;
}>({
  spacing: 2,
});

function ToggleGroup({
  className,
  spacing = 2,
  children,
  ...props
}: ToggleGroupPrimitive.Props & {
  spacing?: number;
}) {
  const contextValue = useMemo(() => ({ spacing }), [spacing]);

  return (
    <ToggleGroupPrimitive
      data-slot='toggle-group'
      data-spacing={spacing}
      style={{ '--gap': spacing } as CSSProperties}
      className={cn(
        'group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg',
        className
      )}
      {...props}
    >
      <ToggleGroupContext value={contextValue}>{children}</ToggleGroupContext>
    </ToggleGroupPrimitive>
  );
}

function ToggleGroupItem({ className, children, ...props }: TogglePrimitive.Props) {
  const context = use(ToggleGroupContext);

  return (
    <TogglePrimitive
      data-slot='toggle-group-item'
      data-spacing={context.spacing}
      className={cn(
        'shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:border-l-0 group-data-[spacing=0]/toggle-group:px-2 group-data-[spacing=0]/toggle-group:first:rounded-l-lg group-data-[spacing=0]/toggle-group:first:border-l group-data-[spacing=0]/toggle-group:last:rounded-r-lg focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5',
        toggleClassName,
        className
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  );
}

export { ToggleGroup, ToggleGroupItem };
