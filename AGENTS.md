<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Environment variables

- `PI_ADMIN_WALLET_SECRET` — admin fee-wallet signing seed (S… 56자, 서버 전용). 관리자 '수수료 출금'(`app/api/admin/withdraw/route.ts`)이 이 시드로 Pi 트랜잭션을 서명·전송한다. 시드의 파생 공개키가 등록된 관리자 지갑과 다르면 409, 미등록이면 자동 등록. 구형 `ADMIN_WALLET_SECRET_PHRASE`도 fallback으로 인식. `NEXT_PUBLIC_PI_SANDBOX`(기본 true)가 testnet/mainnet을 결정 — testnet이면 `api.testnet.minepi.com` + `Pi Testnet` passphrase.
- Pi 네트워크 분기(`lib/pi-sandbox.ts` `resolvePiSandbox`): 결제 body의 `sandbox` 힌트 → 요청 Host(test.*·localhost·*.vercel.app이면 강제 testnet) → env → 기본 true 순. 서버 라우트에선 `isPiSandboxRequest(request)` 사용. `PI_API_KEY_MAINNET`/`PI_API_KEY_TESTNET`은 네트워크 전용 키 — `sk_live_`/`sk_test_` 접두사가 붙은 공용 키(`PI_API_KEY`, `PI_NETWORK_API_KEY`)는 결정된 네트워크와 다르면 자동 스킵.
- `.env*` 파일은 gitignore 처리되어 있으므로 실제 시드 값은 Vercel Environment Variables 또는 로컬 `.env.local`에만 둔다.
- 관리자 인증은 쿠키가 아니라 `x-admin-key` 헤더 + HMAC 서명된 stateless 토큰 방식(`lib/admin-auth.ts`). 클라이언트는 토큰을 `localStorage['taxitago.admin.key']`에 저장(`lib/admin-key.ts`). `KV_REST_API_URL`/`KV_REST_API_TOKEN`(Upstash)이 있으면 로그아웃·버전 무효화를 위한 세션 레코드와 서명 시크릿을 KV에 영속한다. `ADMIN_SESSION_SECRET`(없으면 `ADMIN_PASSWORD_HASH`/`ADMIN_PASSWORD`/`ADMIN_SUPPORT_KEY`/`ADMIN_TOTP_SECRET` fallback)이 서명 키 — 프로덕션에서 이들 중 하나도 없고 KV도 없으면 프로세스 랜덤 시크릿이라 인스턴스/콜드스타트 간 세션이 끊긴다.
