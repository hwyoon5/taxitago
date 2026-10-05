<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Environment variables

- `PI_ADMIN_WALLET_SECRET` — admin fee-wallet signing seed (S… 56자, 서버 전용). 관리자 '수수료 출금'(`app/api/admin/withdraw/route.ts`)이 이 시드로 Pi 트랜잭션을 서명·전송한다. 시드의 파생 공개키가 등록된 관리자 지갑과 다르면 409, 미등록이면 자동 등록. 구형 `ADMIN_WALLET_SECRET_PHRASE`도 fallback으로 인식. `NEXT_PUBLIC_PI_SANDBOX`(기본 true)가 testnet/mainnet을 결정 — testnet이면 `api.testnet.minepi.com` + `Pi Testnet` passphrase.
- `.env*` 파일은 gitignore 처리되어 있으므로 실제 시드 값은 Vercel Environment Variables 또는 로컬 `.env.local`에만 둔다.
