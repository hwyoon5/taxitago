export type DeliveryVehicle = '오토바이' | '다마스' | '1톤 트럭'
export type PackageSizeId = 'document' | 'small' | 'medium' | 'large' | 'xlarge'

export const DELIVERY_VEHICLES: DeliveryVehicle[] = ['오토바이', '다마스', '1톤 트럭']

export const PACKAGE_SIZES = [
  { id: 'document', label: '서류/소형', hint: '쇼핑백, 서류봉투 / 5kg 이하' },
  { id: 'small', label: '중소형', hint: '라면 박스 크기 / 10kg 이하' },
  { id: 'medium', label: '중형', hint: '우체국 4호 박스 크기 / 20kg 이하' },
  { id: 'large', label: '중대형', hint: '우체국 5~6호 박스 크기 / 30kg 이하' },
  { id: 'xlarge', label: '대형/특대형', hint: '이민가방, 대형 박스 / 30kg 초과 또는 부피 큰 화물' },
] as const

const DELIVERY_FARES: Record<DeliveryVehicle, Record<PackageSizeId, number>> = {
  오토바이: { document: 1.2, small: 1.35, medium: 1.5, large: 1.65, xlarge: 1.8 },
  다마스: { document: 2.2, small: 2.35, medium: 2.6, large: 2.8, xlarge: 3.0 },
  '1톤 트럭': { document: 3.4, small: 3.6, medium: 3.8, large: 4.0, xlarge: 4.2 },
}

export function getPackageSize(id: PackageSizeId) {
  return PACKAGE_SIZES.find((item) => item.id === id) ?? PACKAGE_SIZES[0]
}

export function estimateDeliveryFare(vehicle: DeliveryVehicle, size: PackageSizeId) {
  return DELIVERY_FARES[vehicle][size]
}

export function formatDeliveryFare(amount: number) {
  return Number.isInteger(amount * 10) ? amount.toFixed(1) : amount.toFixed(2)
}
