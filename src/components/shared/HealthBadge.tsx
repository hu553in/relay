import { useTranslation } from 'react-i18next';

import { Badge, type BadgeTone } from '@/components/shared/Badge';
import type { ServiceHealth } from '@/lib/types';

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
  const { t } = useTranslation('common');
  const labels: Record<ServiceHealth, string> = {
    ready: t('ready'),
    degraded: t('degraded'),
    unavailable: t('unavailable'),
    unknown: t('unknown'),
  };

  return <Badge tone={healthTone(health)}>{labels[health]}</Badge>;
}
