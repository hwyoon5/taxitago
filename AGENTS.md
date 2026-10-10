<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Environment variables

- `PI_ADMIN_WALLET_SECRET` — admin fee-wallet signing seed (S… 56자, 서버 전용). 관리자 '수수료 출금'(`app/api/admin/withdraw/route.ts`)이 이 시드로 Pi 트랜잭션을 서명·전송한다. 시드의 파생 공개키가 등록된 관리자 지갑과 다르면 409, 미등록이면 자동 등록. 구형 `ADMIN_WALLET_SECRET_PHRASE`도 fallback으로 인식. `NEXT_PUBLIC_PI_SANDBOX`(기본 true)가 testnet/mainnet을 결정 — testnet이면 `api.testnet.minepi.com` + `Pi Testnet` passphrase.
- Pi 네트워크 분기(`lib/pi-sandbox.ts` `resolvePiSandbox`): 결제 body의 `sandbox` 힌트 → 요청 Host(test.*·localhost·*.vercel.app이면 강제 testnet) → env → 기본 true 순. env 체인은 `NEXT_PUBLIC_PI_SANDBOX` → `NEXT_PUBLIC_NETWORK_MODE` → `PI_SANDBOX` → `PI_NETWORK_MODE`('testnet'/'mainnet' 문자열 인식). 타입화된 `resolveNetworkMode()`는 'testnet' | 'mainnet'을 반환. 서버 라우트에선 `isPiSandboxRequest(request)` 사용. `PI_API_KEY_MAINNET`/`PI_API_KEY_TESTNET`은 네트워크 전용 키 — `sk_live_`/`sk_test_` 접두사가 붙은 공용 키(`PI_API_KEY`, `PI_NETWORK_API_KEY`)는 결정된 네트워크와 다르면 자동 스킵.
- 신규 가입 가상 잔액(18.4 Pi 시드, `components/home-screen.tsx` `SIGNUP_WALLET_SEED`)은 테스트넷에서만 지급 — 메인넷이면 0으로 시작하고 과거 시드 서명 저장본도 0으로 리셋. 실제 온체인 잔액은 `lib/pi-balance.ts` `fetchOnchainPiBalance`(Pi 공식 Horizon `/accounts/{wallet}`, `PI_HORIZON_URL` 오버라이드 가능)와 `GET /api/wallet/balance?wallet=`이 제공 — 메인넷에서 임의 잔액 생성 금지.
- `.env*` 파일은 gitignore 처리되어 있으므로 실제 시드 값은 Vercel Environment Variables 또는 로컬 `.env.local`에만 둔다.
- 관리자 인증은 쿠키가 아니라 `x-admin-key` 헤더 + HMAC 서명된 stateless 토큰 방식(`lib/admin-auth.ts`). 클라이언트는 토큰을 `localStorage['taxitago.admin.key']`에 저장(`lib/admin-key.ts`). 비밀번호·TOTP 시크릿·세션 서명 시크릿은 모두 KV(`taxitago:admin:*`)에만 저장되며 ADMIN_* env는 참조하지 않는다 — DB가 비어 있으면 `/admin/*`이 초기 설정 화면(새 비밀번호 + OTP QR)을 띄운다. KV가 없으면 프로세스 메모리에 저장되어 서버리스 재시작 시 초기화된다. `scripts/reset-admin.ts`로 `taxitago:admin:*` 전체 초기화 가능.

## UI 디자인 가이드

- 보라색 계열(#4C1FB8, #7C3AED, #E0D4FF 등)은 레거시 톤 — 신규 버튼/카드에는 사용을 자제한다.
- 주요 액션 컴포넌트는 헤더 아이콘과 같은 블루 톤(`#4A82B8`, hover `#3F74A8`, shadow `rgba(74,130,184,0.28)`, 보조 배경 `#E8F1FA`)을 기준으로 맞춘다.
