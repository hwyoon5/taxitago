/**
 * Upstash Redis의 관리자 인증 데이터를 완전 삭제한다.
 * 대상: taxitago:admin:* (비밀번호 hash, 버전, 세션 시크릿, 활성 세션, 지갑/출금 레코드)
 * 실행: node scripts/reset-admin.ts   (Node >= 22.18 — 타입 스트리핑 내장)
 * 자격 증명: process.env → .env.production.local → .env.local 순
 */
import { Redis } from '@upstash/redis'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

const KEY_PATTERN = 'taxitago:admin:*'
const VERIFY_PATTERN = '*admin*'

function loadEnvFile(file: string): Record<string, string> {
  const env: Record<string, string> = {}
  if (!existsSync(file)) return env
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match || match[1].startsWith('#')) continue
    env[match[1]] = match[2].trim().replace(/^['"]|['"],?$/g, '')
  }
  return env
}

const fileEnv = {
  ...loadEnvFile(path.join(process.cwd(), '.env.production.local')),
  ...loadEnvFile(path.join(process.cwd(), '.env.local')),
}
const pick = (name: string) => (process.env[name] || fileEnv[name] || '').trim()

const url = pick('KV_REST_API_URL') || pick('UPSTASH_REDIS_REST_URL')
const token = pick('KV_REST_API_TOKEN') || pick('UPSTASH_REDIS_REST_TOKEN')
if (!url || !token) {
  console.error('KV_REST_API_URL / KV_REST_API_TOKEN 을 찾지 못했습니다.')
  process.exit(1)
}

const redis = new Redis({ url, token })

async function scanAll(match: string): Promise<string[]> {
  const keys: string[] = []
  let cursor = 0
  do {
    const [next, found] = await redis.scan(cursor, { match, count: 500 })
    cursor = Number(next)
    keys.push(...(found as string[]))
  } while (cursor !== 0)
  return keys
}

async function main() {
  const targets = await scanAll(KEY_PATTERN)
  if (targets.length) {
    console.log('삭제 대상 키:')
    for (const key of targets) console.log(`  - ${key}`)
    const deleted = await redis.del(...targets)
    console.log(`\nDEL 결과: ${deleted}개 삭제됨`)
  } else {
    console.log(`삭제할 키가 없습니다 (${KEY_PATTERN}).`)
  }

  const leftovers = await scanAll(VERIFY_PATTERN)
  if (leftovers.length) {
    console.log('주의 — admin 관련 잔여 키:')
    for (const key of leftovers) console.log(`  - ${key}`)
  } else {
    console.log('검증 완료: admin 관련 키가 데이터베이스에 남아있지 않습니다.')
  }
  console.log('참고: ADMIN_PASSWORD* / ADMIN_TOTP_SECRET 등 env 기반 값은 삭제되지 않습니다.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
