'use client'

import { loadPartnerProfile } from '@/lib/partner-account'

/**
 * 이용자(승객) 포함 전 역할 공통 회원 프로필 — 현재는 본인인증된
 * 휴대전화 번호를 보관한다. 기사·파트너는 가입 폼의 phone이
 * taxitago-partner-profile에도 저장되므로 양쪽을 함께 본다.
 */
export type MemberProfile = {
  uid: string
  phone: string
  phoneVerifiedAt: string
  updatedAt: string
}

const KEY = 'taxitago-member-profile'

export function loadMemberProfile(): MemberProfile | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MemberProfile> | null
    if (!parsed || typeof parsed.phone !== 'string' || !parsed.phone.trim()) return null
    return {
      uid: typeof parsed.uid === 'string' ? parsed.uid : '',
      phone: parsed.phone,
      phoneVerifiedAt: typeof parsed.phoneVerifiedAt === 'string' ? parsed.phoneVerifiedAt : '',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    }
  } catch {
    return null
  }
}

/** 인증이 끝난 번호만 저장한다 — phoneVerifiedAt 없이 호출하지 않는다. */
export function saveMemberPhone(phone: string, uid?: string): MemberProfile {
  const now = new Date().toISOString()
  const current = loadMemberProfile()
  const next: MemberProfile = {
    uid: (uid || current?.uid || '').trim(),
    phone: phone.trim(),
    phoneVerifiedAt: now,
    updatedAt: now,
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    undefined
  }
  return next
}

/** 회원 프로필 번호 우선, 없으면 파트너 가입 시 수집된 번호로 폴백한다. */
export function memberPhone(): string {
  return loadMemberProfile()?.phone?.trim() || loadPartnerProfile()?.phone?.trim() || ''
}

export function clearMemberProfile() {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    undefined
  }
}
