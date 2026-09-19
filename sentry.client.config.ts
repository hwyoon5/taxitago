import * as Sentry from '@sentry/nextjs'
import { getSentryOptions } from '@/lib/sentry'

Sentry.init({
  ...getSentryOptions(),
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
  ],
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1,
})
