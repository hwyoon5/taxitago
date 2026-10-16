import koMessages from '@/messages/ko.json'
import enMessages from '@/messages/en.json'
import jaMessages from '@/messages/ja.json'
import zhMessages from '@/messages/zh.json'

export const APP_LOCALES = [
  { id: 'ko', flag: '🇰🇷', nativeName: '한국어', englishName: 'Korean', short: 'KR' },
  { id: 'en', flag: '🇺🇸', nativeName: 'English', englishName: 'English', short: 'EN' },
  { id: 'ja', flag: '🇯🇵', nativeName: '日本語', englishName: 'Japanese', short: 'JP' },
  { id: 'zh', flag: '🇨🇳', nativeName: '中文', englishName: 'Chinese', short: 'CN' },
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
    'more.hub': '더보기',
    'more.guide': '안내 · 설정',
    'more.mobility': '이동 서비스',
    'more.close': '닫기',
    'nav.all': '전체보기',
    'nav.partner': '기사/파트너',
    'nav.home': '홈',
    'nav.inbox': '이용/알림',
    'nav.mypage': '내 정보',
    'nav.allCaption': '모든 서비스와 안내를 한곳에서 확인하세요.',
    'brand.name': '택시타고',
    'brand.partner': '파트너',
    'home.pickup': '출발지',
    'home.dest': '목적지',
    'home.destPlaceholder': '어디로 갈까요?',
    'home.destSearch': '목적지 검색 열기',
    'home.callTaxi': '택시 호출',
    'home.callDaeri': '대리운전 부르기',
    'home.whatToUse': '무엇을 이용할까요?',
    'home.serviceCount': '{count}개 서비스',
    'home.recent': '최근 이용',
    'home.content': '홈 콘텐츠',
    'home.allowLocation': '위치 허용',
    'home.viewMap': '지도확인',
    'home.changeLocation': '현재 위치 변경',
    'home.gpsReady': '현재 위치 · {address}',
    'home.gpsPending': 'GPS 위치를 수신하는 중이에요',
    'home.gpsApprox': '접속 지역 · {address}',
    'home.gpsDenied': '위치 권한 없음 · {address}',
    'home.pickupTitle': '출발지 설정',
    'home.pickupChange': '위치를 직접 바꿀 수 있어요',
    'home.pickupReady': '지도에서 핀을 옮기거나 GPS를 다시 받아 출발지를 변경하세요.',
    'home.pickupNeedGps': 'GPS를 가져오지 못해 접속 지역으로 표시하고 있어요. 위치 권한을 허용하거나 지도에서 출발지를 골라 주세요.',
    'home.reaskGps': '위치 권한 다시 요청',
    'home.pickOnMap': '지도에서 출발지 선택',
    'home.activity': '시간별 활동 기록',
    'home.piAccount': '파이 계정 연동',
    'service.taxi': '택시',
    'service.daeri': '대리운전',
    'service.parking': '주차',
    'service.bike': '자전거',
    'service.kick': '킥보드',
    'service.ev': 'EV 충전',
    'service.delivery': '택배',
    'service.more': '더보기',
    'service.open': '{name} 서비스 열기',
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
    'settings.theme': '화면 테마',
    'settings.themeCaption': '밝기 모드를 선택하세요',
    'settings.theme.light': '라이트 모드',
    'settings.theme.lightCaption': '항상 밝은 화면으로 표시',
    'settings.theme.dark': '다크 모드',
    'settings.theme.darkCaption': '항상 어두운 화면으로 표시',
    'settings.theme.auto': '시간대 자동',
    'settings.theme.autoCaption': '야간(19~07시) 다크 · 주간 라이트',
    'settings.themeApplied': '{name} 테마로 변경했어요',
    'home.language': '언어',
    'home.voiceDest': '음성으로 목적지 말하기',
    'voice.title': '음성 입력',
    'voice.listening': '듣고 있어요…',
    'voice.tap': '마이크를 눌러 목적지를 말씀하세요',
    'voice.retry': '다시 듣기',
    'voice.useText': '이 내용으로 검색',
    'voice.unsupported': '이 브라우저는 음성 인식을 지원하지 않아요. 직접 입력해 주세요.',
    'voice.failed': '음성을 인식하지 못했어요. 다시 말씀해 주세요.',
    'voice.langLabel': '말하는 언어',
    'voice.translating': '한국어로 번역 중…',
    'voice.translatedSearch': '검색어 · {q}',
    'recv.titleInsufficient': '잔액이 부족합니다',
    'recv.titleFailed': '결제를 완료하지 못했어요',
    'recv.descInsufficient': 'Pi 지갑 잔액이 부족해 이용 요금이 결제되지 않았습니다.',
    'recv.descFailed': '이용 요금 결제가 완료되지 않았습니다. 취소했거나 네트워크 오류일 수 있어요.',
    'recv.owed': '미수 이용 요금',
    'recv.recorded': '이 건은 미수금으로 기록되어 제공자와 운영자에게 전달되었습니다.',
    'recv.contactTitle': '정산 문의 연락처',
    'recv.provider': '서비스 제공자 · {name}',
    'recv.support': '택시타고 고객센터',
    'recv.manualHint': '계좌이체 등 다른 방법으로 정산하려면 위 연락처로 문의해 주세요.',
    'recv.callSupport': '전화 문의',
    'recv.mailSupport': '메일 문의',
    'recv.retry': '다시 결제하기',
    'recv.penalty': '누적 페널티 {points}점 — 미수금이 쌓이면 셀프 서비스 이용이 제한됩니다.',
    'recv.restricted': '반복 미수로 {until}까지 셀프 서비스 대여가 제한됩니다.',
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
    'more.hub': 'More',
    'more.guide': 'Info · Settings',
    'more.mobility': 'Mobility',
    'more.close': 'Close',
    'nav.all': 'All',
    'nav.partner': 'Driver',
    'nav.home': 'Home',
    'nav.inbox': 'Rides',
    'nav.mypage': 'Me',
    'nav.allCaption': 'See every service and guide in one place.',
    'brand.name': 'TaxiTago',
    'brand.partner': 'Partner',
    'home.pickup': 'Pickup',
    'home.dest': 'Drop-off',
    'home.destPlaceholder': 'Where to?',
    'home.destSearch': 'Search destination',
    'home.callTaxi': 'Call a taxi',
    'home.callDaeri': 'Call a driver',
    'home.whatToUse': 'What do you need?',
    'home.serviceCount': '{count} services',
    'home.recent': 'Recent',
    'home.content': 'Home',
    'home.allowLocation': 'Allow location',
    'home.viewMap': 'Map',
    'home.changeLocation': 'Change location',
    'home.gpsReady': 'Current · {address}',
    'home.gpsPending': 'Getting GPS location…',
    'home.gpsApprox': 'Approx. · {address}',
    'home.gpsDenied': 'No location access · {address}',
    'home.pickupTitle': 'Set pickup',
    'home.pickupChange': 'You can change this location',
    'home.pickupReady': 'Move the pin on the map or refresh GPS to change pickup.',
    'home.pickupNeedGps': 'GPS was unavailable, so your access region is shown. Allow location or pick a spot on the map.',
    'home.reaskGps': 'Request location again',
    'home.pickOnMap': 'Pick pickup on map',
    'home.activity': 'Activity',
    'home.piAccount': 'Pi account',
    'service.taxi': 'Taxi',
    'service.daeri': 'Driver',
    'service.parking': 'Parking',
    'service.bike': 'Bike',
    'service.kick': 'Scooter',
    'service.ev': 'EV charge',
    'service.delivery': 'Delivery',
    'service.more': 'More',
    'service.open': 'Open {name}',
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
    'settings.theme': 'Screen theme',
    'settings.themeCaption': 'Choose a brightness mode',
    'settings.theme.light': 'Light mode',
    'settings.theme.lightCaption': 'Always show a light screen',
    'settings.theme.dark': 'Dark mode',
    'settings.theme.darkCaption': 'Always show a dark screen',
    'settings.theme.auto': 'Auto by time',
    'settings.theme.autoCaption': 'Dark at night (19–07), light by day',
    'settings.themeApplied': 'Switched to {name} theme',
    'home.language': 'Language',
    'home.voiceDest': 'Say your destination',
    'voice.title': 'Voice input',
    'voice.listening': 'Listening…',
    'voice.tap': 'Tap the mic and say your destination',
    'voice.retry': 'Listen again',
    'voice.useText': 'Search with this',
    'voice.unsupported': "This browser doesn't support voice recognition. Please type instead.",
    'voice.failed': "Couldn't recognize speech. Please try again.",
    'voice.langLabel': 'Spoken language',
    'voice.translating': 'Translating to Korean…',
    'voice.translatedSearch': 'Search · {q}',
    'recv.titleInsufficient': 'Insufficient balance',
    'recv.titleFailed': 'Payment not completed',
    'recv.descInsufficient': 'Your Pi wallet balance was too low to pay the usage fee.',
    'recv.descFailed': 'The usage fee payment did not complete. It may have been cancelled or hit a network error.',
    'recv.owed': 'Unpaid usage fee',
    'recv.recorded': 'This was recorded as a receivable and reported to the provider and operator.',
    'recv.contactTitle': 'Settlement contact',
    'recv.provider': 'Service provider · {name}',
    'recv.support': 'TaxiTago support',
    'recv.manualHint': 'To settle another way (e.g. bank transfer), contact us via the details above.',
    'recv.callSupport': 'Call support',
    'recv.mailSupport': 'Email support',
    'recv.retry': 'Pay again',
    'recv.penalty': 'Penalty points {points} — repeated unpaid fees restrict self-service use.',
    'recv.restricted': 'Self-service rental is restricted until {until} due to repeated unpaid fees.',
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
    'more.hub': 'その他',
    'more.guide': '案内 · 設定',
    'more.mobility': '移動サービス',
    'more.close': '閉じる',
    'nav.all': '一覧',
    'nav.partner': 'ドライバー',
    'nav.home': 'ホーム',
    'nav.inbox': '利用',
    'nav.mypage': 'マイ',
    'nav.allCaption': 'すべてのサービスと案内をまとめて確認できます。',
    'brand.name': 'TaxiTago',
    'brand.partner': 'パートナー',
    'home.pickup': '乗車地',
    'home.dest': '目的地',
    'home.destPlaceholder': 'どこへ行きますか？',
    'home.destSearch': '目的地を検索',
    'home.callTaxi': 'タクシーを呼ぶ',
    'home.callDaeri': '代行を呼ぶ',
    'home.whatToUse': '何を利用しますか？',
    'home.serviceCount': '{count}つのサービス',
    'home.recent': '最近の利用',
    'home.content': 'ホーム',
    'home.allowLocation': '位置情報を許可',
    'home.viewMap': '地図',
    'home.changeLocation': '現在地を変更',
    'home.gpsReady': '現在地 · {address}',
    'home.gpsPending': 'GPSを取得しています…',
    'home.gpsApprox': 'おおよその地域 · {address}',
    'home.gpsDenied': '位置情報なし · {address}',
    'home.pickupTitle': '乗車地の設定',
    'home.pickupChange': '位置はいつでも変更できます',
    'home.pickupReady': '地図のピンを動かすか、GPSを再取得して乗車地を変更してください。',
    'home.pickupNeedGps': 'GPSを取得できず、接続地域を表示しています。位置情報を許可するか、地図で選んでください。',
    'home.reaskGps': '位置情報を再リクエスト',
    'home.pickOnMap': '地図で乗車地を選ぶ',
    'home.activity': '利用履歴',
    'home.piAccount': 'Piアカウント',
    'service.taxi': 'タクシー',
    'service.daeri': '代行',
    'service.parking': '駐車',
    'service.bike': '自転車',
    'service.kick': 'キックボード',
    'service.ev': 'EV充電',
    'service.delivery': '配送',
    'service.more': 'その他',
    'service.open': '{name}を開く',
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
    'settings.theme': '画面テーマ',
    'settings.themeCaption': '明るさモードを選択',
    'settings.theme.light': 'ライトモード',
    'settings.theme.lightCaption': '常に明るい画面で表示',
    'settings.theme.dark': 'ダークモード',
    'settings.theme.darkCaption': '常に暗い画面で表示',
    'settings.theme.auto': '時間帯で自動',
    'settings.theme.autoCaption': '夜間(19〜07時)はダーク・昼間はライト',
    'settings.themeApplied': '{name}テーマに変更しました',
    'home.language': '言語',
    'home.voiceDest': '目的地を音声で入力',
    'voice.title': '音声入力',
    'voice.listening': '聞き取り中…',
    'voice.tap': 'マイクを押して目的地を話してください',
    'voice.retry': 'もう一度',
    'voice.useText': 'この内容で検索',
    'voice.unsupported': 'このブラウザは音声認識に対応していません。直接入力してください。',
    'voice.failed': '音声を認識できませんでした。もう一度お話しください。',
    'voice.langLabel': '話す言語',
    'voice.translating': '韓国語に翻訳中…',
    'voice.translatedSearch': '検索 · {q}',
    'recv.titleInsufficient': '残高が不足しています',
    'recv.titleFailed': '決済を完了できませんでした',
    'recv.descInsufficient': 'Piウォレットの残高不足のため利用料金が決済されませんでした。',
    'recv.descFailed': '利用料金の決済が完了しませんでした。キャンセルまたはネットワークエラーの可能性があります。',
    'recv.owed': '未収の利用料金',
    'recv.recorded': 'この件は未収金として記録され、提供者と運営者に通知されました。',
    'recv.contactTitle': '精算のお問い合わせ先',
    'recv.provider': 'サービス提供者 · {name}',
    'recv.support': 'TaxiTago サポート',
    'recv.manualHint': '口座振込など別の方法で精算するには上記の連絡先へお問い合わせください。',
    'recv.callSupport': '電話で問い合わせ',
    'recv.mailSupport': 'メールで問い合わせ',
    'recv.retry': 'もう一度支払う',
    'recv.penalty': 'ペナルティ累計 {points}点 — 未収金が続くとセルフサービスの利用が制限されます。',
    'recv.restricted': '未収金の繰り返しにより{until}までセルフサービスのレンタルが制限されます。',
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
    'more.hub': '更多',
    'more.guide': '指南 · 设置',
    'more.mobility': '出行服务',
    'more.close': '关闭',
    'nav.all': '全部',
    'nav.partner': '司机',
    'nav.home': '首页',
    'nav.inbox': '行程',
    'nav.mypage': '我的',
    'nav.allCaption': '在一处查看全部服务与指南。',
    'brand.name': 'TaxiTago',
    'brand.partner': '合作伙伴',
    'home.pickup': '上车点',
    'home.dest': '目的地',
    'home.destPlaceholder': '去哪里？',
    'home.destSearch': '搜索目的地',
    'home.callTaxi': '呼叫出租车',
    'home.callDaeri': '呼叫代驾',
    'home.whatToUse': '需要什么服务？',
    'home.serviceCount': '{count}项服务',
    'home.recent': '最近使用',
    'home.content': '首页',
    'home.allowLocation': '允许定位',
    'home.viewMap': '地图',
    'home.changeLocation': '更改位置',
    'home.gpsReady': '当前位置 · {address}',
    'home.gpsPending': '正在获取 GPS…',
    'home.gpsApprox': '大致位置 · {address}',
    'home.gpsDenied': '无法定位 · {address}',
    'home.pickupTitle': '设置上车点',
    'home.pickupChange': '可以随时更改位置',
    'home.pickupReady': '在地图上移动图钉，或重新获取 GPS 来更改上车点。',
    'home.pickupNeedGps': '未能获取 GPS，已显示接入地区。请允许定位或在地图上选择。',
    'home.reaskGps': '再次请求定位',
    'home.pickOnMap': '在地图上选择上车点',
    'home.activity': '活动记录',
    'home.piAccount': 'Pi 账户',
    'service.taxi': '出租车',
    'service.daeri': '代驾',
    'service.parking': '停车',
    'service.bike': '自行车',
    'service.kick': '滑板车',
    'service.ev': '充电',
    'service.delivery': '快递',
    'service.more': '更多',
    'service.open': '打开{name}',
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
    'settings.theme': '屏幕主题',
    'settings.themeCaption': '选择亮度模式',
    'settings.theme.light': '浅色模式',
    'settings.theme.lightCaption': '始终显示浅色界面',
    'settings.theme.dark': '深色模式',
    'settings.theme.darkCaption': '始终显示深色界面',
    'settings.theme.auto': '按时段自动',
    'settings.theme.autoCaption': '夜间(19–07点)深色 · 白天浅色',
    'settings.themeApplied': '已切换为{name}主题',
    'home.language': '语言',
    'home.voiceDest': '语音输入目的地',
    'voice.title': '语音输入',
    'voice.listening': '正在聆听…',
    'voice.tap': '点击麦克风说出目的地',
    'voice.retry': '重新聆听',
    'voice.useText': '用此内容搜索',
    'voice.unsupported': '此浏览器不支持语音识别，请手动输入。',
    'voice.failed': '未能识别语音，请重试。',
    'voice.langLabel': '语音语言',
    'voice.translating': '正在翻译成韩语…',
    'voice.translatedSearch': '搜索 · {q}',
    'recv.titleInsufficient': '余额不足',
    'recv.titleFailed': '支付未完成',
    'recv.descInsufficient': 'Pi 钱包余额不足，使用费未能支付。',
    'recv.descFailed': '使用费支付未完成，可能是已取消或网络错误。',
    'recv.owed': '未收使用费',
    'recv.recorded': '该笔款项已记为应收款，并已通知提供者与运营方。',
    'recv.contactTitle': '结算联系方式',
    'recv.provider': '服务提供方 · {name}',
    'recv.support': 'TaxiTago 客服',
    'recv.manualHint': '如需通过银行转账等其他方式结算，请联系上方客服。',
    'recv.callSupport': '电话咨询',
    'recv.mailSupport': '邮件咨询',
    'recv.retry': '重新支付',
    'recv.penalty': '累计罚分 {points} 分 — 持续欠款将限制自助服务的使用。',
    'recv.restricted': '因多次欠款，自助服务租赁将被限制至 {until}。',
  },
} as const

