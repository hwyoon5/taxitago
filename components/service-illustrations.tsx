import type { ReactNode } from 'react'

function IconFrame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 64 64" className="h-11 w-11" fill="none" aria-hidden>
      {children}
    </svg>
  )
}

export function TaxiIllustration() {
  return (
    <IconFrame>
      <ellipse cx="32" cy="56" rx="17" ry="3.2" fill="#E2E8F0" />
      <path d="M13 36.5C14.4 26 20.8 20 32 20s17.6 6 19 16.5H13Z" fill="#F5C518" />
      <path d="M19 27c2.2-5 6.4-7.6 13-7.6S42.8 22 45 27H19Z" fill="#E3B008" />
      <path d="M20.5 27.8h9.2l-1 8.2h-8.8c.1-3 .3-5.8.6-8.2Z" fill="#7DD3FC" />
      <path d="M34.3 27.8h9.2c.3 2.4.5 5.2.6 8.2h-8.8l-1-8.2Z" fill="#7DD3FC" />
      <rect x="11" y="36" width="42" height="12" rx="4" fill="#FACC15" />
      <rect x="28.5" y="39.5" width="7" height="4" rx="1.2" fill="#1E293B" />
      <circle cx="20" cy="48.5" r="5.4" fill="#1E293B" />
      <circle cx="44" cy="48.5" r="5.4" fill="#1E293B" />
      <circle cx="20" cy="48.5" r="2.1" fill="#E2E8F0" />
      <circle cx="44" cy="48.5" r="2.1" fill="#E2E8F0" />
      <rect x="13" y="39.5" width="6" height="3.4" rx="1" fill="#FEF3C7" />
      <rect x="45" y="39.5" width="6" height="3.4" rx="1" fill="#FEF3C7" />
    </IconFrame>
  )
}

export function DriverIllustration() {
  return (
    <IconFrame>
      <ellipse cx="32" cy="56" rx="16" ry="3" fill="#E2E8F0" />
      <path d="M17 50c1.8-11 7.2-16.5 15-16.5S45.2 39 47 50v4H17v-4Z" fill="#2563EB" />
      <circle cx="32" cy="21" r="11" fill="#F8C7A6" />
      <path d="M21.5 18.8c1.4-8.2 6.2-12.4 10.5-12.4 4.8 0 9.4 4 10.7 11.4-3.2-2.2-6.8-3-10.7-3-3.6 0-7.2.9-10.5 4Z" fill="#3F2A1D" />
      <path d="M21 39c4.6 5 17.4 5 22 0" stroke="#1E293B" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="32" cy="39" r="3.4" fill="#F8FAFC" stroke="#1E293B" strokeWidth="2.2" />
    </IconFrame>
  )
}

export function ParkingIllustration() {
  return (
    <IconFrame>
      <rect x="10" y="10" width="44" height="44" rx="12" fill="#2563EB" />
      <path d="M23 20.5h11.2c6.1 0 10.1 3.3 10.1 8.7 0 5.5-4 9-10.4 9H29.2V43.5H23V20.5Zm6.2 4.7v8.3h4.8c3.1 0 4.8-1.5 4.8-4.2 0-2.6-1.7-4.1-4.8-4.1H29.2Z" fill="white" />
    </IconFrame>
  )
}

export function BikeIllustration() {
  return (
    <IconFrame>
      <ellipse cx="32" cy="56" rx="18" ry="3" fill="#E2E8F0" />
      <circle cx="17.5" cy="43" r="11" stroke="#059669" strokeWidth="4.4" />
      <circle cx="46.5" cy="43" r="11" stroke="#059669" strokeWidth="4.4" />
      <circle cx="17.5" cy="43" r="3.2" fill="#A7F3D0" />
      <circle cx="46.5" cy="43" r="3.2" fill="#A7F3D0" />
      <path d="M17.5 43L28.8 24.5H38" stroke="#047857" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M28.8 24.5L46.5 43" stroke="#047857" strokeWidth="3.6" strokeLinecap="round" />
      <path d="M28.8 43H46.5" stroke="#10B981" strokeWidth="3.6" strokeLinecap="round" />
      <path d="M34 24.5h9.5" stroke="#065F46" strokeWidth="3.8" strokeLinecap="round" />
    </IconFrame>
  )
}

