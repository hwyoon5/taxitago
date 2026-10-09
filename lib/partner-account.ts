import { apiFetch } from '@/lib/app-origin'
import { updateDriverProfile } from '@/lib/dispatch-client'
import { resolvePiSandbox } from '@/lib/pi-sandbox'

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
  const text = detail.trim()
  const parts = text.split(/\s*[·|/]\s*/).map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2) return { vehicle: parts[0], plate: parts.slice(1).join(' ') }
  return { vehicle: text, plate: '' }
}

export function partnerVehicle(profile: Pick<PartnerProfile, 'detail' | 'vehicle' | 'plate'> | null | undefined) {
  const vehicle = profile?.vehicle?.trim() || ''
  const plate = profile?.plate?.trim() || ''
  if (vehicle || plate) return { vehicle, plate }
  return splitVehicleDetail(profile?.detail || '')
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

export function loadPiIdentity(): PiIdentity | null {
  const session = readJson<PiIdentity>(SESSION_KEY)
  if (session?.uid && session.wallet) return session
  const profile = loadPartnerProfile()
  if (profile?.uid && profile.wallet) {
    return { uid: profile.uid, username: profile.username, wallet: profile.wallet }
  }
  return null
}

export function savePiIdentity(identity: PiIdentity) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(identity))
}

export function loadPartnerProfile(): PartnerProfile | null {
  const profile = readJson<PartnerProfile>(PROFILE_KEY)
  return profile?.uid ? profile : null
}

export function savePartnerProfile(profile: PartnerProfile) {
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  savePiIdentity({ uid: profile.uid, username: profile.username, wallet: profile.wallet })
  upsertSettlementLedger(profile.uid, profile.wallet)
}

export function loadSettlementLedger(): SettlementLedger | null {
  const ledger = readJson<SettlementLedger>(LEDGER_KEY)
  return ledger?.uid ? ledger : null
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

/** 잔액 잔존 시 탈퇴 차단 문구 — 클라이언트·서버가 같은 문구를 쓴다. */
export const WITHDRAW_BALANCE_MESSAGE =
  '잔액이 남아있는 상태에서는 탈퇴할 수 없습니다. 잔액을 모두 소진하거나 정산한 후 다시 시도해 주세요.'

export async function requestAccountWithdrawal(uid?: string) {
  const identity = loadPiIdentity()
  const id = uid?.trim() || identity?.uid || loadPartnerProfile()?.uid || ''
  // 클라이언트 사전 차단 — 서버 장부 기준 잔액을 먼저 조회해 0보다 크면 DELETE를
  // 보내지 않고 거절한다. 이 조회가 미처리 입금 스캔까지 유발하므로 미정산
  // 크레딧도 함께 잡힌다. 조회 실패 시엔 통과시켜 서버 최종 검증에 맡긴다.
  const wallet = identity?.wallet || loadPartnerProfile()?.wallet || ''
  if (wallet || id) {
    try {
      const sandbox = resolvePiSandbox({ host: window.location.hostname })
      const probe = await apiFetch(
        `/api/wallet/deposits?from=${encodeURIComponent(wallet)}&uid=${encodeURIComponent(id)}&sandbox=${sandbox}`,
        { cache: 'no-store' },
      )
      const data = (await probe.json().catch(() => null)) as { spendable?: unknown; balance?: unknown } | null
      // 사용 가능 잔액(크레딧−지출)이 권위 — 구형 응답엔 없을 수 있어 크레딧 총액으로 폴백한다.
      const balance = Number(data?.spendable ?? data?.balance)
      if (probe.ok && Number.isFinite(balance) && balance > 0) {
        throw new Error(WITHDRAW_BALANCE_MESSAGE)
      }
    } catch (error) {
      if (error instanceof Error && error.message === WITHDRAW_BALANCE_MESSAGE) throw error
    }
  }
  // 백엔드가 잔액 검사의 최종 권위 — uid가 없어도 호출해 서버가 거절
  // (400 uid required)하게 두고, 로컬만으로 탈퇴를 완료하지 않는다.
  // 서버는 탈퇴 요청자가 해당 uid의 소유자인지 accessToken으로 검증한다 —
  // 헤더와 body 양쪽에 실어 프록시·rewrite에서의 헤더 손실에 대비한다.
  const res = await apiFetch('/api/partner/link/', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(identity?.accessToken ? { 'x-pi-access-token': identity.accessToken } : {}),
    },
    body: JSON.stringify({
      uid: id,
      wallet: identity?.wallet || loadPartnerProfile()?.wallet || '',
      accessToken: identity?.accessToken || undefined,
    }),
  })
  const data = (await res.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null
  if (!res.ok || data?.ok !== true) {
    // 서버가 돌려준 사유(잔액 잔존 등)를 그대로 이용자에게 보인다.
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
      headers: { 'Content-Type': 'application/json' },
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
        insuranceCompany: profile.insuranceCompany,
        insurancePolicyNo: profile.insurancePolicyNo,
        insuranceExpiresAt: profile.insuranceExpiresAt,
        insuranceDocName: profile.insuranceDocName,
        insuranceDocAt: profile.insuranceDocAt,
        linkedAt: profile.linkedAt,
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
    updateDriverProfile({ driverId: next.uid, name: next.name, vehicle: fleet.vehicle, plate: fleet.plate }),
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
