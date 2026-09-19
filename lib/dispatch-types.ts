export type RideStatus =
  | 'searching'
  | 'offered'
  | 'assigned'
  | 'unmatched'
  | 'cancelled'
  | 'completed'

export type DriverDutyStatus = 'online' | 'offline' | 'busy'

export type OfferDecision = 'pending' | 'accepted' | 'rejected' | 'timeout'

export type GeoPoint = {
  lat: number
  lng: number
  address?: string
  label?: string
}

/** Ride request row: pickup/dest + quoted fare. */
export type RideRequestRecord = {
  id: string
  passengerId: string
  pickup: GeoPoint
  dest: GeoPoint
  estimatedFare: number
  status: RideStatus
  assignedDriverId: string | null
  currentOffer: RideOfferRecord | null
  declinedDriverIds: string[]
  timedOutDriverIds: string[]
  createdAt: string
  updatedAt: string
}

export type RideOfferRecord = {
  rideId: string
  driverId: string
  rank: number
  pickupDistanceKm: number
  offeredAt: string
  expiresAt: string
  decision: OfferDecision
}

export type DriverRecord = {
  id: string
  name: string
  vehicle: string
  plate: string
  rating: string
  lat: number
  lng: number
  status: DriverDutyStatus
  lastSeenAt: string
  virtual: boolean
}

export type PublicDriver = {
  id: string
  name: string
  vehicle: string
  plate: string
  rating: string
  etaMinutes: number
  pickupDistanceKm: number
}

export type PublicRide = {
  id: string
  passengerId: string
  pickup: GeoPoint
  dest: GeoPoint
  estimatedFare: number
  status: RideStatus
  offerExpiresAt: string | null
  assignedDriver: PublicDriver | null
  createdAt: string
  updatedAt: string
}

export const OFFER_TIMEOUT_MS = 12_000
export const VIRTUAL_ACCEPT_MS = 2_200
export const MATCH_RADIUS_KM = 25
export const DRIVER_STALE_MS = 45_000
