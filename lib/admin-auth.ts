export function adminAccessRequired() {
  return Boolean(process.env.ADMIN_SUPPORT_KEY?.trim())
}

export function isAdminRequest(request: Request) {
  const expected = process.env.ADMIN_SUPPORT_KEY?.trim()
  if (!expected) return true
  const header = request.headers.get('x-admin-key')?.trim()
  const query = new URL(request.url).searchParams.get('key')?.trim()
  const provided = header || query || ''
  return provided === expected
}
