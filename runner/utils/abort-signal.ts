export function combineAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  return AbortSignal.any(signals.filter(s => s !== undefined));
}