/**
 * messages/*.json — 기기 등록·대여·지갑 같은 공용 UI 문구를 언어별 파일로 관리한다.
 * ko.json의 키가 기준이며 다른 언어 파일은 같은 키를 따라야 한다.
 */
const JSON_MESSAGE_TABLE: Record<AppLocale, Record<string, string>> = {
  ko: koMessages,
  en: enMessages,
  ja: jaMessages,
  zh: zhMessages,
}

export type MessageKey = keyof typeof MESSAGE_TABLE.ko | keyof typeof koMessages

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
  const typedTable = MESSAGE_TABLE[locale] ?? MESSAGE_TABLE.ko
  const jsonTable = JSON_MESSAGE_TABLE[locale] ?? JSON_MESSAGE_TABLE.ko
  let text: string =
    (typedTable as Record<string, string>)[key] ||
    jsonTable[key] ||
    (MESSAGE_TABLE.ko as Record<string, string>)[key] ||
    JSON_MESSAGE_TABLE.ko[key] ||
    key
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

const SERVICE_MESSAGE_KEYS: Record<string, MessageKey> = {
  택시: 'service.taxi',
  대리운전: 'service.daeri',
  주차: 'service.parking',
  자전거: 'service.bike',
  킥보드: 'service.kick',
  'EV 충전': 'service.ev',
  택배: 'service.delivery',
  더보기: 'service.more',
}

