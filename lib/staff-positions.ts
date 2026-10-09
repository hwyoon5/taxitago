/** 일반 기업 직급 체계 — 드롭다운 선택지. '직접 입력'은 커스텀 문구를 허용한다. */
export const STAFF_POSITIONS = ['사원', '주임', '대리', '과장', '차장', '부장', '팀장', '이사'] as const

/** 팀장급 이상은 운영 관리 권한(manager)으로 본다 — 세션/권한 tier는 role이 담당. */
export const MANAGER_POSITIONS = new Set<string>(['팀장', '이사', '매니저'])

export function positionToRole(position: string): 'manager' | 'staff' {
  return MANAGER_POSITIONS.has(position.trim()) ? 'manager' : 'staff'
}

export function sanitizePosition(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().slice(0, 20)
  return trimmed
}
