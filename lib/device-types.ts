export type DeviceKind = 'bicycle' | 'kickboard' | 'ev' | 'parking' | string

export type DeviceTelemetry = {
  deviceId: string
  type: DeviceKind
  latitude: number
  longitude: number
  batteryLevel: number | null
  status: string
  /** 최근 위치 신고 시각 (서버 수신 시각 기준) */
  lastSeen: string
  /** 최초 등록 시각 */
  firstSeen: string
  /** 누적 위치 신고 횟수 */
  updateCount: number
}

export const DEVICE_TYPE_LABEL: Record<string, string> = {
  bicycle: '자전거',
  kickboard: '킥보드',
  ev: 'EV충전',
  parking: '주차',
}
export const deviceTypeLabel = (type: string) => DEVICE_TYPE_LABEL[type] || type || '기타'
