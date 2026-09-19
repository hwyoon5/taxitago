export type PartnerLinkRecord = {
  uid: string
  username: string
  wallet: string
  role?: string
  name?: string
  linkedAt: string
  updatedAt: string
}

type Store = Map<string, PartnerLinkRecord>

function store(): Store {
  const globalStore = globalThis as typeof globalThis & { __taxitagoPartnerLinks?: Store }
  if (!globalStore.__taxitagoPartnerLinks) {
    globalStore.__taxitagoPartnerLinks = new Map()
  }
  return globalStore.__taxitagoPartnerLinks
}

export function upsertPartnerLink(record: Omit<PartnerLinkRecord, 'updatedAt'>): PartnerLinkRecord {
  const next: PartnerLinkRecord = { ...record, updatedAt: new Date().toISOString() }
  store().set(record.uid, next)
  return next
}

export function getPartnerLink(uid: string) {
  return store().get(uid) ?? null
}
