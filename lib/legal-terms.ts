export type LegalTermId =
  | 'service'
  | 'location'
  | 'efinance'
  | 'operation'
  | 'privacy'
  | 'location-privacy'
  | 'opensource'

import type { AppLocale } from '@/lib/i18n'

export type LegalTermDoc = {
  id: LegalTermId
  title: string
  subtitle: string
  updated: string
  sections: { heading: string; body: string }[]
  /**
   * 검수된 언어별 번역본 — ko 문서가 기준이며, 번역이 준비된 언어·필드만
   * 이곳에 추가하면 localizeLegalTerm이 자동으로 해당 언어를 표시한다.
   */
  translations?: Partial<Record<AppLocale, { title?: string; subtitle?: string; sections?: { heading: string; body: string }[] }>>
}

export const legalTermList: Array<Pick<LegalTermDoc, 'id' | 'title' | 'subtitle'>> = [
  { id: 'service', title: '서비스 이용약관', subtitle: 'TaxiTago 서비스 이용약관' },
  { id: 'location', title: '위치기반서비스 이용약관', subtitle: '위치정보 이용에 관한 약관' },
  { id: 'efinance', title: '전자금융거래 이용약관', subtitle: 'Pi 결제 및 전자금융거래' },
  { id: 'operation', title: '운영정책', subtitle: '호출·정산·제재 운영 기준' },
  { id: 'privacy', title: '개인정보 처리방침', subtitle: '개인정보의 수집과 이용' },
  { id: 'location-privacy', title: '개인(위치)정보 처리방침', subtitle: '위치정보의 처리와 보호' },
  { id: 'opensource', title: '오픈소스 라이선스', subtitle: '사용된 오픈소스 고지' },
]

