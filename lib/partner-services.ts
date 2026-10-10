/**
 * 기사/파트너 서비스 항목 상수 — 사용자 가입 폼(home-screen.tsx 파트너 등록),
 * 관리자 '기사·파트너' 폼(admin-partners.tsx), 서버 검증(/api/admin/partners)이
 * 같은 목록을 공유해 양쪽 입력이 항상 일치하게 한다.
 */

/** 기사(role='기사')가 선택할 수 있는 운송 서비스. */
export const DRIVER_SERVICE_TYPES = ['택시', '대리운전', '택배'] as const
export type DriverServiceType = (typeof DRIVER_SERVICE_TYPES)[number]

/** 파트너(role='파트너', 가맹점/시설)가 등록할 수 있는 시설 서비스. */
export const PARTNER_FACILITY_TYPES = ['주차', '자전거', '킥보드', 'EV 충전'] as const
export type PartnerFacilityType = (typeof PARTNER_FACILITY_TYPES)[number]

export const ALL_PARTNER_SERVICE_TYPES = [...DRIVER_SERVICE_TYPES, ...PARTNER_FACILITY_TYPES] as const
export type PartnerServiceType = (typeof ALL_PARTNER_SERVICE_TYPES)[number]

export function isFacilityService(serviceType?: string | null) {
  return (PARTNER_FACILITY_TYPES as readonly string[]).includes(serviceType ?? '')
}

/** 차량명·차량번호가 필수인 서비스 — 대리운전·시설 서비스는 차량 정보를 입력하지 않는다. */
export function vehicleRequiredFor(serviceType?: string | null) {
  return serviceType === '택시' || serviceType === '택배'
}

/** 시설 서비스별 장비·구역 식별 번호 라벨 — 파트너 폼의 장비 번호 입력 안내. */
export function facilityUnitLabel(serviceType?: string | null) {
  switch (serviceType) {
    case '주차':
      return '주차 구역/면 번호'
    case '자전거':
      return '자전거 장비 번호'
    case '킥보드':
      return '킥보드 장비 번호'
    case 'EV 충전':
      return '충전기·스테이션 번호'
    default:
      return '장비·시설 번호'
  }
}

export function facilityUnitPlaceholder(serviceType?: string | null) {
  switch (serviceType) {
    case '주차':
      return '예: B2-142'
    case '자전거':
      return '예: BIKE-0341'
    case '킥보드':
      return '예: KB-2207'
    case 'EV 충전':
      return '예: EV-STA-18'
    default:
      return '장비 식별 번호 입력'
  }
}
