function cleanEnv(value?: string | null) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

/** Bracket access so Next does not inline an empty build-time value. */
function runtimeEnv(name: string) {
  return cleanEnv(process.env[name])
}

const CLIENT_ID_ENVS = [
  'NAVER_MAP_CLIENT_ID',
  'NAVER_CLIENT_ID',
  'NCP_APIGW_API_KEY_ID',
  'NCP_KEY_ID',
  'NAVER_MAP_NCP_KEY_ID',
  'NEXT_PUBLIC_NAVER_MAP_CLIENT_ID',
  'NEXT_PUBLIC_NAVER_MAP_NCP_KEY_ID',
] as const

const CLIENT_SECRET_ENVS = [
  'NAVER_MAP_CLIENT_SECRET',
  'NAVER_CLIENT_SECRET',
  'NCP_APIGW_API_KEY',
  'NCP_API_KEY',
  'NAVER_MAP_API_KEY',
  'NAVER_API_KEY',
] as const

function firstRuntimeEnv(names: readonly string[]) {
  for (const name of names) {
    const value = runtimeEnv(name)
    if (value) return value
  }
  return ''
}

export function resolveNaverRestCredentials() {
  return {
    keyId: firstRuntimeEnv(CLIENT_ID_ENVS),
    secret: firstRuntimeEnv(CLIENT_SECRET_ENVS),
  }
}

const SEARCH_ID_ENVS = ['NAVER_SEARCH_CLIENT_ID', 'NAVER_OPENAPI_CLIENT_ID', ...CLIENT_ID_ENVS] as const
const SEARCH_SECRET_ENVS = ['NAVER_SEARCH_CLIENT_SECRET', 'NAVER_OPENAPI_CLIENT_SECRET', ...CLIENT_SECRET_ENVS] as const

export function resolveNaverSearchCredentials() {
  return {
    keyId: firstRuntimeEnv(SEARCH_ID_ENVS),
    secret: firstRuntimeEnv(SEARCH_SECRET_ENVS),
  }
}

export function naverGatewayHeaderSets() {
  const { keyId, secret } = resolveNaverRestCredentials()
  if (!keyId || !secret) return [] as Record<string, string>[]
  return [
    {
      Accept: 'application/json',
      'X-NCP-APIGW-API-KEY-ID': keyId,
      'X-NCP-APIGW-API-KEY': secret,
    },
    {
      Accept: 'application/json',
      'x-ncp-apigw-api-key-id': keyId,
      'x-ncp-apigw-api-key': secret,
    },
  ]
}

export function naverGatewayHeaders() {
  const { keyId, secret } = resolveNaverRestCredentials()
  const headers = naverGatewayHeaderSets()[0] || null
  return { keyId, secret, headers }
}

export async function ncpGetJson(urlString: string, headers: Record<string, string>, timeoutMs: number) {
  const endpoint = new URL(urlString)
  if (endpoint.protocol !== 'https:') {
    throw new Error('naver api requires https')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await Promise.race([
      fetch(endpoint.href, {
        method: 'GET',
        headers,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
        signal: controller.signal,
      }),
      new Promise<Response>((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), timeoutMs)
      }),
    ])
    const json = await response.json().catch(() => null)
    return { status: response.status, json }
  } finally {
    clearTimeout(timer)
  }
}
