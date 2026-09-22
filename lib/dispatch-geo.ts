import { PAYMENT_POLICIES } from '@/lib/payment-policy'

const EARTH_KM = 6371

function toRad(value: number) {
  return (value * Math.PI) / 180
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function estimateTaxiFarePi(distanceKm: number) {
  const base = PAYMENT_POLICIES['택시'].defaultAmount
  const quoted = base + Math.max(0, distanceKm) * 0.28
  return Math.round(Math.max(base, quoted) * 100) / 100
}

export function etaMinutesFromKm(distanceKm: number) {
  return Math.max(2, Math.round(distanceKm / 0.35))
}

export function headingDegrees(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) {
  const y = to.lng - from.lng
  const x = to.lat - from.lat
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export function stepToward(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  stepKm: number,
) {
  const remaining = haversineKm(from, to)
  if (remaining <= stepKm || remaining <= 0.02) return { lat: to.lat, lng: to.lng, arrived: true }
  const ratio = stepKm / remaining
  return {
    lat: from.lat + (to.lat - from.lat) * ratio,
    lng: from.lng + (to.lng - from.lng) * ratio,
    arrived: false,
  }
}
