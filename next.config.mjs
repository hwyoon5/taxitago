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
    const validationKeyHeaders = [
      { key: 'Content-Type', value: 'text/plain; charset=utf-8' },
      { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
      { key: 'CDN-Cache-Control', value: 'no-store, max-age=0' },
      { key: 'Vercel-CDN-Cache-Control', value: 'no-store, max-age=0' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
    ]
    return [
      { source: '/validation-key.txt', headers: validationKeyHeaders },
      { source: '/validation-key.txt/', headers: validationKeyHeaders },
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
          source: '/validation-key.txt/',
          destination: '/validation-key.txt',
        },
        {
          source: '/api/geocode',
          destination: '/api/geocode/',
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
