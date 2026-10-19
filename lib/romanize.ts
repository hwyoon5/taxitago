/**
 * 한국어 주소·지명의 영문(로마자) 표시 변환 — EN 로케일 전용 표시층.
 *
 * - 음절 → 개정 로마자(국립국어원 Revised Romanization) 음차, 동화 규칙 미적용.
 * - 행정 단위 접미사(시·군·구·동·대로·로·길…)는 하이픈형 접미로 변환하고,
 *   번지수는 말미 숫자 토큰을 '-'로 묶어 서양식 역순("번지, 동/도로, 구, 시")으로 재배열한다.
 * - 도로명 주소(로·대로·길 포함)에서는 법정동 토큰을 생략하는 국제 표기 관례를 따른다.
 * - 표시 전용: 상태·검색 키로 쓰는 한국어 원문은 건드리지 않는다.
 */

const L_TABLE = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h']
const V_TABLE = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i']
const T_TABLE = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'l', 'l', 'l', 'l', 'l', 'l', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't']

const HANGUL_RE = /[가-힣]/

export function hasHangul(text: string) {
  return HANGUL_RE.test(text)
}

/** 자주 나오는 차용어 — 음차보다 자연스러운 영문 명칭을 우선한다. */
const LOANWORDS: Record<string, string> = {
  테스트: 'Test',
  데모: 'Demo',
  시연: 'Demo',
  택시: 'Taxi',
  공항: 'Airport',
  호텔: 'Hotel',
  백화점: 'Dept. Store',
}

/** 행정 단위 접미사 → 영문 접미 (''는 도시·광역 단위라 이름만 남긴다). 앞쪽이 우선 매칭. */
const UNIT_SUFFIXES: [string, string][] = [
  ['특별자치시', ''],
  ['특별자치도', ''],
  ['광역시', ''],
  ['특별시', ''],
  ['자치시', ''],
  ['시', ''],
  ['도', '-do'],
  ['군', '-gun'],
  ['구', '-gu'],
  ['동', '-dong'],
  ['읍', '-eup'],
  ['면', '-myeon'],
  ['리', '-ri'],
  ['대로', '-daero'],
  ['로', '-ro'],
  ['길', '-gil'],
]

const ROAD_SUFFIXES = new Set(['-daero', '-ro', '-gil'])
const DONG_SUFFIXES = new Set(['-dong', '-eup', '-myeon', '-ri'])

function romanizeSyllable(code: number) {
  const idx = code - 0xac00
  const initial = L_TABLE[Math.floor(idx / 588)]
  const medial = V_TABLE[Math.floor((idx % 588) / 28)]
  const final = T_TABLE[idx % 28]
  return initial + medial + final
}

/** 한국어 토큰 음차 — 한글만 변환하고 숫자·기호는 그대로 둔다. */
export function romanizeHangul(text: string) {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    out += code >= 0xac00 && code <= 0xd7a3 ? romanizeSyllable(code) : ch
  }
  return out
}

function capitalize(text: string) {
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

/** 주소가 아닌 지명·자유 텍스트의 음차 표시 — 차용어 사전을 우선 적용한다. */
export function romanizeKoreanText(text: string) {
  const trimmed = text.trim()
  if (!trimmed || !hasHangul(trimmed)) return trimmed
  const loan = LOANWORDS[trimmed]
  if (loan) return loan
  return trimmed
    .split(/\s+/)
    .map((word) => (LOANWORDS[word] ? LOANWORDS[word] : capitalize(romanizeHangul(word))))
    .join(' ')
}

type AddrToken = { text: string; suffix: string }

function romanizeAddressToken(token: string): AddrToken | null {
  for (const [unit, eng] of UNIT_SUFFIXES) {
    if (token.length > unit.length && token.endsWith(unit)) {
      return { text: romanizeHangul(token.slice(0, -unit.length)) + eng, suffix: eng }
    }
  }
  // 접미사에 안 걸리는 토큰(역명·건물명 등)은 그대로 음차
  return hasHangul(token) ? { text: capitalize(romanizeHangul(token)), suffix: '' } : { text: token, suffix: '' }
}

/**
 * 한국식 주소 → 영문 표기. "부산광역시 북구 구포동 1173-4" → "1173-4, Gupo-dong, Buk-gu, Busan".
 * 주소 패턴이 아니면(한글만 없거나 토큰 부족) 일반 음차로 폴백한다.
 */
export function romanizeKoreanAddress(address: string) {
  const trimmed = address.trim()
  if (!trimmed || !hasHangul(trimmed)) return trimmed
  if (LOANWORDS[trimmed]) return LOANWORDS[trimmed]

  const raw = trimmed.split(/\s+/).filter(Boolean)
  const numbers: string[] = []
  const words: AddrToken[] = []
  for (const token of raw) {
    const digits = token.match(/^(\d[\d-]*)(번지|호|층)?$/)
    if (digits) {
      numbers.push(digits[1])
      continue
    }
    // "덕영대로924"처럼 붙은 번지를 분리한다.
    const glued = token.match(/^([가-힣]+(?:로|길|동|리|가))(\d[\d-]*)$/)
    if (glued) {
      const parsed = romanizeAddressToken(glued[1])
      if (parsed) words.push(parsed)
      numbers.push(glued[2])
      continue
    }
    const parsed = romanizeAddressToken(token)
    if (parsed) words.push(parsed)
  }

  const hasUnit = words.some((w) => w.suffix !== '')
  if (!hasUnit || words.length === 0) {
    // 행정 단위가 없는 일반 지명 → 음차만
    const name = words.map((w) => w.text).join(' ')
    return [numbers.join('-'), name].filter(Boolean).join(' ') || trimmed
  }

  const hasRoad = words.some((w) => ROAD_SUFFIXES.has(w.suffix))
  const ordered = [...words].reverse().filter((w) => !(hasRoad && DONG_SUFFIXES.has(w.suffix)))
  const numPart = numbers.join('-')
  // '제주특별자치도 제주시'처럼 같은 명칭이 이어지면 중복을 제거한다.
  const parts = ordered.map((w) => capitalize(w.text)).filter((part, i, arr) => part !== arr[i - 1])
  return [numPart, ...parts].filter(Boolean).join(', ')
}

/** EN 로케일에서 주소/지명을 로마자로 표시 — 한글이 없으면 원문 유지. */
export function displayAddress(text: string, locale: string) {
  if (locale !== 'en' || !hasHangul(text)) return text
  return romanizeKoreanAddress(text)
}

/** '출발 → 도착' 경로 문자열의 각 구간을 로마자로 표시. */
export function displayRoute(route: string, locale: string) {
  if (locale !== 'en' || !hasHangul(route)) return route
  return route
    .split(/→|↔/)
    .map((part) => {
      const trimmedPart = part.trim()
      return trimmedPart ? romanizeKoreanAddress(trimmedPart) : trimmedPart
    })
    .join(' → ')
}