export function ScooterIllustration() {
  return (
    <IconFrame>
      <ellipse cx="32" cy="56" rx="16" ry="3" fill="#E2E8F0" />
      <rect x="12" y="45.5" width="30" height="5.5" rx="2.6" fill="#F43F5E" />
      <path d="M40.5 48C41.8 32 45 23.5 52.5 16.5" stroke="#E11D48" strokeWidth="4.4" strokeLinecap="round" />
      <path d="M45.5 16h13" stroke="#BE123C" strokeWidth="4.4" strokeLinecap="round" />
      <circle cx="18" cy="51.5" r="6" fill="#1E293B" />
      <circle cx="44.5" cy="51.5" r="6" fill="#1E293B" />
      <circle cx="18" cy="51.5" r="2.3" fill="#FECDD3" />
      <circle cx="44.5" cy="51.5" r="2.3" fill="#FECDD3" />
    </IconFrame>
  )
}

export function ChargeIllustration() {
  return (
    <IconFrame>
      <ellipse cx="32" cy="56" rx="16" ry="3" fill="#E2E8F0" />
      <rect x="14" y="12" width="20" height="36" rx="6" fill="#0284C7" />
      <rect x="18" y="17" width="12" height="17" rx="3" fill="#7DD3FC" />
      <path d="M32 42.5h8c1.8 4.6 2 9.2.4 13" stroke="#0369A1" strokeWidth="3.6" strokeLinecap="round" />
      <rect x="36.5" y="51.5" width="9" height="4.5" rx="1.4" fill="#0EA5E9" />
      <path d="M28.5 19.5 21 32.2h6.2L25.6 43.5 37 28.6h-6.4L28.5 19.5Z" fill="#FACC15" />
    </IconFrame>
  )
}

export function ParcelIllustration() {
  return (
    <IconFrame>
      <ellipse cx="32" cy="56" rx="16" ry="3" fill="#E2E8F0" />
      <path d="M12 24.5 32 13l20 11.5v24L32 55 12 48.5v-24Z" fill="#F59E0B" />
      <path d="M32 13v42" stroke="#B45309" strokeWidth="2.6" />
      <path d="M12 24.5 32 36l20-11.5" stroke="#D97706" strokeWidth="2.6" />
      <path d="M32 13 52 24.5v24L32 55V13Z" fill="#FBBF24" />
      <rect x="25" y="31" width="14" height="10" rx="2" fill="#FFF7ED" />
      <path d="M25 34.8h14" stroke="#EA580C" strokeWidth="2.4" />
    </IconFrame>
  )
}

export function MoreIllustration() {
  return (
    <IconFrame>
      <circle cx="18" cy="18" r="6.2" fill="#6366F1" />
      <circle cx="32" cy="18" r="6.2" fill="#22C55E" />
      <circle cx="46" cy="18" r="6.2" fill="#F59E0B" />
      <circle cx="18" cy="32" r="6.2" fill="#EC4899" />
      <circle cx="32" cy="32" r="6.2" fill="#06B6D4" />
      <circle cx="46" cy="32" r="6.2" fill="#8B5CF6" />
      <circle cx="18" cy="46" r="6.2" fill="#F97316" />
      <circle cx="32" cy="46" r="6.2" fill="#14B8A6" />
      <circle cx="46" cy="46" r="6.2" fill="#64748B" />
    </IconFrame>
  )
}

export const serviceIllustrations = {
  택시: TaxiIllustration,
  대리운전: DriverIllustration,
  주차: ParkingIllustration,
  자전거: BikeIllustration,
  킥보드: ScooterIllustration,
  'EV 충전': ChargeIllustration,
  택배: ParcelIllustration,
  더보기: MoreIllustration,
} as const
