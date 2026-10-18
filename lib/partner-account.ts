import { apiFetch } from '@/lib/app-origin'
import { updateDriverProfile } from '@/lib/dispatch-client'
import { normalizeVehicleTiers } from '@/lib/ride-tiers'
import { normalizeDeliveryVehicles, normalizeServiceRoles } from '@/lib/partner-services'

export type PiIdentity = {
  uid: string
  username: string
  wallet: string
  /** Pi authenticate 결과의 이용자 토큰 — 서버측 재검증 자격증명. */
  accessToken?: string
}

/** 개발용 샌드박스 세션 uid — 테스트넷 환경에서만 서버가 토큰 없이 통과시킨다. */
export const SANDBOX_PI_UID = 'sandbox-uid-taxitago'

/**
 * 호출 등 보호 기능의 인증 게이트 — 실제 Pi 토큰이 실린 세션이거나
 * 개발용 샌드박스 세션만 통과한다. 토큰 없는 구형 세션은 재로그인이 필요하다.
 */
export function hasPiCallCredential(identity: PiIdentity | null | undefined) {
  if (!identity?.uid) return false
  return Boolean(identity.accessToken?.trim()) || identity.uid === SANDBOX_PI_UID
}

export type PartnerProfile = PiIdentity & {
  role: '기사' | '파트너'
  name: string
  phone: string
  detail: string
  region: string
  serviceType?: string
  /** 겸직(Multi-role) 수행 서비스 — serviceType 외에 택시·대리운전·택배를 병행할 때 기록. */
  serviceRoles?: string[]
  /** 택배 수행 시 허용 차량 체급(오토바이·다마스·1톤 트럭) — 미설정은 서비스별 기본 규칙. */
  deliveryVehicles?: string[]
  /** 택시 기사가 추가로 제공 가능한 차량 등급('모범'·'대형'·'펫동반') — '일반'은 기본 포함. */
  vehicleTiers?: string[]
  vehicle?: string
  plate?: string
  insuranceCompany?: string
  insurancePolicyNo?: string
  insuranceExpiresAt?: string
  insuranceDocName?: string
  insuranceDocAt?: string
  linkedAt: string
}

export function splitVehicleDetail(detail: string) {
  // 손상된 프로필(localStorage JSON 변형 등)로 detail이 문자열이 아니어도
  // .trim() TypeError 없이 빈 값으로 수렴한다.
  const text = (typeof detail === 'string' ? detail : '').trim()
  const parts = text.split(/\s*[·|/]\s*/).map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2) return { vehicle: parts[0], plate: parts.slice(1).join(' ') }
  return { vehicle: text, plate: '' }
}

export function partnerVehicle(profile: Pick<PartnerProfile, 'detail' | 'vehicle' | 'plate'> | null | undefined) {
  const vehicle = typeof profile?.vehicle === 'string' ? profile.vehicle.trim() : ''
  const plate = typeof profile?.plate === 'string' ? profile.plate.trim() : ''
  if (vehicle || plate) return { vehicle, plate }
  return splitVehicleDetail(typeof profile?.detail === 'string' ? profile.detail : '')
}

export type SettlementEntry = {
  at: string
  amount: number
  memo: string
}

export type SettlementLedger = {
  uid: string
  wallet: string
  updatedAt: string
  entries: SettlementEntry[]
}

const SESSION_KEY = 'taxitago-pi-session'
const PROFILE_KEY = 'taxitago-partner-profile'
const LEDGER_KEY = 'taxitago-partner-settlement'

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** 저장소(JSON) 경계의 필드 정규화 — 비문자열 값이 .trim() 등 호출부를 깨뜨리지 않게 한다. */
const textOf = (value: unknown) => (typeof value === 'string' ? value : '')

