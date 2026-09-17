import type { Metadata } from 'next'
import MyPage from '@/components/my-page'

export const metadata: Metadata = {
  title: '내 정보 | 택시타고 TaxiTago',
  description: 'Pi Pioneer 지갑, 보유 권한, 이용 내역과 기사·파트너 센터',
}

export default function MyPageRoute() {
  return <MyPage />
}
