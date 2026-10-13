/**
 * 방송 공지 지역 타겟 — 관리자 등록 폼의 지역 선택과 앱 측 지역 판별이 공유한다.
 * 경계 상자는 관제 지도의 권역 필터와 동일한 값을 쓴다.
 */

export type BroadcastRegion = 'nation' | 'metro' | 'gangwon' | 'chungcheong' | 'jeolla' | 'gyeongbuk' | 'gyeongnam' | 'jeju'

export type RegionBounds = { minLat: number; maxLat: number; minLng: number; maxLng: number }

export const BROADCAST_REGIONS: { key: BroadcastRegion; label: string; bounds?: RegionBounds }[] = [
  { key: 'nation', label: '전국' },
  { key: 'metro', label: '수도권', bounds: { minLat: 36.8, maxLat: 38.3, minLng: 126.3, maxLng: 127.9 } },
  { key: 'gangwon', label: '강원', bounds: { minLat: 37.0, maxLat: 38.7, minLng: 127.7, maxLng: 129.6 } },
  { key: 'chungcheong', label: '충청', bounds: { minLat: 35.9, maxLat: 37.1, minLng: 126.9, maxLng: 128.5 } },
  { key: 'jeolla', label: '전라', bounds: { minLat: 34.3, maxLat: 36.1, minLng: 125.9, maxLng: 128.0 } },
  { key: 'gyeongbuk', label: '대구·경북', bounds: { minLat: 35.5, maxLat: 37.6, minLng: 128.0, maxLng: 129.6 } },
  { key: 'gyeongnam', label: '부산·경남', bounds: { minLat: 34.5, maxLat: 35.9, minLng: 127.6, maxLng: 129.4 } },
  { key: 'jeju', label: '제주', bounds: { minLat: 33.0, maxLat: 33.6, minLng: 126.1, maxLng: 127.0 } },
]

export const BROADCAST_REGION_KEYS = BROADCAST_REGIONS.map((r) => r.key)

export function broadcastRegionLabel(key: BroadcastRegion | undefined | null): string {
  return BROADCAST_REGIONS.find((r) => r.key === key)?.label ?? '전국'
}

/** 좌표가 속한 권역 키 — 어느 경계 상자에도 안 들어가면 ''(판별 불가). */
export function broadcastRegionForCoord(lat: number | null | undefined, lng: number | null | undefined): BroadcastRegion | '' {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  for (const region of BROADCAST_REGIONS) {
    const b = region.bounds
    if (b && lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng) return region.key
  }
  return ''
}
