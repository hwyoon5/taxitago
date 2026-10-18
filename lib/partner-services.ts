import { DELIVERY_VEHICLES, type DeliveryVehicle } from '@/lib/delivery-fare'

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

/* ── 멀티 역할(겸직) · 택배 차량 체급 ─────────────────────────────── */

/** 겸직 역할 목록을 기사 서비스 화이트리스트로 정규화 — 주 서비스는 항상 포함. */
export function normalizeServiceRoles(input: unknown, primary?: string | null): string[] {
  const out: string[] = []
  const head = typeof primary === 'string' && (DRIVER_SERVICE_TYPES as readonly string[]).includes(primary.trim()) ? primary.trim() : ''
  if (head) out.push(head)
  if (Array.isArray(input)) {
    for (const item of input) {
      const role = typeof item === 'string' ? item.trim() : ''
      if ((DRIVER_SERVICE_TYPES as readonly string[]).includes(role) && !out.includes(role)) out.push(role)
    }
  }
  return out
}

type ServiceRoleSource = { serviceType?: string | null; serviceRoles?: string[] | null } | null | undefined

/** 프로필·레지스트리·기사 레코드의 실효 수행 역할 — serviceRoles가 없으면 주 serviceType 단일(레거시). */
export function effectiveServiceRoles(source: ServiceRoleSource): string[] {
  if (!source) return []
  const roles = normalizeServiceRoles(source.serviceRoles, source.serviceType)
  if (roles.length) return roles
  const primary = typeof source.serviceType === 'string' ? source.serviceType.trim() : ''
  return (DRIVER_SERVICE_TYPES as readonly string[]).includes(primary) ? [primary] : []
}

/** 해당 운송 서비스를 수행할 수 있는지 — 겸직 역할 또는 주 서비스에 포함 여부. */
export function partnerServesRole(source: ServiceRoleSource, role: DriverServiceType) {
  return effectiveServiceRoles(source).includes(role)
}

/** 택배 배송 수행 자격 — 주 서비스 '택배'이거나 겸직 역할에 '택배'가 있어야 한다. */
export function partnerServesDelivery(source: ServiceRoleSource) {
  return partnerServesRole(source, '택배')
}

/** 택배 차량 체급 목록을 화이트리스트로 정규화 — 비배열 입력은 빈 목록. */
export function normalizeDeliveryVehicles(input: unknown): DeliveryVehicle[] {
  if (!Array.isArray(input)) return []
  const out: DeliveryVehicle[] = []
  for (const item of input) {
    if ((DELIVERY_VEHICLES as readonly string[]).includes(item as string) && !out.includes(item as DeliveryVehicle)) {
      out.push(item as DeliveryVehicle)
    }
  }
  return out
}

/** 승용차로도 소화 가능한 소화물 규격 — 체급 미지정 겸직 기사에게도 열린다. */
export const SMALL_PARCEL_SIZES = ['document', 'small'] as const

/**
 * 기사가 수행 가능한 택배 차량 체급 — deliveryVehicles가 기록돼 있으면 그 목록이 전부.
 * 미기록(레거시)은: 택배 전업 기사는 전 체급, 겸직은 빈 목록(= 소화물만 가능).
 */
export function deliveryVehicleAllowance(
  source: { serviceType?: string | null; deliveryVehicles?: string[] | null } | null | undefined,
): string[] {
  if (!source) return []
  if (source.deliveryVehicles !== undefined && source.deliveryVehicles !== null) {
    return normalizeDeliveryVehicles(source.deliveryVehicles)
  }
  return source.serviceType?.trim() === '택배' ? [...DELIVERY_VEHICLES] : []
}

/**
 * 택배 콜 매칭 자격 — 택배 수행 역할이 있어야 하고, 콜의 차량 체급이 허용 체급이거나
 * 승용차로 소화 가능한 소화물(서류·소형)이어야 한다. 체급 미지정 콜은 열어둔다.
 */
export function driverDeliveryEligible(
  source: ServiceRoleSource & { deliveryVehicles?: string[] | null },
  job: { vehicle?: string | null; packageSize?: string | null },
): boolean {
  if (!partnerServesDelivery(source)) return false
  const vehicle = (job.vehicle ?? '').trim()
  if (!vehicle) return true
  if (deliveryVehicleAllowance(source).includes(vehicle)) return true
  return (SMALL_PARCEL_SIZES as readonly string[]).includes((job.packageSize ?? '').trim())
}

/* ── 자격 인증(컴플라이언스) 증빙 서류 ─────────────────────────────── */

/** 제출 가능한 증빙 서류 — 'license' 운전면허증, 'freight' 화물운송종사자 자격증, 'vehicle' 차량 등록증. */
export const COMPLIANCE_DOC_TYPES = ['license', 'freight', 'vehicle'] as const
export type ComplianceDocType = (typeof COMPLIANCE_DOC_TYPES)[number]

export const COMPLIANCE_DOC_LABEL: Record<ComplianceDocType, string> = {
  license: '운전면허증',
  freight: '화물운송종사자 자격증',
  vehicle: '차량 등록증',
}

export function isComplianceDocType(value: unknown): value is ComplianceDocType {
  return (COMPLIANCE_DOC_TYPES as readonly string[]).includes(value as string)
}

/**
 * 수행 역할에 따른 필수 증빙 — 운전면허증은 기사 서비스 전부에 필수,
 * 택배(화물운송) 역할이 있으면 화물운송종사자 자격증과 차량 등록증이 추가된다.
 * 택시 역할도 차량 등록증이 필요하다. 대리운전 단독은 고객 차량 운행이라 등록증 면제.
 * 시설형 파트너(기사 역할 없음)는 필수 서류가 없다.
 */
export function requiredComplianceDocs(source: ServiceRoleSource): ComplianceDocType[] {
  const roles = effectiveServiceRoles(source)
  if (!roles.length) return []
  const docs: ComplianceDocType[] = ['license']
  const delivery = roles.includes('택배')
  if (delivery) docs.push('freight')
  if (roles.includes('택시') || delivery) docs.push('vehicle')
  return docs
}

/** 차량명·차량번호가 필수인 서비스 — 대리운전·시설 서비스는 차량 정보를 입력하지 않는다. */
export function vehicleRequiredFor(serviceType?: string | null) {
  return serviceType === '택시' || serviceType === '택배'
}

/** 시설 서비스별 식별 번호 라벨 — 파트너 폼의 고유 ID 입력 안내. */
export function facilityUnitLabel(serviceType?: string | null) {
  switch (serviceType) {
    case '주차':
      return '주차장 관리 번호'
    case '자전거':
    case '킥보드':
      return '기기 고유 ID (Serial No.)'
    case 'EV 충전':
      return '충전기 ID / 관리 번호'
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