export function translateService(locale: AppLocale, label: string) {
  const key = SERVICE_MESSAGE_KEYS[label]
  return key ? translate(locale, key) : label
}

const MOBILITY_STATUS_KEYS: Record<string, MessageKey> = {
  available: 'device.status.available',
  maintenance: 'device.status.maintenance',
  low_battery: 'device.status.low_battery',
  rented: 'device.status.rented',
}

export function translateDeviceStatus(locale: AppLocale, status: string) {
  const key = MOBILITY_STATUS_KEYS[status]
  return key ? translate(locale, key) : status
}

const MOBILITY_KIND_KEYS: Record<string, MessageKey> = {
  자전거: 'device.kind.bicycle',
  bicycle: 'device.kind.bicycle',
  킥보드: 'device.kind.kickboard',
  kickboard: 'device.kind.kickboard',
}

export function translateDeviceKind(locale: AppLocale, kind: string) {
  const key = MOBILITY_KIND_KEYS[kind]
  return key ? translate(locale, key) : kind
}

/**
 * 파트너·기사가 직접 입력한 상호명/주소처럼 DB에 저장되는 자유 텍스트.
 * locale별 필드를 가진 객체면 현재 언어 → ko → 첫 값 순으로 풀고,
 * 평문(기존 데이터)이면 그대로 돌려 하위 호환을 유지한다.
 * 향후 기계번역을 붙일 때도 이 함수만 확장하면 된다.
 */
export type LocalizedText = string | Partial<Record<AppLocale, string>>

export function localizedText(value: LocalizedText | null | undefined, locale: AppLocale): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  const direct = value[locale]?.trim()
  if (direct) return direct
  const ko = value.ko?.trim()
  if (ko) return ko
  for (const item of APP_LOCALES) {
    const text = value[item.id]?.trim()
    if (text) return text
  }
  return ''
}

/** 저장된 자유 텍스트를 현재 locale로 해석한다 — 빈 값이면 fallback을 돌린다. */
export function localizeDynamic(value: LocalizedText | null | undefined, locale: AppLocale, fallback = '') {
  return localizedText(value, locale) || fallback
}
