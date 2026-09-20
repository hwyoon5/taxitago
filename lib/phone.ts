export function digitsOnly(value: string) {
  return value.replace(/\D/g, '')
}

export function formatKoreanPhone(value: string) {
  const digits = digitsOnly(value).slice(0, 11)
  if (!digits) return ''
  if (digits.startsWith('02')) {
    if (digits.length <= 2) return digits
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`
  }
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

export function isValidKoreanPhone(value: string) {
  const digits = digitsOnly(value)
  if (digits.startsWith('02')) return digits.length === 9 || digits.length === 10
  if (digits.startsWith('01')) return digits.length === 10 || digits.length === 11
  return digits.length === 10 || digits.length === 11
}

export function telHref(value: string) {
  const digits = digitsOnly(value)
  return digits ? `tel:${digits}` : undefined
}
