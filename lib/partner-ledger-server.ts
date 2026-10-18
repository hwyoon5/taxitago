export type PartnerLinkRecord = {
  uid: string
  username: string
  wallet: string
  role?: string
  name?: string
  phone?: string
  detail?: string
  vehicle?: string
  plate?: string
  region?: string
  serviceType?: string
  /** 겸직 수행 서비스 — serviceType 외에 택시·대리운전·택배를 병행할 때 기록. */
  serviceRoles?: string[]
  /** 택배 수행 시 허용 차량 체급(오토바이·다마스·1톤 트럭). */
  deliveryVehicles?: string[]
  /** 택시 기사가 추가로 제공 가능한 차량 등급('모범'·'대형'·'펫동반') — '일반'은 기본 포함. */
  vehicleTiers?: string[]
  insuranceCompany?: string
  insurancePolicyNo?: string
  insuranceExpiresAt?: string
  insuranceDocName?: string
  insuranceDocAt?: string
  linkedAt: string
  updatedAt: string
}

type Store = Map<string, PartnerLinkRecord>

function store(): Store {
  const globalStore = globalThis as typeof globalThis & { __taxitagoPartnerLinks?: Store }
  if (!globalStore.__taxitagoPartnerLinks) {
    globalStore.__taxitagoPartnerLinks = new Map()
  }
  return globalStore.__taxitagoPartnerLinks
}

export function upsertPartnerLink(record: Omit<PartnerLinkRecord, 'updatedAt'>): PartnerLinkRecord {
  const next: PartnerLinkRecord = { ...record, updatedAt: new Date().toISOString() }
  store().set(record.uid, next)
  return next
}

export function getPartnerLink(uid: string) {
  return store().get(uid) ?? null
}

export function listPartnerLinks() {
  return [...store().values()].sort((a, b) => b.linkedAt.localeCompare(a.linkedAt))
}

export function deletePartnerLink(uid: string) {
  return store().delete(uid)
}
