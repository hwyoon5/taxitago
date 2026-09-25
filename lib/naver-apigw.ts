function cleanEnv(value?: string | null) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

function staticEnv(name: string) {
  switch (name) {
    case 'NAVER_MAP_CLIENT_ID':
      return process.env.NAVER_MAP_CLIENT_ID
    case 'NAVER_CLIENT_ID':
      return process.env.NAVER_CLIENT_ID
    case 'NCP_APIGW_API_KEY_ID':
      return process.env.NCP_APIGW_API_KEY_ID
    case 'NCP_KEY_ID':
      return process.env.NCP_KEY_ID
    case 'NAVER_MAP_NCP_KEY_ID':
      return process.env.NAVER_MAP_NCP_KEY_ID
    case 'NEXT_PUBLIC_NAVER_MAP_CLIENT_ID':
      return process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID
    case 'NEXT_PUBLIC_NAVER_MAP_NCP_KEY_ID':
      return process.env.NEXT_PUBLIC_NAVER_MAP_NCP_KEY_ID
    case 'NAVER_MAP_CLIENT_SECRET':
      return process.env.NAVER_MAP_CLIENT_SECRET
    case 'NAVER_CLIENT_SECRET':
      return process.env.NAVER_CLIENT_SECRET
    case 'NCP_APIGW_API_KEY':
      return process.env.NCP_APIGW_API_KEY
    case 'NCP_API_KEY':
      return process.env.NCP_API_KEY
    case 'NAVER_MAP_API_KEY':
      return process.env.NAVER_MAP_API_KEY
    case 'NAVER_API_KEY':
      return process.env.NAVER_API_KEY
    case 'NAVER_SEARCH_CLIENT_ID':
      return process.env.NAVER_SEARCH_CLIENT_ID
    case 'NAVER_OPENAPI_CLIENT_ID':
      return process.env.NAVER_OPENAPI_CLIENT_ID
    case 'NAVER_SEARCH_CLIENT_SECRET':
      return process.env.NAVER_SEARCH_CLIENT_SECRET
    case 'NAVER_OPENAPI_CLIENT_SECRET':
      return process.env.NAVER_OPENAPI_CLIENT_SECRET
    default:
      return ''
  }
}

/** Live server env first, then the static binding so a production build does not drop the key. */
function runtimeEnv(name: string) {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })['process']
  return cleanEnv(proc?.['env']?.[name] || staticEnv(name))
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

const SEARCH_ID_ENVS = ['NAVER_SEARCH_CLIENT_ID', 'NAVER_OPENAPI_CLIENT_ID'] as const
const SEARCH_SECRET_ENVS = ['NAVER_SEARCH_CLIENT_SECRET', 'NAVER_OPENAPI_CLIENT_SECRET'] as const

export function resolveNaverSearchCredentials() {
  return {
    keyId: firstRuntimeEnv(SEARCH_ID_ENVS),
    secret: firstRuntimeEnv(SEARCH_SECRET_ENVS),
  }
}

export function naverRestCredentialPairs() {
  const ids = [...new Set(CLIENT_ID_ENVS.map((name) => runtimeEnv(name)).filter(Boolean))]
  const secrets = [...new Set(CLIENT_SECRET_ENVS.map((name) => runtimeEnv(name)).filter(Boolean))]
  const pairs: Array<{ keyId: string; secret: string }> = []
  for (const keyId of ids) {
    for (const secret of secrets) {
      pairs.push({ keyId, secret })
      if (pairs.length >= 4) return pairs
    }
  }
  return pairs
}

export function naverGatewayHeaderSets() {
  const pairs = naverRestCredentialPairs()
  return pairs.flatMap(({ keyId, secret }) => [
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
  ])
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
