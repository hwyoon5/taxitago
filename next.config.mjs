/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return [
      { source: '/index.html', destination: '/' },
      { source: '/index', destination: '/' },
    ]
  },
}

export default nextConfig