export function loadPiIdentity(): PiIdentity | null {
  const session = readJson<PiIdentity>(SESSION_KEY)
  const uid = textOf(session?.uid).trim()
  const wallet = textOf(session?.wallet).trim()
  if (uid && wallet) {
    // 세션 토큰이 비어 있으면(과거 버전이 토큰 없이 덮어쓴 저장본) 프로필에
    // 남은 토큰으로 보강한다 — 그래야 탈퇴 등 서버 인증 호출이 401로 끊기지 않는다.
    const accessToken = textOf(session?.accessToken) || textOf(loadPartnerProfile()?.accessToken)
    return { uid, username: textOf(session?.username), wallet, ...(accessToken ? { accessToken } : {}) }
  }
  const profile = loadPartnerProfile()
  if (profile?.uid && profile.wallet) {
    // 파트너 가입 시 저장된 accessToken도 함께 넘겨야 호출 게이트가
    // 토큰 보유 세션으로 인식한다 — 토큰을 버리면 연동 모달로 튄다.
    return {
      uid: profile.uid,
      username: profile.username,
      wallet: profile.wallet,
      ...(profile.accessToken ? { accessToken: profile.accessToken } : {}),
    }
  }
  return null
}

export function savePiIdentity(identity: PiIdentity) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(identity))
}

export function loadPartnerProfile(): PartnerProfile | null {
  const raw = readJson<PartnerProfile>(PROFILE_KEY)
  if (!raw || typeof raw !== 'object') return null
  const uid = textOf(raw.uid).trim()
  if (!uid) return null
  const accessToken = textOf(raw.accessToken)
  // 모든 표시·식별 필드를 문자열로 수렴 — 손상된 저장본이 하위 렌더/핸들러에서
  // TypeError를 일으켜 페이지 크래시로 번지는 것을 막는다.
  return {
    ...raw,
    uid,
    username: textOf(raw.username),
    wallet: textOf(raw.wallet),
    ...(accessToken ? { accessToken } : {}),
    // 비정상 값은 원문 유지 — 어느 권한 검사에도 매칭되지 않아 무권한으로 수렴한다.
    role: (raw.role === '파트너' || raw.role === '기사' ? raw.role : textOf(raw.role)) as PartnerProfile['role'],
    name: textOf(raw.name),
    phone: textOf(raw.phone),
    detail: textOf(raw.detail),
    region: textOf(raw.region),
    serviceType: textOf(raw.serviceType),
    serviceRoles: normalizeServiceRoles(raw.serviceRoles, textOf(raw.serviceType)),
    deliveryVehicles: normalizeDeliveryVehicles(raw.deliveryVehicles),
    vehicleTiers: normalizeVehicleTiers(raw.vehicleTiers),
    vehicle: textOf(raw.vehicle),
    plate: textOf(raw.plate),
    insuranceCompany: textOf(raw.insuranceCompany),
    insurancePolicyNo: textOf(raw.insurancePolicyNo),
    insuranceExpiresAt: textOf(raw.insuranceExpiresAt),
    insuranceDocName: textOf(raw.insuranceDocName),
    insuranceDocAt: textOf(raw.insuranceDocAt),
    linkedAt: textOf(raw.linkedAt),
  }
}

export function savePartnerProfile(profile: PartnerProfile) {
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  // accessToken을 빼고 세션을 덮어쓰면 탈퇴·인증 호출이 401로 거절된다 —
  // 프로필에 실린 토큰을 그대로 세션에도 보존한다.
  savePiIdentity({
    uid: profile.uid,
    username: profile.username,
    wallet: profile.wallet,
    ...(profile.accessToken ? { accessToken: profile.accessToken } : {}),
  })
  upsertSettlementLedger(profile.uid, profile.wallet)
}

export function loadSettlementLedger(): SettlementLedger | null {
  const raw = readJson<SettlementLedger>(LEDGER_KEY)
  const uid = textOf(raw?.uid).trim()
  if (!uid) return null
  const entries = Array.isArray(raw?.entries)
    ? raw.entries
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          at: textOf(entry.at),
          amount: Number.isFinite(Number(entry.amount)) ? Number(entry.amount) : 0,
          memo: textOf(entry.memo),
        }))
    : []
  return { uid, wallet: textOf(raw?.wallet), updatedAt: textOf(raw?.updatedAt), entries }
}

