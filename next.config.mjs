/** @type {import('next').Next.jsConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true, // 모든 하위 경로를 폴더 형식으로 빌드하여 404 방지
};

export default nextConfig;