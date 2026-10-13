import type { LocalizedText } from '@/lib/i18n'

export type NoticeKind = '공지' | '이벤트' | '업데이트'

export type Notice = {
  id: string
  title: LocalizedText
  date: string
  summary: LocalizedText
  body: LocalizedText
  kind: NoticeKind
}

export const notices: Notice[] = [
  {
    id: '1',
    kind: '공지',
    title: {
      ko: '택시타고 메인넷 결제 안내',
      en: 'TaxiTago mainnet payments',
      ja: 'TaxiTago メインネット決済のご案内',
      zh: 'TaxiTago 主网支付说明',
    },
    date: '2026.09.16',
    summary: {
      ko: 'Pi 메인넷에서 택시·대리 호출 결제가 가능합니다.',
      en: 'You can pay for taxi and driver calls on Pi Mainnet.',
      ja: 'Pi メインネットでタクシー・代行呼出の決済が可能です。',
      zh: '可在 Pi 主网上支付出租车和代驾呼叫费用。',
    },
    body: {
      ko: '택시타고는 Pi Network 메인넷에서 택시 호출, 대리운전, 주차 결제를 지원합니다. 호출 전에 Pi Browser로 로그인한 뒤 잔액을 확인해 주세요. 결제 완료 내역은 이용 기록에서 영수증으로 확인할 수 있습니다.',
      en: 'TaxiTago supports taxi calls, designated driver, and parking payments on Pi Network Mainnet. Please sign in with Pi Browser and check your balance before calling. Completed payments can be viewed as receipts in your ride history.',
      ja: 'TaxiTagoはPi Networkメインネットでタクシー呼出、代行運転、駐車決済をサポートしています。呼出の前にPi Browserでログインし、残高をご確認ください。決済完了履歴は利用記録からレシートとして確認できます。',
      zh: 'TaxiTago 在 Pi Network 主网上支持出租车呼叫、代驾和停车支付。呼叫前请先用 Pi Browser 登录并确认余额。已完成的支付可在使用记录中查看收据。',
    },
  },
  {
    id: '4',
    kind: '이벤트',
    title: {
      ko: '첫 택시 호출 1 Pi 혜택',
      en: '1 Pi off your first taxi call',
      ja: '初回タクシー呼出 1 Pi 特典',
      zh: '首次出租车呼叫立减 1 Pi',
    },
    date: '2026.09.15',
    summary: {
      ko: '이번 주 첫 호출 시 이용 요금에서 1 Pi가 할인됩니다.',
      en: 'Get 1 Pi off the fare on your first call this week.',
      ja: '今週の初回呼出で利用料金から 1 Pi が割引されます。',
      zh: '本周首次呼叫可享 1 Pi 费用减免。',
    },
    body: {
      ko: '파이 모빌리티 회원 대상 이벤트입니다. 9월 한 달 동안 첫 택시 호출을 완료하면 결제 금액에서 1 Pi가 자동 차감됩니다. 혜택은 계정당 1회이며, 취소된 호출에는 적용되지 않습니다.',
      en: 'This event is for Pi Mobility members. Complete your first taxi call during September and 1 Pi is automatically deducted from your payment. The benefit is limited to once per account and does not apply to cancelled calls.',
      ja: 'Piモビリティ会員対象のイベントです。9月中に初回のタクシー呼出を完了すると、決済金額から 1 Pi が自動で差し引かれます。特典はアカウントごとに1回で、キャンセルされた呼出には適用されません。',
      zh: '本活动面向 Pi 出行会员。9月内完成首次出租车呼叫，支付金额自动抵扣 1 Pi。每账户限享 1 次，已取消的呼叫不适用。',
    },
  },
  {
    id: '5',
    kind: '업데이트',
    title: {
      ko: '실시간 매칭 속도가 빨라졌어요',
      en: 'Faster real-time matching',
      ja: 'リアルタイムマッチングが高速化しました',
      zh: '实时匹配速度提升',
    },
    date: '2026.09.14',
    summary: {
      ko: '주변 기사 탐색과 배차 완료 안내가 더 빠르게 표시됩니다.',
      en: 'Nearby driver discovery and dispatch confirmations now appear faster.',
      ja: '周辺ドライバーの検索と配車完了の案内がより速く表示されます。',
      zh: '附近司机搜索与派单完成提示更快显示。',
    },
    body: {
      ko: '시스템 업데이트를 통해 택시 호출 시 기사 매칭 대기 시간을 줄였습니다. 배차 완료 후 기사 위치와 예상 도착 시간이 호출 화면에 바로 반영됩니다. 최신 앱에서 이용해 주세요.',
      en: 'A system update reduced driver matching wait time for taxi calls. Once dispatched, the driver location and ETA are reflected on the call screen right away. Please use the latest app.',
      ja: 'システム更新によりタクシー呼出時のドライバーマッチング待ち時間を短縮しました。配車完了後、ドライバーの位置と到着予定時刻が呼出画面にすぐ反映されます。最新のアプリでご利用ください。',
      zh: '系统更新缩短了出租车呼叫时的司机匹配等待时间。派单完成后，司机位置和预计到达时间会立即显示在呼叫界面。请使用最新版应用。',
    },
  },
  {
    id: '2',
    kind: '공지',
    title: {
      ko: '심야 할증 적용 시간 변경',
      en: 'Late-night surcharge hours updated',
      ja: '深夜割増の適用時間変更',
      zh: '夜间加价时段变更',
    },
    date: '2026.09.10',
    summary: {
      ko: '심야 할증은 밤 12시부터 새벽 4시까지 적용됩니다.',
      en: 'The late-night surcharge applies from midnight to 4 AM.',
      ja: '深夜割増は午前0時から午前4時まで適用されます。',
      zh: '夜间加价适用于凌晨 0 点至 4 点。',
    },
    body: {
      ko: '안전 운행과 기사 수급을 위해 심야 할증 시간을 조정했습니다. 일반 택시는 기본 요금에 1.2배가 적용되며, 프리미엄과 대리운전은 안내된 구간 요금을 따릅니다. 호출 화면에서 예상 요금을 꼭 확인해 주세요.',
      en: 'We adjusted the late-night surcharge window for safe operation and driver supply. Regular taxis charge 1.2x the base fare; premium and designated driver follow the posted zone fares. Please check the estimated fare on the call screen.',
      ja: '安全運行とドライバー確保のため深夜割増の時間を調整しました。一般タクシーは基本料金の1.2倍が適用され、プレミアムと代行運転は案内された区間料金に従います。呼出画面で見積料金を必ずご確認ください。',
      zh: '为保障安全运营与司机供给，我们调整了夜间加价时段。普通出租车按基础费用 1.2 倍计费，高级车型与代驾按公示区间费用执行。请在呼叫界面确认预估费用。',
    },
  },
  {
    id: '6',
    kind: '이벤트',
    title: {
      ko: '친구 초대 시 서비스 마일리지 적립',
      en: 'Earn service mileage for each referral',
      ja: '友達招待でサービスポイント付与',
      zh: '邀请好友得服务积分',
    },
    date: '2026.09.05',
    summary: {
      ko: '초대한 친구가 첫 이용을 완료하면 양쪽 모두 서비스 이용 마일리지를 받습니다.',
      en: 'When your friend completes their first trip, you both earn service-use mileage.',
      ja: '招待した友達が初回の利用を完了すると、双方にサービス利用ポイントが付与されます。',
      zh: '受邀好友完成首次使用后，双方各得服务积分。',
    },
    body: {
      ko: '내 정보에서 초대 코드를 공유해 주세요. 친구가 가입하고 첫 이용을 마치면 초대한 회원과 가입한 회원에게 각각 서비스 이용 마일리지가 적립됩니다. 마일리지는 앱 내 할인·혜택으로만 사용할 수 있으며 현금이나 암호화폐로 교환되지 않습니다. 적립 내역은 이용 내역에서 확인할 수 있습니다.',
      en: 'Share your invite code from My Info. When a friend joins and completes their first trip, both the inviter and the new member receive service-use mileage. Mileage can only be used as in-app discounts and benefits — it cannot be exchanged for cash or cryptocurrency. Check your usage history for details.',
      ja: 'マイ情報から招待コードを共有してください。友達が登録して初回の利用を完了すると、招待した側と登録した側にそれぞれサービス利用ポイントが付与されます。ポイントはアプリ内の割引・特典にのみ使用でき、現金や暗号資産への交換はできません。付与履歴は利用履歴で確認できます。',
      zh: '请在"我的信息"中分享您的邀请码。好友注册并完成首次使用后，邀请人和新用户各得服务积分。积分仅可用于应用内折扣和福利，不可兑换现金或加密货币。可在使用记录中查看明细。',
    },
  },
  {
    id: '3',
    kind: '공지',
    title: {
      ko: '고객센터 운영 시간 안내',
      en: 'Support center hours',
      ja: 'カスタマーセンター営業時間のご案内',
      zh: '客服中心营业时间',
    },
    date: '2026.08.28',
    summary: {
      ko: '1:1 문의는 매일 09:00–22:00에 순차 답변됩니다.',
      en: '1:1 inquiries are answered daily, 09:00–22:00.',
      ja: '1:1お問い合わせは毎日 09:00–22:00 に順次回答します。',
      zh: '一对一咨询每日 09:00–22:00 依次回复。',
    },
    body: {
      ko: '앱 더보기 > 고객센터에서 요금 분쟁과 일반 문의를 접수할 수 있습니다. 운행 중 위급 상황은 호출 화면의 긴급 SOS로 GPS와 차량 정보를 즉시 전달해 주세요. 분실물은 이용 기록의 해당 운행에서 분실물 센터로 접수하면 기사님과 바로 연결됩니다.',
      en: 'You can submit fare disputes and general inquiries via More > Help Center. For emergencies during a ride, use SOS on the call screen to send your GPS and vehicle info instantly. For lost items, file a report from the ride in your history to connect with the driver.',
      ja: 'アプリのその他 > カスタマーセンターで料金トラブルや一般のお問い合わせを受け付けています。運行中の緊急時は呼出画面の緊急SOSでGPSと車両情報が即時送信されます。忘れ物は利用記録の該当運行から忘れ物センターへ申請するとドライバーとすぐ連絡が取れます。',
      zh: '可在"更多 > 客服中心"提交费用争议与一般咨询。行程中遇紧急情况，请使用呼叫界面的紧急 SOS，即时发送 GPS 与车辆信息。遗失物品可在使用记录对应行程中提交失物中心，即可与司机直接联系。',
    },
  },
]

export function getNotice(id: string) {
  return notices.find((notice) => notice.id === id)
}
