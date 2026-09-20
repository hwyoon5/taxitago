export const APP_LOCALES = [
  { id: 'ko', flag: '🇰🇷', nativeName: '한국어', englishName: 'Korean' },
  { id: 'en', flag: '🇺🇸', nativeName: 'English', englishName: 'English' },
  { id: 'ja', flag: '🇯🇵', nativeName: '日本語', englishName: 'Japanese' },
  { id: 'zh', flag: '🇨🇳', nativeName: '中文', englishName: 'Chinese' },
] as const

export type AppLocale = (typeof APP_LOCALES)[number]['id']

export const LOCALE_STORAGE_KEY = 'taxitago-locale'

const MESSAGE_TABLE = {
  ko: {
    'more.notice': '공지사항',
    'more.noticeCaption': '서비스 소식과 업데이트',
    'more.fares': '이용요금 안내',
    'more.faresCaption': '기본요금과 구간 요금',
    'more.support': '고객센터',
    'more.supportCaption': 'SOS · 분실물 · 1:1 문의',
    'more.terms': '약관 및 정책',
    'more.termsCaption': '이용약관 · 개인정보 · 운영정책',
    'more.settings': '앱 설정',
    'more.settingsCaption': '알림 및 환경설정',
    'settings.title': '앱 설정',
    'settings.caption': '알림, 위치, 앱 언어를 관리하세요.',
    'settings.push': '푸시 알림',
    'settings.pushCaption': '호출·배차 소식을 바로 받습니다',
    'settings.marketing': '혜택 알림',
    'settings.marketingCaption': '이벤트와 할인 정보를 받습니다',
    'settings.location': '위치 서비스',
    'settings.locationCaption': '현재 위치 기반 호출에 사용합니다',
    'settings.language': '언어 선택',
    'settings.languageCaption': '앱 화면 표시 언어',
    'settings.languageTitle': '앱 언어',
    'settings.languageHint': '선택한 언어가 앱 전체에 바로 적용됩니다.',
    'settings.close': '닫기',
    'settings.applied': '{name}로 변경했어요',
    'settings.toggleOn': '{label}을 켰어요',
    'settings.toggleOff': '{label}을 껐어요',
  },
  en: {
    'more.notice': 'Notices',
    'more.noticeCaption': 'Service news and updates',
    'more.fares': 'Fares',
    'more.faresCaption': 'Base and distance fares',
    'more.support': 'Help Center',
    'more.supportCaption': 'SOS · Lost items · Inquiries',
    'more.terms': 'Terms & Policies',
    'more.termsCaption': 'Terms, privacy, and operations',
    'more.settings': 'App Settings',
    'more.settingsCaption': 'Notifications and preferences',
    'settings.title': 'App Settings',
    'settings.caption': 'Manage alerts, location, and language.',
    'settings.push': 'Push notifications',
    'settings.pushCaption': 'Get dispatch and ride updates',
    'settings.marketing': 'Promo alerts',
    'settings.marketingCaption': 'Receive events and discounts',
    'settings.location': 'Location services',
    'settings.locationCaption': 'Used for pickup based on GPS',
    'settings.language': 'Language',
    'settings.languageCaption': 'App display language',
    'settings.languageTitle': 'App language',
    'settings.languageHint': 'Your choice applies across the app immediately.',
    'settings.close': 'Close',
    'settings.applied': 'Switched to {name}',
    'settings.toggleOn': 'Turned {label} on',
    'settings.toggleOff': 'Turned {label} off',
  },
  ja: {
    'more.notice': 'お知らせ',
    'more.noticeCaption': 'サービス情報と更新',
    'more.fares': '料金案内',
    'more.faresCaption': '基本料金と区間料金',
    'more.support': 'カスタマーセンター',
    'more.supportCaption': 'SOS・忘れ物・お問い合わせ',
    'more.terms': '規約とポリシー',
    'more.termsCaption': '利用規約・個人情報・運営',
    'more.settings': 'アプリ設定',
    'more.settingsCaption': '通知と環境設定',
    'settings.title': 'アプリ設定',
    'settings.caption': '通知、位置情報、言語を管理します。',
    'settings.push': 'プッシュ通知',
    'settings.pushCaption': '配車・乗車の知らせを受け取ります',
    'settings.marketing': 'お得情報',
    'settings.marketingCaption': 'イベントと割引を受け取ります',
    'settings.location': '位置情報サービス',
    'settings.locationCaption': '現在地からの配車に使用します',
    'settings.language': '言語',
    'settings.languageCaption': 'アプリの表示言語',
    'settings.languageTitle': 'アプリの言語',
    'settings.languageHint': '選択した言語がすぐにアプリ全体へ反映されます。',
    'settings.close': '閉じる',
    'settings.applied': '{name}に変更しました',
    'settings.toggleOn': '{label}をオンにしました',
    'settings.toggleOff': '{label}をオフにしました',
  },
  zh: {
    'more.notice': '公告',
    'more.noticeCaption': '服务动态与更新',
    'more.fares': '费用说明',
    'more.faresCaption': '起步价与区间费用',
    'more.support': '客服中心',
    'more.supportCaption': 'SOS · 失物 · 咨询',
    'more.terms': '条款与政策',
    'more.termsCaption': '使用条款、隐私与运营',
    'more.settings': '应用设置',
    'more.settingsCaption': '通知与偏好设置',
    'settings.title': '应用设置',
    'settings.caption': '管理通知、定位和应用语言。',
    'settings.push': '推送通知',
    'settings.pushCaption': '接收叫车与派单消息',
    'settings.marketing': '优惠通知',
    'settings.marketingCaption': '接收活动与折扣信息',
    'settings.location': '定位服务',
    'settings.locationCaption': '用于基于当前位置的叫车',
    'settings.language': '语言',
    'settings.languageCaption': '应用显示语言',
    'settings.languageTitle': '应用语言',
    'settings.languageHint': '所选语言将立即应用到整个应用。',
    'settings.close': '关闭',
    'settings.applied': '已切换为{name}',
    'settings.toggleOn': '已开启{label}',
    'settings.toggleOff': '已关闭{label}',
  },
} as const

export type MessageKey = keyof typeof MESSAGE_TABLE.ko

function isAppLocale(value: string | null | undefined): value is AppLocale {
  return APP_LOCALES.some((item) => item.id === value)
}

export function readStoredLocale(): AppLocale {
  if (typeof window === 'undefined') return 'ko'
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isAppLocale(stored)) return stored
  } catch {
    undefined
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'ko'
  return isAppLocale(nav) ? nav : 'ko'
}

export function writeStoredLocale(locale: AppLocale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    undefined
  }
}

export function localeMeta(locale: AppLocale) {
  return APP_LOCALES.find((item) => item.id === locale) ?? APP_LOCALES[0]
}

export function translate(locale: AppLocale, key: MessageKey, vars?: Record<string, string>) {
  const table = MESSAGE_TABLE[locale] ?? MESSAGE_TABLE.ko
  let text: string = table[key] || MESSAGE_TABLE.ko[key] || key
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, value)
    }
  }
  return text
}

export function applyDocumentLocale(locale: AppLocale) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale
}
