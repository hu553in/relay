import { Badge, type BadgeTone } from '@/components/shared/Badge';
import type { ServiceHealth } from '@/lib/types';

const HEALTH_LABELS: Record<ServiceHealth, string> = {
  ready: 'Ready',
  degraded: 'Degraded',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
};

function healthTone(health: ServiceHealth): BadgeTone {
  if (health === 'ready') {
    return 'success';
  }
  if (health === 'degraded' || health === 'unavailable') {
    return 'danger';
  }
  return 'neutral';
}

export function HealthBadge({ health }: { health: ServiceHealth }) {
  return <Badge tone={healthTone(health)}>{HEALTH_LABELS[health]}</Badge>;
}
