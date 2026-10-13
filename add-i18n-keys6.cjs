const fs = require('fs')
const path = require('path')

const KEYS = {
  ko: {
    'coupon.placeholder': '할인 쿠폰 코드',
    'coupon.apply': '적용',
    'coupon.checking': '확인 중…',
    'coupon.remove': '해제',
    'coupon.payable': '결제 예정 {v} Pi',
    'coupon.discount': '쿠폰 -{v} Pi',
    'coupon.errGeneric': '쿠폰을 확인하지 못했습니다.',
    'coupon.errNotFound': '사용할 수 없는 쿠폰 코드입니다.',
    'coupon.errInactive': '비활성화된 쿠폰입니다.',
    'coupon.errExpired': '사용 기한이 지난 쿠폰입니다.',
    'coupon.errMinSpend': '최소 결제 금액에 미달합니다.',
    'coupon.errAudience': '이 쿠폰의 발급 대상이 아닙니다.',
    'coupon.errLimit': '사용 한도를 모두 사용했습니다.',
  },
  en: {
    'coupon.placeholder': 'Discount coupon code',
    'coupon.apply': 'Apply',
    'coupon.checking': 'Checking…',
    'coupon.remove': 'Remove',
    'coupon.payable': 'You\'ll pay {v} Pi',
    'coupon.discount': 'Coupon -{v} Pi',
    'coupon.errGeneric': 'Couldn\'t verify the coupon.',
    'coupon.errNotFound': 'This coupon code isn\'t valid.',
    'coupon.errInactive': 'This coupon is disabled.',
    'coupon.errExpired': 'This coupon has expired.',
    'coupon.errMinSpend': 'Below the minimum spend.',
    'coupon.errAudience': 'You\'re not eligible for this coupon.',
    'coupon.errLimit': 'Usage limit reached.',
  },
  ja: {
    'coupon.placeholder': '割引クーポンコード',
    'coupon.apply': '適用',
    'coupon.checking': '確認中…',
    'coupon.remove': '解除',
    'coupon.payable': '支払額 {v} Pi',
    'coupon.discount': 'クーポン -{v} Pi',
    'coupon.errGeneric': 'クーポンを確認できませんでした。',
    'coupon.errNotFound': 'このクーポンコードは使用できません。',
    'coupon.errInactive': 'このクーポンは無効化されています。',
    'coupon.errExpired': 'このクーポンは期限切れです。',
    'coupon.errMinSpend': '最低利用金額に達していません。',
    'coupon.errAudience': 'このクーポンの対象ではありません。',
    'coupon.errLimit': '利用上限に達しました。',
  },
  zh: {
    'coupon.placeholder': '折扣券代码',
    'coupon.apply': '使用',
    'coupon.checking': '检查中…',
    'coupon.remove': '移除',
    'coupon.payable': '实付 {v} Pi',
    'coupon.discount': '优惠券 -{v} Pi',
    'coupon.errGeneric': '无法验证优惠券。',
    'coupon.errNotFound': '此优惠码无效。',
    'coupon.errInactive': '此优惠券已停用。',
    'coupon.errExpired': '此优惠券已过期。',
    'coupon.errMinSpend': '未达到最低消费金额。',
    'coupon.errAudience': '您不符合此优惠券的使用条件。',
    'coupon.errLimit': '已达使用上限。',
  },
}

for (const locale of Object.keys(KEYS)) {
  const file = path.join(__dirname, 'messages', `${locale}.json`)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  let added = 0
  for (const [key, value] of Object.entries(KEYS[locale])) {
    if (!(key in data)) {
      data[key] = value
      added += 1
    }
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
  console.log(locale, 'added', added)
}