export function upsertSettlementLedger(uid: string, wallet: string) {
  const current = loadSettlementLedger()
  const next: SettlementLedger = {
    uid,
    wallet,
    updatedAt: new Date().toISOString(),
    entries: current?.uid === uid ? current.entries : [],
  }
  window.localStorage.setItem(LEDGER_KEY, JSON.stringify(next))
  return next
}

export function appendSettlementEntry(amount: number, memo: string) {
  const current = loadSettlementLedger()
  if (!current) return null
  const next: SettlementLedger = {
    ...current,
    updatedAt: new Date().toISOString(),
    entries: [{ at: new Date().toISOString(), amount, memo }, ...current.entries].slice(0, 80),
  }
  window.localStorage.setItem(LEDGER_KEY, JSON.stringify(next))
  return next
}

export function clearPartnerAccount() {
  window.localStorage.removeItem(SESSION_KEY)
  window.localStorage.removeItem(PROFILE_KEY)
  window.localStorage.removeItem(LEDGER_KEY)
}

/**
 * 회원탈퇴 시 기기에 남은 사용자 범위 데이터를 전부 파기한다 — 지갑 잔액·
 * 거래 내역·활동 로그·최근 이용·입금 멱등 캐시·배차 세션 등 taxitago-* 키를
 * 지워 재가입이 완전한 신규 상태로 시작되게 한다. 기기 환경 설정(언어·초대
 * 코드)과 관리자 세션은 사용자 데이터가 아니므로 남긴다.
 */
const DEVICE_LEVEL_KEYS = new Set(['taxitago-locale', 'taxitago-invite-code'])

export function purgeLocalUserData() {
  try {
    const doomed: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith('taxitago-')) continue
      if (key.startsWith('taxitago-admin') || DEVICE_LEVEL_KEYS.has(key)) continue
      doomed.push(key)
    }
    for (const key of doomed) window.localStorage.removeItem(key)
    // 세션 스토리지의 사용자 범위 키도 같은 규칙으로 제거한다.
    try {
      const sessionDoomed: string[] = []
      for (let i = 0; i < window.sessionStorage.length; i += 1) {
        const key = window.sessionStorage.key(i)
        if (!key || !key.startsWith('taxitago-')) continue
        if (key.startsWith('taxitago-admin') || DEVICE_LEVEL_KEYS.has(key)) continue
        sessionDoomed.push(key)
      }
      for (const key of sessionDoomed) window.sessionStorage.removeItem(key)
    } catch {
      undefined
    }
  } catch {
    undefined
  }
}

