export type DeviceKind = 'bicycle' | 'kickboard' | 'ev' | 'parking' | string

export type DeviceTelemetry = {
  deviceId: string
  type: DeviceKind
  latitude: number
  longitude: number
  batteryLevel: number | null
  status: string
  /** 최근 위치 신고 시각 (서버 수신 시각 기준) */
  lastSeen: string
  /** 최초 등록 시각 */
  firstSeen: string
  /** 누적 위치 신고 횟수 */
  updateCount: number
  /** 파트너 등록 시설이면 소유 파트너 UID */
  ownerUid?: string
  ownerName?: string
  /** 카테고리별 상세 스펙 — registerDevice로 등록된 경우에만 존재 */
  spec?: DeviceSpec
  /** 파트너 폼으로 명시 등록된 시설이면 true — 원시 텔레메트리 전용 기기와 구분 */
  registered?: boolean
}

/** 자전거·킥보드 — 이동 수단 기기 스펙 */
export type MobilitySpec = {
  kind: 'mobility'
  /** 기기 모델명 (예: 전동 킥보드 모델 A) */
  model: string
  /** 최대 속도 제한 km/h — null이면 미지정 */
  speedLimitKmh: number | null
  /** 기타 기기 스펙 메모 */
  specNote: string
  /** 초기 배치 위치 주소 */
  address: string
  latitude: number | null
  longitude: number | null
  /** 초기 배터리 잔량 % */
  batteryLevel: number | null
  /** 잠금 상태 */
  locked: boolean
  /** 대여 가능 여부 */
  rentable: boolean
}

/** EV 충전기 스펙 */
export type EvChargerSpec = {
  kind: 'ev'
  /** 충전 방식 (완속·급속·콤보·차데모 등) */
  chargeType: string
  /** 출력 용량 kW */
  powerKw: number | null
  /** 설치 장소명 */
  placeName: string
  /** 상세 위치 (예: 부산역 지하 2층 주차장) */
  locationDetail: string
  /** 이용 요금 kWh당 단가 */
  pricePerKwh: number | null
  /** 운영 시간 (예: 24시간, 06:00-23:00) */
  operatingHours: string
  address: string
  latitude: number | null
  longitude: number | null
}

/** 주차장 스펙 */
export type ParkingSpec = {
  kind: 'parking'
  /** 총 주차 면수 */
  spaces: number | null
  /** 주차장 유형 (노상·노외·실내 타워 등) */
  lotType: string
  /** 기본 요금 */
  baseFee: number | null
  /** 추가 요금 */
  extraFee: number | null
  /** 추가 요금 단위 시간(분) */
  feeUnitMinutes: number | null
  /** 상세 위치 */
  address: string
  latitude: number | null
  longitude: number | null
  /** 진입 안내 */
  entranceNote: string
}

export type DeviceSpec = MobilitySpec | EvChargerSpec | ParkingSpec
export type SpecKind = DeviceSpec['kind']

export const DEVICE_TYPE_LABEL: Record<string, string> = {
  bicycle: '자전거',
  kickboard: '킥보드',
  ev: 'EV충전',
  parking: '주차',
}
export const deviceTypeLabel = (type: string) => DEVICE_TYPE_LABEL[type] || type || '기타'

/** 가입 폼의 한국어 시설 서비스명 → 기기 유형 */
export function facilityTypeToDeviceKind(facilityType?: string | null): DeviceKind | '' {
  switch (facilityType) {
    case '자전거': return 'bicycle'
    case '킥보드': return 'kickboard'
    case 'EV 충전': return 'ev'
    case '주차': return 'parking'
    default: return ''
  }
}

/** 기기 유형 → spec 종류 (자전거·킥보드는 같은 모빌리티 폼을 쓴다) */
export function specKindForDeviceKind(kind: string): SpecKind | '' {
  if (kind === 'bicycle' || kind === 'kickboard') return 'mobility'
  if (kind === 'ev') return 'ev'
  if (kind === 'parking') return 'parking'
  return ''
}

export const EV_CHARGE_TYPES = ['완속', '급속', '콤보', '차데모'] as const
export const PARKING_LOT_TYPES = ['노상', '노외', '실내 타워', '기계식'] as const
export const SPEED_LIMIT_OPTIONS = [15, 20, 25, 30] as const

export function emptySpec(kind: SpecKind): DeviceSpec {
  if (kind === 'mobility') {
    return { kind, model: '', speedLimitKmh: null, specNote: '', address: '', latitude: null, longitude: null, batteryLevel: 100, locked: true, rentable: false }
  }
  if (kind === 'ev') {
    return { kind, chargeType: '완속', powerKw: null, placeName: '', locationDetail: '', pricePerKwh: null, operatingHours: '', address: '', latitude: null, longitude: null }
  }
  return { kind, spaces: null, lotType: '노외', baseFee: null, extraFee: null, feeUnitMinutes: null, address: '', latitude: null, longitude: null, entranceNote: '' }
}

/** 관리자 목록에 보일 spec 요약 문장 */
export function specSummary(spec: DeviceSpec | undefined): string {
  if (!spec) return ''
  if (spec.kind === 'mobility') {
    return [
      spec.model,
      spec.speedLimitKmh ? `${spec.speedLimitKmh}km/h` : '',
      spec.address,
      spec.locked ? '잠금' : '해제',
      spec.rentable ? '대여 가능' : '대여 불가',
    ].filter(Boolean).join(' · ')
  }
  if (spec.kind === 'ev') {
    return [
      spec.chargeType,
      spec.powerKw ? `${spec.powerKw}kW` : '',
      spec.placeName,
      spec.locationDetail,
      spec.pricePerKwh !== null ? `${spec.pricePerKwh}원/kWh` : '',
      spec.operatingHours,
    ].filter(Boolean).join(' · ')
  }
  return [
    spec.lotType,
    spec.spaces !== null ? `${spec.spaces}면` : '',
    spec.address,
    spec.baseFee !== null ? `기본 ${spec.baseFee}원` : '',
    spec.extraFee !== null && spec.feeUnitMinutes ? `추가 ${spec.extraFee}원/${spec.feeUnitMinutes}분` : '',
  ].filter(Boolean).join(' · ')
}
