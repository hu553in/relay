import { useElementSize } from '@reactuses/core';
import type { ComponentProps } from 'react';
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';
import { logWarn } from '@/shared/log';

export function WindowFrame({ className, ...props }: ComponentProps<'main'>) {
  const frameRef = useRef<HTMLElement | null>(null);
  const [width, height] = useElementSize(frameRef, { box: 'border-box' });

  useEffect(() => {
    if (width <= 0 || height <= 0) {
      return;
    }

    try {
      window.relay.resizeWindow({
        width: Math.ceil(width),
        height: Math.ceil(height),
      });
    } catch (reason) {
      logWarn('Failed to send window resize request.', reason);
    }
  }, [height, width]);

  return (
    <main
      ref={frameRef}
      className={cn('overflow-hidden bg-transparent text-foreground', className)}
      data-theme='dark'
      {...props}
    />
  );
}