export async function requestAccountWithdrawal(uid?: string) {
  const identity = loadPiIdentity()
  const profile = loadPartnerProfile()
  const id = uid?.trim() || identity?.uid || profile?.uid || ''
  // 토큰 출처를 세션→프로필 순으로 넓힌다 — 기사/파트너 등록이 끝난 계정은
  // 세션에 토큰이 없고 프로필에만 남는 저장본이 있을 수 있다.
  const accessToken = identity?.accessToken || profile?.accessToken || ''
  // uid가 없어도 호출해 서버가 거절
  // (400 uid required)하게 두고, 로컬만으로 탈퇴를 완료하지 않는다.
  // 서버는 탈퇴 요청자가 해당 uid의 소유자인지 accessToken으로 검증한다 —
  // 헤더와 body 양쪽에 실어 프록시·rewrite에서의 헤더 손실에 대비한다.
  // apiFetch엔 기본 타임아웃이 없다 — 서버 장애·네트워크 단절이면 '처리 중'
  // 스피너가 영원히 돌아간다. 서버는 인증(최대 ~8s)과 링크 삭제만 응답 전에
  // 하므로 20초면 충분하고, 초과 시 명확한 오류로 정리해 재시도를 허용한다.
  // 같은 오리진이어도 credentials를 명시해 인앱 브라우저별 쿠키 정책 차이를 없앤다.
  const startedAt = Date.now()
  console.info('[Withdraw] request start', { uid: id || '(missing)', hasToken: Boolean(accessToken) })
  let res: Response
  try {
    res = await apiFetch('/api/partner/link/', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { 'x-pi-access-token': accessToken } : {}),
      },
      body: JSON.stringify({
        uid: id,
        wallet: identity?.wallet || profile?.wallet || '',
        accessToken: accessToken || undefined,
      }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    console.warn('[Withdraw] request failed', { elapsedMs: Date.now() - startedAt, timedOut, error })
    throw new Error(
      timedOut
        ? '서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'
        : '네트워크 오류로 탈퇴 요청을 보내지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.',
    )
  }
  const data = (await res.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null
  console.info('[Withdraw] response received', {
    status: res.status,
    ok: data?.ok === true,
    elapsedMs: Date.now() - startedAt,
  })
  if (!res.ok || data?.ok !== true) {
    // 서버가 돌려준 사유(인증 실패 등)를 그대로 이용자에게 보인다.
    const serverError = typeof data?.error === 'string' ? data.error : ''
    throw new Error(
      serverError === 'uid required'
        ? 'Pi 계정 연동 정보를 찾을 수 없어 탈퇴를 진행할 수 없습니다.'
        : serverError || '회원 탈퇴에 실패했어요.',
    )
  }
  // 서버가 승인한 뒤에만 파기 — 세션·프로필·지갑·활동 등 사용자 범위 전부 제거.
  purgeLocalUserData()
}

export async function syncPartnerLink(profile: PartnerProfile) {
  try {
    await apiFetch('/api/partner/link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 메인넷 서버 검증용 — 프로필에 실린 이용자 토큰을 함께 보낸다.
        // 테스트넷은 토큰 없이도 통과한다(개발 세션 허용).
        ...(profile.accessToken ? { 'x-pi-access-token': profile.accessToken } : {}),
      },
      body: JSON.stringify({
        uid: profile.uid,
        username: profile.username,
        wallet: profile.wallet,
        role: profile.role,
        name: profile.name,
        phone: profile.phone,
        detail: profile.detail,
        vehicle: profile.vehicle,
        plate: profile.plate,
        region: profile.region,
        serviceType: profile.serviceType,
        serviceRoles: normalizeServiceRoles(profile.serviceRoles, profile.serviceType),
        deliveryVehicles: normalizeDeliveryVehicles(profile.deliveryVehicles),
        vehicleTiers: normalizeVehicleTiers(profile.vehicleTiers),
        insuranceCompany: profile.insuranceCompany,
        insurancePolicyNo: profile.insurancePolicyNo,
        insuranceExpiresAt: profile.insuranceExpiresAt,
        insuranceDocName: profile.insuranceDocName,
        insuranceDocAt: profile.insuranceDocAt,
        linkedAt: profile.linkedAt,
        // 헤더가 프록시에서 손실되는 경우에 대비한 body fallback.
        ...(profile.accessToken ? { accessToken: profile.accessToken } : {}),
      }),
    })
  } catch {
    /* local profile remains the source of truth when the API is unreachable */
  }
}

export type PartnerProfilePatch = {
  name: string
  phone: string
  region: string
  detail: string
  vehicle?: string
  plate?: string
  serviceRoles?: string[]
  deliveryVehicles?: string[]
  vehicleTiers?: string[]
  insuranceCompany?: string
  insurancePolicyNo?: string
  insuranceExpiresAt?: string
  insuranceDocName?: string
  insuranceDocAt?: string
}

/**
 * 최초 등록 이후 기사/파트너 정보 수정. 로컬 프로필을 갱신하고,
 * 파트너 연동 DB와 배차용 기사 레코드(차량명/차량번호)에도 반영한다.
 */
