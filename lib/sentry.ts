const tracesSampleRate = process.env.NODE_ENV === 'development' ? 1 : 0.1

export function getSentryOptions() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined

  return {
    dsn,
    enabled: Boolean(dsn),
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV,
    tracesSampleRate,
    sendDefaultPii: false,
  }
}
