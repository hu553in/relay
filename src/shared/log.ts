const LOG_PREFIX = '[relay]';

export function logError(message: string, reason?: unknown): void {
  if (reason === undefined) {
    console.error(LOG_PREFIX, message);
    return;
  }

  console.error(LOG_PREFIX, message, reason);
}

export function logWarn(message: string, reason?: unknown): void {
  if (reason === undefined) {
    console.warn(LOG_PREFIX, message);
    return;
  }

  console.warn(LOG_PREFIX, message, reason);
}
