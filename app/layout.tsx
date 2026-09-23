import type { Metadata } from 'next'
import Script from 'next/script'
import { Geist_Mono, Noto_Sans_KR } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { resolveNaverMapClientId } from '@/lib/naver-maps'
import { PiSdkInit } from '@/components/pi-sdk-init'
import { LocaleProvider } from '@/components/locale-provider'
import './globals.css'

const notoSansKr = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-noto-sans-kr',
})
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

const naverMapClientId = resolveNaverMapClientId()
const naverMapClientQuery = encodeURIComponent(naverMapClientId)
const naverMapScript = naverMapClientId
  ? `/api/naver-maps/sdk/?ncpKeyId=${naverMapClientQuery}`
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
    <html lang="ko" className={`light bg-[#F8FAFC] ${notoSansKr.variable} ${geistMono.variable}`}>
      <head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light" />
        <meta name="theme-color" content="#F8FAFC" />
        {naverMapClientId ? <meta name="naver-map-client-id" content={naverMapClientId} /> : null}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__NAVER_MAP_CLIENT_ID__=${JSON.stringify(naverMapClientId)};`,
          }}
        />
        {naverMapScript ? (
          <Script id="naver-maps-sdk" src={naverMapScript} strategy="beforeInteractive" referrerPolicy="origin" />
        ) : null}
        <Script id="pi-network-sdk" src="https://sdk.minepi.com/pi-sdk.js" strategy="beforeInteractive" />
      </head>
      <body className={`${notoSansKr.className} bg-[#F8FAFC] font-medium text-[#0f172a] subpixel-antialiased`}>
        <PiSdkInit />
        <LocaleProvider>{children}</LocaleProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
