import type { Metadata } from 'next'
import Script from 'next/script'
import { Geist_Mono, Noto_Sans_KR } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { resolveNaverMapClientId } from '@/lib/naver-maps'
import { PiSdkInit } from '@/components/pi-sdk-init'
import './globals.css'

const notoSansKr = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-noto-sans-kr',
})
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

const naverMapClientId = resolveNaverMapClientId()
const naverMapScript = naverMapClientId
  ? `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(naverMapClientId)}`
  : ''

export const metadata: Metadata = {
  title: '택시타고 TaxiTago',
  description: '파이로 택시호출 및 대리운전 서비스',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ko" className={`bg-background ${notoSansKr.variable} ${geistMono.variable}`}>
      <head>
        {naverMapClientId ? <meta name="naver-map-client-id" content={naverMapClientId} /> : null}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__NAVER_MAP_CLIENT_ID__=${JSON.stringify(naverMapClientId)};`,
          }}
        />
        {naverMapScript ? <Script id="naver-maps-sdk" src={naverMapScript} strategy="beforeInteractive" /> : null}
        <Script id="pi-network-sdk" src="https://sdk.minepi.com/pi-sdk.js" strategy="beforeInteractive" />
      </head>
      <body className={`${notoSansKr.className} font-medium text-[#0f172a] subpixel-antialiased`}>
        <PiSdkInit />
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
