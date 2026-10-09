import { withSentryConfig } from '@sentry/nextjs/config'

const PLACEHOLDER_IDS = new Set(['', 'YOUR_CLIENT_ID', 'your_client_id', 'undefined', 'null'])

const rawNaverMapClientId = (
  process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID ||
  process.env.NEXT_PUBLIC_NAVER_MAP_NCP_KEY_ID ||
  process.env.NAVER_MAP_CLIENT_ID ||
  process.env.NAVER_CLIENT_ID ||
  process.env.NCP_KEY_ID ||
  process.env.NCP_APIGW_API_KEY_ID ||
  process.env.NAVER_MAP_NCP_KEY_ID ||
  ''
).trim()

const naverMapClientId = PLACEHOLDER_IDS.has(rawNaverMapClientId) ? 'svhbb5mbpy' : rawNaverMapClientId

/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  // Keep generated pages at /mypage/ but do not 308 /validation-key.txt → /validation-key.txt/
  // (that slash path misses the public file and falls through to the SPA 404 home screen).
  skipTrailingSlashRedirect: true,
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_NAVER_MAP_CLIENT_ID: naverMapClientId,
    NEXT_PUBLIC_NAVER_MAP_NCP_KEY_ID: process.env.NEXT_PUBLIC_NAVER_MAP_NCP_KEY_ID || naverMapClientId,
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(self)' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Accept' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ]
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/api/geocode',
          destination: '/api/geocode/',
        },
        {
          source: '/api/rides/:id/cancel',
          destination: '/api/rides/:id/cancel/',
        },
        {
          source: '/api/rides/:id/progress',
          destination: '/api/rides/:id/progress/',
        },
        {
          source: '/api/rides/:id/abandon',
          destination: '/api/rides/:id/abandon/',
        },
        {
          source: '/api/rides/:id/complete',
          destination: '/api/rides/:id/complete/',
        },
        {
          source: '/api/pi/approve',
          destination: '/api/pi/approve/',
        },
        {
          source: '/api/pi/complete',
          destination: '/api/pi/complete/',
        },
        {
          source: '/api/escrow/lock',
          destination: '/api/escrow/lock/',
        },
        {
          source: '/api/partner/link',
          destination: '/api/partner/link/',
        },
        {
          source: '/api/deliveries',
          destination: '/api/deliveries/',
        },
        {
          source: '/api/deliveries/:id',
          destination: '/api/deliveries/:id/',
        },
        {
          source: '/api/deliveries/:id/accept',
          destination: '/api/deliveries/:id/accept/',
        },
        {
          source: '/api/drivers/active',
          destination: '/api/drivers/active/',
        },
        {
          source: '/api/drivers/earnings',
          destination: '/api/drivers/earnings/',
        },
      ],
    }
  },
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/sentry-tunnel',
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
    automaticVercelMonitors: true,
  },
})
