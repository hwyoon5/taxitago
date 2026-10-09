/**
 * Vercel KV(Upstash REST)의 관리자 인증 데이터를 강제 초기화한다.
 * 삭제 대상: taxitago:admin:* (비밀번호 hash, 세션 버전, 세션 서명 시크릿, 활성 세션)
 * 실행: node scripts/reset-admin-auth.mjs
 * 자격 증명은 .env.production.local → .env.local 순으로 읽는다.
 */
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url)).replace(/[/\\]scripts$/, '') || process.cwd()
const KEY_PATTERN = 'taxitago:admin:*'

function loadEnvFile(file) {
  const env = {}
  if (!existsSync(file)) return env
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match || match[1].startsWith('#')) continue
    env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return env
}

const fileEnv = {
  ...loadEnvFile(path.join(root, '.env.production.local')),
  ...loadEnvFile(path.join(root, '.env.local')),
}
const pick = (name) => (process.env[name] || fileEnv[name] || '').trim()

const kvUrl = (pick('KV_REST_API_URL') || pick('UPSTASH_REDIS_REST_URL')).replace(/\/+$/, '')
const kvToken = pick('KV_REST_API_TOKEN') || pick('UPSTASH_REDIS_REST_TOKEN')

if (!kvUrl || !kvToken) {
  console.error('KV_REST_API_URL / KV_REST_API_TOKEN 을 찾지 못했습니다.')
  process.exit(1)
}

async function kv(command) {
  const res = await fetch(kvUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })
  if (!res.ok) throw new Error(`kv request failed: ${res.status} ${await res.text().catch(() => '')}`)
  const data = await res.json()
  return data.result
}

async function scanAll(pattern) {
  const keys = []
  let cursor = '0'
  do {
    const result = await kv(['SCAN', cursor, 'MATCH', pattern, 'COUNT', 200])
    cursor = String(result?.[0] ?? '0')
    keys.push(...(result?.[1] ?? []))
  } while (cursor !== '0')
  return keys
}

const keys = await scanAll(KEY_PATTERN)
if (!keys.length) {
  console.log(`삭제할 키가 없습니다 (${KEY_PATTERN}).`)
  process.exit(0)
}

console.log('삭제 대상 키:')
for (const key of keys) console.log(`  - ${key}`)

const deleted = await kv(['DEL', ...keys])
console.log(`\n${deleted}개 키 삭제 완료. 관리자 비밀번호/세션이 초기화되었습니다.`)
console.log('참고: ADMIN_PASSWORD* / ADMIN_TOTP_SECRET 등 env 기반 값은 KV 삭제로 초기화되지 않습니다.')
