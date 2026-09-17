export type PaymentServiceId = '택시' | '주차' | '자전거' | '킥보드' | 'EV 충전' | '대리운전' | '택배'

export type PaymentTiming = 'prepaid' | 'postpaid' | 'qr_auto'

export type ParkingPaymentOption = Extract<PaymentTiming, 'prepaid' | 'postpaid'>

export type PaymentPolicy = {
  service: PaymentServiceId
  timing: PaymentTiming
  allowedTimings: PaymentTiming[]
  requiresQr: boolean
  qrTarget: 'vehicle' | 'charger' | 'none'
  settleOn: 'start' | 'end' | 'choice'
  defaultAmount: number
  unit: string
  title: string
  summary: string
  startHint: string
  endHint: string
}

export const PAYMENT_POLICIES: Record<PaymentServiceId, PaymentPolicy> = {
  자전거: {
    service: '자전거',
    timing: 'qr_auto',
    allowedTimings: ['qr_auto'],
    requiresQr: true,
    qrTarget: 'vehicle',
    settleOn: 'end',
    defaultAmount: 0.3,
    unit: '건',
    title: '자전거 대여',
    summary: 'QR 스캔 후 이용하고, 반납하면 자동결제됩니다.',
    startHint: '거치대 또는 자전거 QR을 스캔해야 잠금이 해제됩니다.',
    endHint: '이용 종료 시 Pi 잔액에서 자동결제됩니다.',
  },
  킥보드: {
    service: '킥보드',
    timing: 'qr_auto',
    allowedTimings: ['qr_auto'],
    requiresQr: true,
    qrTarget: 'vehicle',
    settleOn: 'end',
    defaultAmount: 0.3,
    unit: '건',
    title: '킥보드 대여',
    summary: 'QR 스캔 후 이용하고, 반납하면 자동결제됩니다.',
    startHint: '킥보드 핸들 QR을 스캔해야 시동이 걸립니다.',
    endHint: '이용 종료 시 Pi 잔액에서 자동결제됩니다.',
  },
  주차: {
    service: '주차',
    timing: 'prepaid',
    allowedTimings: ['prepaid', 'postpaid'],
    requiresQr: false,
    qrTarget: 'none',
    settleOn: 'choice',
    defaultAmount: 2,
    unit: '시간',
    title: '주차',
    summary: '예약 시 선결제하거나, 출차할 때 자동결제할 수 있습니다.',
    startHint: '선결제는 입차 전에 요금을 확정합니다. 후결제는 출차 시 정산됩니다.',
    endHint: '후결제를 선택한 경우 출차와 함께 Pi가 결제됩니다.',
  },
  'EV 충전': {
    service: 'EV 충전',
    timing: 'prepaid',
    allowedTimings: ['prepaid'],
    requiresQr: true,
    qrTarget: 'charger',
    settleOn: 'start',
    defaultAmount: 0.4,
    unit: 'kWh',
    title: 'EV 충전',
    summary: '충전기 QR을 스캔한 뒤, 충전량 기준으로 선결제합니다.',
    startHint: '충전기에 있는 QR을 스캔해야 충전이 시작됩니다.',
    endHint: '충전량에 맞춰 선결제된 금액으로 정산됩니다.',
  },
  택시: {
    service: '택시',
    timing: 'postpaid',
    allowedTimings: ['postpaid'],
    requiresQr: false,
    qrTarget: 'none',
    settleOn: 'end',
    defaultAmount: 2.1,
    unit: '건',
    title: '택시',
    summary: '목적지 도착 후 후결제됩니다.',
    startHint: '호출과 이동 중에는 결제되지 않습니다.',
    endHint: '하차 완료 시 Pi 잔액에서 후결제됩니다.',
  },
  대리운전: {
    service: '대리운전',
    timing: 'postpaid',
    allowedTimings: ['postpaid'],
    requiresQr: false,
    qrTarget: 'none',
    settleOn: 'end',
    defaultAmount: 2.1,
    unit: '건',
    title: '대리운전',
    summary: '목적지 도착 후 후결제됩니다.',
    startHint: '기사 배정과 이동 중에는 결제되지 않습니다.',
    endHint: '도착 후 Pi 잔액에서 후결제됩니다.',
  },
  택배: {
    service: '택배',
    timing: 'prepaid',
    allowedTimings: ['prepaid'],
    requiresQr: false,
    qrTarget: 'none',
    settleOn: 'start',
    defaultAmount: 1.2,
    unit: '건',
    title: '택배',
    summary: '배송 요청 시 예상 요금을 선결제합니다.',
    startHint: '요청과 함께 요금이 결제됩니다.',
    endHint: '배송 완료 후 추가 정산은 없습니다.',
  },
}

const SERVICE_ALIASES: Record<string, PaymentServiceId> = {
  퀵보드: '킥보드',
  킥보드: '킥보드',
  자전거: '자전거',
  주차: '주차',
  'EV 충전': 'EV 충전',
  EV충전: 'EV 충전',
  택시: '택시',
  대리운전: '대리운전',
  택배: '택배',
}

export function resolvePaymentService(service: string): PaymentServiceId | null {
  return SERVICE_ALIASES[service] ?? null
}

export function getPaymentPolicy(service: string): PaymentPolicy | null {
  const id = resolvePaymentService(service)
  return id ? PAYMENT_POLICIES[id] : null
}

export function timingLabel(timing: PaymentTiming) {
  if (timing === 'prepaid') return '선결제'
  if (timing === 'postpaid') return '후결제'
  return 'QR 후 자동결제'
}

export function estimateServiceAmount(service: string, extras?: { kwh?: number; hours?: number }) {
  const policy = getPaymentPolicy(service)
  if (!policy) return 0
  if (policy.service === 'EV 충전') {
    return Math.round(policy.defaultAmount * (extras?.kwh ?? 10) * 100) / 100
  }
  if (policy.service === '주차') {
    return Math.round(policy.defaultAmount * (extras?.hours ?? 1) * 100) / 100
  }
  return policy.defaultAmount
}
