import { useCallback, useEffect, useRef, useState } from 'react';

const BOTTOM_EPSILON = 20;

export function useLiveLogScroll(itemCount: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !autoFollow) {
      return;
    }
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [itemCount, autoFollow]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const distanceToBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const nextAutoFollow = distanceToBottom <= BOTTOM_EPSILON;
      setAutoFollow(current => (current === nextAutoFollow ? current : nextAutoFollow));
    });
  }, []);

  const jumpToLatest = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    setAutoFollow(true);
  }, []);

  return {
    containerRef,
    autoFollow,
    handleScroll,
    jumpToLatest,
  };
}
