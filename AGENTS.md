<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Environment variables

- `PI_ADMIN_WALLET_SECRET` — admin fee-wallet signing seed (S… 56자, 서버 전용). 관리자 '수수료 출금'(`app/api/admin/withdraw/route.ts`)이 이 시드로 Pi 트랜잭션을 서명·전송한다. 시드의 파생 공개키가 등록된 관리자 지갑과 다르면 409, 미등록이면 자동 등록. 구형 `ADMIN_WALLET_SECRET_PHRASE`도 fallback으로 인식. `NEXT_PUBLIC_PI_SANDBOX`(기본 true)가 testnet/mainnet을 결정 — testnet이면 `api.testnet.minepi.com` + `Pi Testnet` passphrase.
- Pi 네트워크 분기(`lib/pi-sandbox.ts` `resolvePiSandbox`): 결제 body의 `sandbox` 힌트 → 요청 Host(test.*·localhost·*.vercel.app이면 강제 testnet) → env → 기본 true 순. env 체인은 `NEXT_PUBLIC_PI_SANDBOX` → `NEXT_PUBLIC_NETWORK_MODE` → `PI_SANDBOX` → `PI_NETWORK_MODE`('testnet'/'mainnet' 문자열 인식). 타입화된 `resolveNetworkMode()`는 'testnet' | 'mainnet'을 반환. 서버 라우트에선 `isPiSandboxRequest(request)` 사용. `PI_API_KEY_MAINNET`/`PI_API_KEY_TESTNET`은 네트워크 전용 키 — `sk_live_`/`sk_test_` 접두사가 붙은 공용 키(`PI_API_KEY`, `PI_NETWORK_API_KEY`)는 결정된 네트워크와 다르면 자동 스킵.
- 사전 충전(선불 잔액) 모델은 폐지됨 — 신규 가입 시드 잔액·잔액 충전 화면·입금 크레딧·`/api/wallet/spend`·`/api/pi/charge`·`/api/wallet/deposits` POST는 모두 비활성(410). 모든 서비스 요금은 이용 종료 시점 Pi SDK 직결제(`startPiCheckout`/`PiCheckoutButton` → `/api/pi/approve` → `/api/pi/complete` → 수수료 공제·기사 정산 장부)로 처리된다. 레거시 장부 잔액의 회수용으로 `/api/wallet/withdraw`만 유지하고, `GET /api/wallet/deposits`·`/api/wallet/balance`는 읽기 전용(감사·탈퇴 잔액 검사)으로 남는다. 실제 온체인 잔액은 `lib/pi-balance.ts` `fetchOnchainPiBalance`(Pi 공식 Horizon `/accounts/{wallet}`, `PI_HORIZON_URL` 오버라이드 가능)로만 조회 — 임의 잔액 생성 금지.
- `.env*` 파일은 gitignore 처리되어 있으므로 실제 시드 값은 Vercel Environment Variables 또는 로컬 `.env.local`에만 둔다.
- 관리자 인증은 쿠키가 아니라 `x-admin-key` 헤더 + HMAC 서명된 stateless 토큰 방식(`lib/admin-auth.ts`). 클라이언트는 토큰을 `localStorage['taxitago.admin.key']`에 저장(`lib/admin-key.ts`). 비밀번호·TOTP 시크릿·세션 서명 시크릿은 모두 KV(`taxitago:admin:*`)에만 저장되며 ADMIN_* env는 참조하지 않는다 — DB가 비어 있으면 `/admin/*`이 초기 설정 화면(새 비밀번호 + OTP QR)을 띄운다. KV가 없으면 프로세스 메모리에 저장되어 서버리스 재시작 시 초기화된다. `scripts/reset-admin.ts`로 `taxitago:admin:*` 전체 초기화 가능.
- 채팅 자동 번역(`lib/chat-translate.ts`): provider 체인은 `TRANSLATE_API_URL`(+`TRANSLATE_API_KEY`, LibreTranslate 호환) → NCP Papago(`naveropenapi.apigw.ntruss.com/nmt/v1/translation`, `resolveNaverRestCredentials`의 `NCP_APIGW_API_KEY_ID`/`NCP_APIGW_API_KEY`) → 구형 Papago(`openapi.naver.com/v1/papago/n2mt`, `PAPAGO_CLIENT_ID`/`PAPAGO_CLIENT_SECRET` 또는 네이버 검색 키) 순. 모두 없으면 번역 없이 원문만 표시(기능 자체는 정상 동작). 메시지는 전송 시 3개 언어로 미리 번역되어 `ChatMessage.translations`에 저장되고, 조회 시 `lang` 파라미터로 누락분을 지연 보충한다.
- `NEXT_PUBLIC_PI_API_ORIGIN` — Pi 결제 API(approve/complete/cancel/auth/health/mock-pay) 호출의 절대 오리진. 미설정 시 `https://test.taxitago.co.kr`. 정식 도메인(taxitago.co.kr)·로컬에서는 same-origin을 쓰고, `*.piappengine.com` 등 래퍼/프리뷰 도메인에서 열렸을 때만 이 오리진으로 고정된다 — 상대 경로가 래퍼 서버로 가 승인 요청이 유실되는 것을 막는다. 해당 라우트들은 OPTIONS 프리플라이트 + `Access-Control-Allow-Origin: *`(공개 결제 경로 한정, `lib/pi-payment-handlers.ts` `PI_CORS_HEADERS`)로 cross-origin을 허용한다.
- 결제 승인 만료 디버깅: `GET /api/pi/diagnostics`(`x-admin-key` 필요, `lib/pi-platform.ts` `piPaymentDiagnostics`)가 배포 환경의 결정 네트워크·설정된 Pi 키 env 이름·Pi Payments API 도달성(probe)을 돌려준다. 지갑에서 "개발자가 이 결제를 승인하지 못했습니다"가 뜨면 Vercel 함수 로그의 `[Pi] /api/pi/approve incoming → [Pi] POST .../approve → ok/error(ms 포함)` 체인으로 수신·전송·실패 원인(401=키-앱 불일치, timeout/네트워크=egress 문제)을 구분한다. `builtinFallbackOnly: true`면 env 키가 없어 내장 테스트넷 키만 쓰는 상태 — 해당 앱의 `PI_API_KEY_TESTNET` 설정 필요.

## UI 디자인 가이드

- 보라색 계열(#4C1FB8, #7C3AED, #E0D4FF 등)은 레거시 톤 — 신규 버튼/카드에는 사용을 자제한다.
- 주요 액션 컴포넌트는 헤더 아이콘과 같은 블루 톤(`#4A82B8`, hover `#3F74A8`, shadow `rgba(74,130,184,0.28)`, 보조 배경 `#E8F1FA`)을 기준으로 맞춘다.