const docs: Record<LegalTermId, LegalTermDoc> = {
  service: {
    id: 'service',
    title: '서비스 이용약관',
    subtitle: 'TaxiTago 서비스 이용약관',
    updated: '2026.10.11',
    sections: [
      {
        heading: '제1조 (목적)',
        body: '이 약관은 TaxiTago(이하 "회사")가 제공하는 택시 호출, 대리운전, 주차, 마이크로모빌리티 및 관련 부가서비스(이하 "서비스")의 이용 조건과 회사·이용자의 권리·의무를 정합니다.',
      },
      {
        heading: '제2조 (정의)',
        body: '"이용자"는 앱에 접속하여 이 약관에 따라 서비스를 이용하는 회원 및 비회원을 말합니다. "기사·파트너"는 회사와 제휴하여 운송 또는 현장 서비스를 제공하는 자를 말합니다. "Pi"는 서비스 내 정산 수단으로 표시되는 디지털 자산 단위입니다.',
      },
      {
        heading: '제3조 (약관의 효력과 변경)',
        body: '회사는 관련 법령을 위반하지 않는 범위에서 약관을 개정할 수 있습니다. 개정 시 적용일과 내용을 앱 공지사항 또는 알림으로 안내하며, 이용자가 변경 약관에 동의하지 않으면 서비스 이용을 중단할 수 있습니다.',
      },
      {
        heading: '제4조 (서비스의 제공)',
        body: '회사는 출발지·목적지 설정, 요금 안내, 배차 중개, 운행 현황, 결제·영수증, 고객지원 기능을 제공합니다. 기상, 교통, 기사 수급, 통신 장애 등 불가피한 사유로 배차 또는 일부 기능이 지연·제한될 수 있습니다.',
      },
      {
        heading: '제5조 (이용자의 의무)',
        body: '이용자는 정확한 출발지와 목적지를 제공하고, 법령과 운행 안전을 해치는 행위를 해서는 안 됩니다. 계정, Pi 지갑, 결제 정보는 본인이 관리하며 타인에게 양도할 수 없습니다. 허위 호출, 무단 탑승 거부 방해, 폭언·폭행은 이용 제한 사유가 됩니다.',
      },
      {
        heading: '제6조 (요금과 취소)',
        body: '예상 요금은 거리·시간·수요에 따라 달라질 수 있으며, 최종 금액은 운행 완료 또는 약정된 정산 시점에 확정됩니다. 배차 이후 취소 시 운영정책에 따른 취소수수료가 발생할 수 있습니다.',
      },
      {
        heading: '제7조 (통신판매중개자의 지위)',
        body: '회사는 자전거·킥보드 등 마이크로모빌리티 기기를 직접 대여하는 당사자가 아니라, 기기를 등록·공급하는 파트너(기기 공급자)와 이용자를 연결하는 통신판매중개자(플랫폼 중개자)입니다. 기기 대여 계약은 이용자와 해당 기기의 파트너 사이에 성립하며, 대여 요금·이용 조건·기기의 유지·관리는 파트너가 정하고 책임집니다. 회사는 중개 시스템의 제공, 결제·정산 처리, 파트너가 등록한 기기 정보의 표시에 관한 역할을 수행합니다.',
      },
      {
        heading: '제8조 (책임의 제한)',
        body: '회사는 중개 플랫폼으로서 기사·파트너가 제공하는 운송의 안전과 법령 준수에 대한 일차 책임을 해당 제공자에게 둡니다. 자전거·킥보드 등 대여 기기의 결함·정비 불량·고장·도난, 파트너가 등록한 기기 정보(위치·배터리·대여 가능 상태 등)의 부정확, 기기 이용 중 발생한 안전사고·교통사고 및 그로 인한 인적·물적 손해는 대여 계약 당사자인 파트너와 이용자의 책임 영역이며, 회사는 통신판매중개자로서 이에 대한 책임을 지지 않습니다. 다만 회사의 고의 또는 중대한 과실로 이용자에게 손해가 발생한 경우에는 관련 법령에 따라 책임을 집니다.',
      },
      {
        heading: '제9조 (준거법)',
        body: '이 약관은 대한민국 법령을 준거법으로 하며, 분쟁은 민사소송법상 관할 법원에 제기합니다.',
      },
    ],
    translations: {
      en: {
        title: 'Terms of Service',
        subtitle: 'TaxiTago Terms of Service',
        sections: [
          {
            heading: 'Article 1 (Purpose)',
            body: 'These Terms of Service set forth the conditions of use and the rights and obligations of TaxiTago (the "Company") and its users in connection with the taxi-hailing, designated-driver, parking, micromobility, and related ancillary services (the "Services") provided by the Company.',
          },
          {
            heading: 'Article 2 (Definitions)',
            body: '"User" means members and non-members who access the app and use the Services under these Terms. "Driver/Partner" means a person who provides transportation or on-site services in partnership with the Company. "Pi" means the unit of digital asset displayed as the settlement method within the Services.',
          },
          {
            heading: 'Article 3 (Effectiveness and Amendment)',
            body: 'The Company may amend these Terms to the extent permitted by applicable law. Upon amendment, the Company will announce the effective date and the revised content via in-app notice or notification. Users who do not consent to the amended Terms may discontinue use of the Services.',
          },
          {
            heading: 'Article 4 (Provision of Services)',
            body: 'The Company provides origin and destination setting, fare guidance, dispatch brokerage, trip status, payment and receipts, and customer support. Dispatch or certain features may be delayed or limited due to unavoidable circumstances such as weather, traffic, driver availability, or network failures.',
          },
          {
            heading: 'Article 5 (User Obligations)',
            body: 'Users must provide accurate pickup and destination information and must not engage in conduct that violates the law or endangers driving safety. Accounts, Pi wallets, and payment information are managed by the user and may not be transferred to others. Fraudulent hailing, obstruction of boarding, verbal abuse, or assault may result in restricted use.',
          },
          {
            heading: 'Article 6 (Fares and Cancellation)',
            body: 'Estimated fares may vary by distance, time, and demand; the final amount is confirmed upon trip completion or at an agreed settlement point. Cancellation after dispatch may incur a cancellation fee under the Operating Policy.',
          },
          {
            heading: 'Article 7 (Status as an Electronic Commerce Broker)',
            body: 'For micromobility devices such as bicycles and kickboards, the Company is not the direct lessor but an electronic commerce broker (platform intermediary) connecting users with partners (device suppliers) that register and supply devices. The rental agreement is formed between the user and the relevant partner, which determines and is responsible for rental fees, terms of use, and device maintenance. The Company provides the brokerage system, processes payments and settlements, and displays device information registered by partners.',
          },
          {
            heading: 'Article 8 (Limitation of Liability)',
            body: 'As a brokerage platform, the Company places primary responsibility for the safety and legal compliance of transportation provided by drivers and partners on the respective provider. As an electronic commerce broker, the Company is not liable for defects, poor maintenance, malfunction, or theft of rented devices such as bicycles and kickboards; for inaccuracies in device information registered by partners (location, battery, availability, etc.); or for safety or traffic accidents during device use and the resulting personal or property damage, which fall within the responsibility of the parties to the rental agreement. However, the Company is liable under applicable law for damages caused to users by its willful misconduct or gross negligence.',
          },
          {
            heading: 'Article 9 (Governing Law)',
            body: 'These Terms are governed by the laws of the Republic of Korea, and disputes shall be brought before the court of competent jurisdiction under the Civil Procedure Act.',
          },
        ],
      },
    },
  },
  location: {
    id: 'location',
    title: '위치기반서비스 이용약관',
    subtitle: '위치정보 이용에 관한 약관',
    updated: '2026.09.21',
    sections: [
      {
        heading: '제1조 (목적)',
        body: '이 약관은 회사가 위치정보를 활용한 호출, 배차, 경로 안내, 안전 기능 등 위치기반서비스를 제공하기 위한 이용 조건을 정합니다.',
      },
      {
        heading: '제2조 (위치정보의 이용)',
        body: '회사는 출발지 자동 설정, 주변 기사 탐색, 예상 도착 시간 산출, 운행 경로 표시, 긴급 SOS 전달을 위해 단말기의 위치정보를 수집·이용할 수 있습니다. 위치정보는 서비스 제공에 필요한 범위에서만 사용합니다.',
      },
      {
        heading: '제3조 (이용자의 동의와 거부)',
        body: '위치기반서비스는 이용자의 동의를 받은 뒤 제공됩니다. 기기 설정 또는 앱 설정에서 위치 권한을 철회하면 호출·배차 등 일부 기능이 제한될 수 있습니다.',
      },
      {
        heading: '제4조 (보유와 파기)',
        body: '운행 완료 후 정산·분쟁 대응·법령상 보존이 필요한 위치 기록은 관련 법령이 정한 기간 동안 보관하며, 목적이 달성되면 지체 없이 파기합니다. SOS 등 긴급 기록은 운영 대응이 종료된 뒤 내부 기준에 따라 삭제합니다.',
      },
      {
        heading: '제5조 (제3자 제공)',
        body: '배차된 기사·파트너에게는 호출 수행에 필요한 최소 위치(탑승 지점, 목적지)를 제공합니다. 수사기관의 적법한 요청 등 법령에 따른 경우를 제외하고 동의 없이 제3자에게 제공하지 않습니다.',
      },
    ],
    translations: {
      en: {
        title: 'Location-Based Service Terms',
        subtitle: 'Terms on the use of location data',
        sections: [
          {
            heading: 'Article 1 (Purpose)',
            body: 'These Terms set the conditions under which the Company provides location-based services, including hailing, dispatch, route guidance, and safety features that utilize location data.',
          },
          {
            heading: 'Article 2 (Use of Location Data)',
            body: 'The Company may collect and use device location data to automatically set pickup points, search for nearby drivers, compute estimated arrival times, display trip routes, and relay emergency SOS alerts. Location data is used only to the extent necessary to provide the Services.',
          },
          {
            heading: 'Article 3 (Consent and Refusal)',
            body: 'Location-based services are provided only after user consent. Revoking location permission in device or app settings may limit features such as hailing and dispatch.',
          },
          {
            heading: 'Article 4 (Retention and Destruction)',
            body: 'Location records required for settlement, dispute handling, or statutory retention after trip completion are kept for the period prescribed by applicable law and destroyed without delay once the purpose is fulfilled. Emergency records such as SOS alerts are deleted under internal standards after operational handling ends.',
          },
          {
            heading: 'Article 5 (Provision to Third Parties)',
            body: 'The minimum location data required to perform the hail (pickup point and destination) is provided to the assigned driver or partner. Location data is not shared with third parties without consent, except as required by law such as lawful requests by investigative authorities.',
          },
        ],
      },
    },
  },
  efinance: {
    id: 'efinance',
    title: '전자금융거래 이용약관',
    subtitle: 'Pi 결제 및 전자금융거래',
    updated: '2026.09.21',
    sections: [
      {
        heading: '제1조 (목적)',
        body: '이 약관은 이용자가 TaxiTago 앱에서 Pi 지갑을 통해 요금을 결제·충전·정산하는 전자금융거래의 조건을 정합니다.',
      },
      {
        heading: '제2조 (거래의 성립)',
        body: '이용자가 결제 화면에서 금액을 확인하고 Pi 네트워크 승인을 완료하면 전자금융거래가 성립합니다. 네트워크 지연, 잔액 부족, 승인 거절로 거래가 완료되지 않을 수 있습니다.',
      },
      {
        heading: '제3조 (이용 시간)',
        body: '전자금융거래는 연중무휴 제공을 원칙으로 하되, 블록체인 네트워크·결제 대행 시스템 점검 시 일시 중단될 수 있습니다. 중단 시 앱을 통해 안내합니다.',
      },
      {
        heading: '제4조 (오류의 정정)',
        body: '이용자는 거래 내용에 오류가 있음을 알았을 때 고객센터로 정정을 요구할 수 있습니다. 회사는 조사 후 정당한 사유가 있으면 관련 법령과 운영정책에 따라 정산·환급을 처리합니다.',
      },
      {
        heading: '제5조 (거래 기록)',
        body: '회사는 전자금융거래 기록(결제 식별값, 금액, 시각, 대상 서비스)을 전자금융거래법령이 정한 기간 동안 보존합니다. 이용자는 앱의 이용 내역·영수증에서 주요 기록을 확인할 수 있습니다.',
      },
      {
        heading: '제6조 (책임)',
        body: '이용자 본인의 비밀번호·지갑 관리 소홀로 발생한 손해는 이용자에게 책임이 있습니다. 회사 시스템의 중대한 과실로 잘못된 출금·이중 결제가 발생한 경우 회사가 조사 후 정정합니다.',
      },
    ],
    translations: {
      en: {
        title: 'Electronic Finance Terms',
        subtitle: 'Pi payments and electronic financial transactions',
        sections: [
          {
            heading: 'Article 1 (Purpose)',
            body: 'These Terms govern electronic financial transactions in which users pay, top up, and settle fares through a Pi wallet in the TaxiTago app.',
          },
          {
            heading: 'Article 2 (Formation of Transaction)',
            body: 'An electronic financial transaction is formed when the user confirms the amount on the payment screen and completes Pi network approval. A transaction may fail due to network delay, insufficient balance, or declined authorization.',
          },
          {
            heading: 'Article 3 (Service Hours)',
            body: 'Electronic financial transactions are provided year-round in principle but may be temporarily suspended during maintenance of the blockchain network or payment processing systems. Suspensions are announced in the app.',
          },
          {
            heading: 'Article 4 (Error Correction)',
            body: 'A user who becomes aware of an error in a transaction may request correction through customer support. If the claim is justified after investigation, the Company processes settlement or refund in accordance with applicable law and the Operating Policy.',
          },
          {
            heading: 'Article 5 (Transaction Records)',
            body: 'The Company retains electronic financial transaction records (payment identifier, amount, timestamp, and target service) for the period required by the Electronic Financial Transactions Act. Users can review key records in the app\'s trip history and receipts.',
          },
          {
            heading: 'Article 6 (Liability)',
            body: 'Users are liable for damage arising from their own negligent management of passwords or wallets. Where an erroneous withdrawal or duplicate payment is caused by gross negligence of the Company\'s systems, the Company will correct it after investigation.',
          },
        ],
      },
    },
  },
  operation: {
    id: 'operation',
    title: '운영정책',
    subtitle: '호출·정산·제재 운영 기준',
    updated: '2026.09.21',
    sections: [
      {
        heading: '1. 호출과 배차',
        body: '이용자는 정확한 탑승 위치를 지정해야 합니다. 반복적인 허위 호출, 배차 후 무단 취소, 기사 대기 시간 초과 미탑승은 이용 제한 대상이 될 수 있습니다. 기사·파트너는 배정된 호출을 정당한 사유 없이 거부해서는 안 됩니다.',
      },
      {
        heading: '2. 요금·취소 수수료',
        body: '기사 배정 전 취소에는 수수료가 없습니다. 기사 배정 후 이용자가 취소하면 취소 확인 화면에 고지된 취소 수수료(예상 요금의 일정 비율, 최소액 적용 — 현재 기준은 더보기 > 요금 안내와 취소 확인 화면에서 확인할 수 있습니다)가 자동 차감되어 기사에게 지급되고, 잔액은 환불됩니다. 취소 확인 화면에서 [취소 수수료 내고 이용 취소]를 누르면 이 정책에 동의한 것으로 간주됩니다. 기사 사유로 인한 취소에는 수수료가 부과되지 않습니다.',
      },
      {
        heading: '3. 안전과 품위',
        body: '폭언, 성희롱, 폭행, 음주·약물 관련 위험 행위, 반려동물·화물 미고지 등 상대방의 안전을 해치는 행위는 즉시 이용 정지될 수 있습니다. 위급 시 앱의 긴급 SOS와 112 등 공공기관 신고를 함께 이용해 주세요.',
      },
      {
        heading: '4. 평가와 제재',
        body: '운행 후 평가는 서비스 품질 관리에 사용됩니다. 허위 평가, 보복 신고, 법령 위반이 확인되면 경고, 일시 정지, 영구 이용 제한이 단계적으로 적용될 수 있습니다.',
      },
      {
        heading: '5. 고객지원',
        body: '요금 문의, 분실물, 운행 이슈는 더보기 > 고객센터 또는 대표 이메일(grace837100@gmail.com)로 접수합니다. 분실물은 해당 운행 기록을 통해 기사와 연결되며, 회사는 중개 범위에서 협조합니다.',
      },
    ],
    translations: {
      en: {
        title: 'Operating Policy',
        subtitle: 'Dispatch, settlement & sanctions policy',
        sections: [
          {
            heading: '1. Hailing and Dispatch',
            body: 'Users must specify an accurate pickup point. Repeated fraudulent hailing, unauthorized cancellation after dispatch, or failure to board beyond the driver\'s wait time may lead to restricted use. Drivers and partners must not decline assigned requests without just cause.',
          },
          {
            heading: '2. Fares and Cancellation Fees',
            body: 'Cancellation before driver assignment is free. If a user cancels after assignment, the cancellation fee shown on the confirmation screen (a percentage of the estimated fare with a minimum — see More > Fare Guide and the cancellation screen for current standards) is automatically deducted and paid to the driver, and the remainder is refunded. Tapping [Pay cancellation fee and cancel] constitutes consent to this policy. No fee applies to cancellations caused by the driver.',
          },
          {
            heading: '3. Safety and Conduct',
            body: 'Verbal abuse, sexual harassment, assault, alcohol- or drug-related dangerous behavior, or failure to declare pets or cargo may result in immediate suspension. In emergencies, please use the in-app SOS together with public reporting channels (e.g., 112).',
          },
          {
            heading: '4. Ratings and Sanctions',
            body: 'Post-trip ratings are used for service quality management. Verified fraudulent ratings, retaliatory reports, or legal violations may result in graduated sanctions: warning, temporary suspension, or permanent restriction.',
          },
          {
            heading: '5. Customer Support',
            body: 'Fare inquiries, lost items, and trip issues can be filed via More > Customer Support or the primary email (grace837100@gmail.com). Lost items are connected with the driver through the trip record, and the Company assists within the scope of brokerage.',
          },
        ],
      },
    },
  },
  privacy: {
    id: 'privacy',
    title: '개인정보 처리방침',
    subtitle: '개인정보의 수집과 이용',
    updated: '2026.09.21',
    sections: [
      {
        heading: '1. 수집 항목',
        body: '회사는 회원 식별 정보(닉네임, Pi 계정 연결 정보), 이용 기록(출발지·도착지 주소, 시각, 요금), 기기 정보(앱 버전, OS), 고객문의 내용을 수집할 수 있습니다. 결제 승인에 필요한 식별값은 결제 처리 목적에 한정합니다.',
      },
      {
        heading: '2. 이용 목적',
        body: '수집한 정보는 회원 관리, 호출·배차, 요금 정산, 고객지원, 부정 이용 방지, 서비스 개선 통계에 사용합니다. 마케팅 알림은 별도의 동의가 있는 경우에만 발송합니다.',
      },
      {
        heading: '3. 보유 기간',
        body: '회원 탈퇴 시 지체 없이 파기하는 것을 원칙으로 하되, 전자상거래·전자금융·세무 관련 법령에 따른 보존 의무가 있는 기록은 법정 기간 동안 보관합니다.',
      },
      {
        heading: '4. 이용자의 권리',
        body: '이용자는 개인정보 열람, 정정, 삭제, 처리 정지를 고객센터를 통해 요청할 수 있습니다. 회사는 법령이 허용하는 범위에서 지체 없이 조치합니다.',
      },
      {
        heading: '5. 안전조치',
        body: '회사는 접근 권한 제한, 전송 구간 보호, 로그 관리 등 합리적 보호 조치를 시행합니다. 개인정보 보호 관련 문의는 앱 고객센터 또는 대표 이메일(grace837100@gmail.com)로 접수해 주세요.',
      },
    ],
    translations: {
      en: {
        title: 'Privacy Policy',
        subtitle: 'Collection and use of personal data',
        sections: [
          {
            heading: '1. Data Collected',
            body: 'The Company may collect member identification (nickname, linked Pi account), usage records (pickup and drop-off addresses, timestamps, fares), device information (app version, OS), and customer support inquiries. Identifiers required for payment authorization are limited to payment processing purposes.',
          },
          {
            heading: '2. Purposes of Use',
            body: 'Collected information is used for member management, hailing and dispatch, fare settlement, customer support, fraud prevention, and service improvement statistics. Marketing notifications are sent only with separate consent.',
          },
          {
            heading: '3. Retention Period',
            body: 'In principle, personal data is destroyed without delay upon account withdrawal, except for records that must be retained under e-commerce, electronic finance, or tax laws for the statutory period.',
          },
          {
            heading: '4. User Rights',
            body: 'Users may request access, correction, deletion, or suspension of processing of personal data through customer support. The Company acts without delay to the extent permitted by law.',
          },
          {
            heading: '5. Safeguards',
            body: 'The Company implements reasonable protective measures including access controls, transport-layer protection, and log management. Privacy inquiries may be submitted via in-app customer support or the primary email (grace837100@gmail.com).',
          },
        ],
      },
    },
  },
  'location-privacy': {
    id: 'location-privacy',
    title: '개인(위치)정보 처리방침',
    subtitle: '위치정보의 처리와 보호',
    updated: '2026.09.21',
    sections: [
      {
        heading: '1. 처리하는 위치정보',
        body: 'GPS, 네트워크 기반 좌표, 이용자가 지도에서 지정한 출발지·도착지 좌표와 그로부터 변환된 주소, 운행 중 경로 좌표를 처리할 수 있습니다.',
      },
      {
        heading: '2. 처리 목적',
        body: '현재 위치 기반 출발지 설정, 주변 기사 매칭, 예상 요금·ETA 산출, 운행 중 위치 공유, 긴급 SOS 전달, 분쟁 시 경로 확인에 사용합니다.',
      },
      {
        heading: '3. 제공 범위',
        body: '배차된 기사·파트너에게 탑승 지점과 목적지 정보를 제공합니다. 운영 대응 인력에게는 신고·SOS 처리에 필요한 최소 위치만 열람됩니다.',
      },
      {
        heading: '4. 파기',
        body: '실시간 위치는 운행 종료 후 서비스 목적 달성 시 삭제하거나 비식별화합니다. 법령상 보존이 필요한 운행 기록은 해당 기간이 끝나면 파기합니다.',
      },
      {
        heading: '5. 동의 철회',
        body: '위치정보 이용 동의는 앱 설정 또는 단말기 권한에서 철회할 수 있습니다. 철회 이후에도 이미 완료된 운행의 정산·분쟁 기록은 법정 보존 기간 동안 남을 수 있습니다.',
      },
    ],
    translations: {
      en: {
        title: 'Location Privacy Policy',
        subtitle: 'Handling and protection of location data',
        sections: [
          {
            heading: '1. Location Data Processed',
            body: 'The Company may process GPS and network-based coordinates, pickup and drop-off coordinates designated on the map and their derived addresses, and route coordinates during trips.',
          },
          {
            heading: '2. Purposes of Processing',
            body: 'Location data is used for location-based pickup setting, nearby driver matching, fare and ETA computation, real-time trip location sharing, emergency SOS relay, and route verification in disputes.',
          },
          {
            heading: '3. Scope of Disclosure',
            body: 'The assigned driver or partner receives the pickup point and destination. Operational staff may view only the minimum location data needed to handle reports and SOS alerts.',
          },
          {
            heading: '4. Destruction',
            body: 'Real-time location is deleted or de-identified once the service purpose is fulfilled after trip completion. Trip records requiring statutory retention are destroyed when that period ends.',
          },
          {
            heading: '5. Withdrawal of Consent',
            body: 'Consent to location data use may be withdrawn in app settings or device permissions. Settlement and dispute records of completed trips may remain for the statutory retention period after withdrawal.',
          },
        ],
      },
    },
  },
  opensource: {
    id: 'opensource',
    title: '오픈소스 라이선스',
    subtitle: '사용된 오픈소스 고지',
    updated: '2026.09.21',
    sections: [
      {
        heading: '고지',
        body: 'TaxiTago는 아래를 포함한 오픈소스 소프트웨어를 사용합니다. 각 라이선스의 조건은 해당 프로젝트의 고지를 따릅니다.',
      },
      {
        heading: '주요 구성 요소',
        body: 'Next.js (MIT) · React / React DOM (MIT) · lucide-react (ISC) · Tailwind CSS 관련 도구 (MIT) · class-variance-authority (Apache-2.0) · date-fns (MIT) · Sentry SDK (MIT) · Vercel Analytics (해당 패키지 라이선스). 지도 표시에는 네이버 클라우드 플랫폼 Maps 및 대체 타일 제공자의 이용 약관이 적용됩니다.',
      },
      {
        heading: '문의',
        body: '오픈소스 고지 사본이 필요하면 고객센터 1:1 문의 또는 대표 이메일(grace837100@gmail.com)로 요청해 주세요. 회사는 해당 라이선스가 요구하는 범위에서 고지를 유지합니다.',
      },
    ],
    translations: {
      en: {
        title: 'Open Source Licenses',
        subtitle: 'Open source attributions',
        sections: [
          {
            heading: 'Notice',
            body: 'TaxiTago uses open source software including the components below. The terms of each license follow the notices of the respective projects.',
          },
          {
            heading: 'Key Components',
            body: 'Next.js (MIT) · React / React DOM (MIT) · lucide-react (ISC) · Tailwind CSS-related tools (MIT) · class-variance-authority (Apache-2.0) · date-fns (MIT) · Sentry SDK (MIT) · Vercel Analytics (respective package license). Map display is subject to the terms of Naver Cloud Platform Maps and fallback tile providers.',
          },
          {
            heading: 'Inquiries',
            body: 'To request a copy of the open source notices, contact 1:1 support or the primary email (grace837100@gmail.com). The Company maintains attributions to the extent required by each license.',
          },
        ],
      },
    },
  },
}

export function getLegalTerm(id: string | undefined): LegalTermDoc | null {
  if (!id) return null
  return docs[id as LegalTermId] ?? null
}

/**
 * 문서의 번역본이 준비된 필드만 현재 locale로 치환해 돌려준다.
 * 번역이 없으면 원문(ko)을 그대로 돌려 내용이 비는 일이 없다.
 */
export function localizeLegalTerm(doc: LegalTermDoc | null, locale: AppLocale): LegalTermDoc | null {
  if (!doc || locale === 'ko') return doc
  const tr = doc.translations?.[locale]
  if (!tr) return doc
  return {
    ...doc,
    title: tr.title ?? doc.title,
    subtitle: tr.subtitle ?? doc.subtitle,
    sections: tr.sections ?? doc.sections,
  }
}
