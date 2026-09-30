import type { TicketCategory } from '@/lib/support-types'

type AutoRule = {
  match: RegExp
  reply: string
}

const RULES: AutoRule[] = [
  {
    match: /환불|반환|돌려|환급|refund/i,
    reply:
      '결제 취소·환불 문의는 결제 내역 확인 후 영업일 기준 1~3일 내에 원결제 수단으로 환불됩니다. 이용한 운행의 영수증 화면에서 바로 환불을 요청하실 수도 있으며, 이미 처리된 경우 카드사 반영까지 2~3일이 더 소요될 수 있습니다.',
  },
  {
    match: /결제|요금|fare|payment|바가지|과다청구|더 결제|이중/i,
    reply:
      '요금은 탑승 거리·시간과 예상 요금을 기준으로 자동 계산됩니다. 실제 청구 금액이 예상보다 크게 다르다면 영수증 화면의 "요금 이의 신청"을 이용하거나 운행 번호를 함께 남겨 주시면 운영팀이 확인 후 차액을 조정해 드립니다.',
  },
  {
    match: /호출|배차|부르는|사용법|이용 방법|예약|예약 방법|어떻게/i,
    reply:
      '홈 화면에서 출발지와 목적지를 입력한 뒤 호출 버튼을 누르면 주변 기사님께 요청이 전달됩니다. 기사님이 수락하면 차량번호와 실시간 위치가 표시되고, 도착 알림 후 탑승하시면 됩니다.',
  },
  {
    match: /분실|두고|잃어버|놓고|물건|lost/i,
    reply:
      '분실물은 고객센터 "분실물" 탭에서 해당 운행을 선택해 접수하시면 담당 기사님과 바로 연결됩니다. 물건 종류와 분실 추정 시각을 함께 남겨 주시면 더 빠르게 확인할 수 있습니다.',
  },
  {
    match: /취소|cancel|호출 취소|그만/i,
    reply:
      '기사 배정 전에는 호출 화면에서 즉시 취소할 수 있습니다. 배정 이후 취소는 이용 규정에 따라 취소 수수료가 발생할 수 있으며, 반복 취소는 이용에 제한이 생길 수 있습니다.',
  },
  {
    match: /계정|로그인|인증|회원|탈퇴|비밀번호|번호 변경|전화번호/i,
    reply:
      '계정 관련 설정은 마이페이지 > 설정에서 변경하실 수 있습니다. 로그인이 되지 않거나 번호 변경이 필요한 경우, 본인 확인을 위해 가입 시 사용한 전화번호를 함께 알려 주세요.',
  },
  {
    match: /기사|불친절|난폭|위험|서비스 불만/i,
    reply:
      '서비스 이용 중 불편을 드려 죄송합니다. 기사님 서비스 관련 신고는 해당 운행의 평가 화면 또는 이 문의에 운행 일시·차량번호를 남겨 주시면 운영팀이 사실관계를 확인한 뒤 조치 결과를 안내해 드립니다.',
  },
  {
    match: /포인트|pi\b|적립|코인|결제 수단/i,
    reply:
      'Pi 결제와 적립 내역은 마이페이지의 결제/포인트 메뉴에서 확인하실 수 있습니다. 결제가 실패하거나 포인트가 반영되지 않은 경우, 해당 시각과 금액을 함께 남겨 주시면 확인해 드립니다.',
  },
]

const NEVER_AUTO: TicketCategory[] = ['safety']

export function autoReplyFor(input: { category: TicketCategory; subject: string; body: string }) {
  if (NEVER_AUTO.includes(input.category)) return null
  const text = `${input.subject} ${input.body}`
  const rule = RULES.find((item) => item.match.test(text))
  return rule?.reply ?? null
}