export async function updatePartnerProfile(patch: PartnerProfilePatch): Promise<PartnerProfile | null> {
  const current = loadPartnerProfile()
  if (!current?.uid) return null
  const next: PartnerProfile = {
    ...current,
    name: patch.name.trim() || current.name,
    phone: patch.phone.trim(),
    region: patch.region.trim() || current.region,
    detail: patch.detail.trim(),
    vehicle: patch.vehicle?.trim() ?? current.vehicle,
    plate: patch.plate?.trim() ?? current.plate,
    serviceRoles: patch.serviceRoles !== undefined ? normalizeServiceRoles(patch.serviceRoles, current.serviceType) : current.serviceRoles,
    deliveryVehicles: patch.deliveryVehicles !== undefined ? normalizeDeliveryVehicles(patch.deliveryVehicles) : current.deliveryVehicles,
    vehicleTiers: patch.vehicleTiers !== undefined ? normalizeVehicleTiers(patch.vehicleTiers) : current.vehicleTiers,
    insuranceCompany: patch.insuranceCompany?.trim() ?? current.insuranceCompany,
    insurancePolicyNo: patch.insurancePolicyNo?.trim() ?? current.insurancePolicyNo,
    insuranceExpiresAt: patch.insuranceExpiresAt?.trim() ?? current.insuranceExpiresAt,
    insuranceDocName: patch.insuranceDocName?.trim() ?? current.insuranceDocName,
    insuranceDocAt: patch.insuranceDocAt?.trim() ?? current.insuranceDocAt,
  }
  savePartnerProfile(next)
  const fleet = partnerVehicle(next)
  await Promise.all([
    syncPartnerLink(next),
    updateDriverProfile({
      driverId: next.uid,
      name: next.name,
      vehicle: fleet.vehicle,
      plate: fleet.plate,
      vehicleTiers: next.vehicleTiers,
      serviceRoles: next.serviceRoles,
      deliveryVehicles: next.deliveryVehicles,
    }),
  ])
  return next
}

/** 보험증권 사본(이미지/PDF)을 data URL로 업로드한다. 서버가 파트너 레코드 메타데이터도 갱신한다. */
export async function uploadInsuranceDoc(uid: string, doc: { name: string; mime: string; dataUrl: string }) {
  const res = await apiFetch('/api/partner/insurance-doc/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, name: doc.name, mime: doc.mime, dataUrl: doc.dataUrl }),
  })
  const data = (await res.json().catch(() => null)) as { ok?: boolean; doc?: { name: string; uploadedAt: string }; error?: string } | null
  if (!res.ok || !data?.ok || !data.doc) {
    throw new Error(data?.error || '보험증권 업로드에 실패했습니다.')
  }
  return data.doc
}

/** 자격 인증 증빙(운전면허증·화물운송종사자 자격증·차량 등록증)을 업로드한다 — 새 제출은 항상 심사 대기(pending)가 된다. */
export async function uploadComplianceDoc(uid: string, type: string, doc: { name: string; mime: string; dataUrl: string }) {
  const res = await apiFetch('/api/partner/compliance-doc/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, type, name: doc.name, mime: doc.mime, dataUrl: doc.dataUrl }),
  })
  const data = (await res.json().catch(() => null)) as { ok?: boolean; doc?: { status?: string }; error?: string } | null
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || '증빙 서류 업로드에 실패했습니다.')
  }
  return data.doc
}

/** uid의 자격 인증 서류 상태 묶음(메타만 — 이미지 원본은 포함되지 않는다). */
export type ComplianceDocMeta = {
  name: string
  uploadedAt: string
  status: 'pending' | 'approved' | 'rejected'
  reviewedBy?: string
  reviewedAt?: string
  reviewNote?: string
}

export async function fetchComplianceDocs(uid: string) {
  const res = await apiFetch(`/api/partner/compliance-doc/?uid=${encodeURIComponent(uid)}`, { cache: 'no-store' })
  const data = (await res.json().catch(() => null)) as { ok?: boolean; docs?: Record<string, ComplianceDocMeta> } | null
  if (!res.ok || !data?.ok) return {}
  return data.docs ?? {}
}
