export function lifecycleAbort(message: string): Error {
  const reason = new Error(message);
  reason.name = 'AbortError';
  return reason;
}

export function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted && Object.is(error, signal.reason);
}
