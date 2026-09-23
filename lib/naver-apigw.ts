function cleanEnv(value?: string | null) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

export function resolveNaverRestCredentials() {
  const keyId = cleanEnv(
    process.env.NAVER_MAP_CLIENT_ID ||
      process.env.NAVER_CLIENT_ID ||
      process.env.NCP_APIGW_API_KEY_ID ||
      process.env.NCP_KEY_ID ||
      process.env.NAVER_MAP_NCP_KEY_ID ||
      process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID ||
      process.env.NEXT_PUBLIC_NAVER_MAP_NCP_KEY_ID,
  )
  const secret = cleanEnv(
    process.env.NAVER_MAP_CLIENT_SECRET ||
      process.env.NAVER_CLIENT_SECRET ||
      process.env.NCP_APIGW_API_KEY ||
      process.env.NCP_API_KEY ||
      process.env.NAVER_MAP_API_KEY ||
      process.env.NAVER_API_KEY,
  )
  return { keyId, secret }
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
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await Promise.race([
      fetch(urlString, {
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
