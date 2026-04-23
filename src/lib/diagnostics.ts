export type DiagnosticTone = 'info' | 'warning' | 'error';

export function diagnosticLevelTone(level: string): DiagnosticTone {
  const normalized = level.toLowerCase();
  if (normalized === 'error') {
    return 'error';
  }
  if (normalized === 'warning' || normalized === 'warn') {
    return 'warning';
  }
  return 'info';
}
