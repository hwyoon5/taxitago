const naverMapClientId = (
  process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID ||
  process.env.NEXT_PUBLIC_NAVER_MAP_NCP_KEY_ID ||
  process.env.NAVER_MAP_CLIENT_ID ||
  process.env.NAVER_CLIENT_ID ||
  process.env.NCP_KEY_ID ||
  process.env.NAVER_MAP_NCP_KEY_ID ||
  ''
).trim()

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
}

export default nextConfig
