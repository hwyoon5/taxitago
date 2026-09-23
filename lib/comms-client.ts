import { apiFetch } from '@/lib/app-origin'
import type { ChatMessage, CommsRole, PublicChatRoom, PublicSafeCall } from '@/lib/comms-types'

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

export async function fetchSafeCall(rideId: string, actorId: string, role: CommsRole) {
  const res = await apiFetch(
    `/api/rides/${encodeURIComponent(rideId)}/safe-call?actorId=${encodeURIComponent(actorId)}&role=${role}`,
    { cache: 'no-store' },
  )
  const data = await readJson<{ call?: PublicSafeCall; error?: string }>(res)
  if (!res.ok || !data.call) throw new Error(data.error || '안심번호를 불러오지 못했어요.')
  return data.call
}

export async function startSafeCallSession(rideId: string, actorId: string, role: CommsRole, realPhone?: string) {
  const res = await apiFetch(`/api/rides/${encodeURIComponent(rideId)}/safe-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId, role, action: 'start', realPhone }),
  })
  const data = await readJson<{ call?: PublicSafeCall; error?: string }>(res)
  if (!res.ok || !data.call) throw new Error(data.error || '안심 통화를 시작하지 못했어요.')
  return data.call
}

export async function updateSafeCall(rideId: string, actorId: string, role: CommsRole, action: 'answer' | 'hangup') {
  const res = await apiFetch(`/api/rides/${encodeURIComponent(rideId)}/safe-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId, role, action }),
  })
  const data = await readJson<{ call?: PublicSafeCall; error?: string }>(res)
  if (!res.ok || !data.call) throw new Error(data.error || '통화 상태를 변경하지 못했어요.')
  return data.call
}

export async function fetchChatRoom(rideId: string, actorId: string, role: CommsRole) {
  const res = await apiFetch(
    `/api/rides/${encodeURIComponent(rideId)}/chat?actorId=${encodeURIComponent(actorId)}&role=${role}`,
    { cache: 'no-store' },
  )
  const data = await readJson<{ room?: PublicChatRoom; error?: string }>(res)
  if (!res.ok || !data.room) throw new Error(data.error || '채팅방을 열지 못했어요.')
  return data.room
}

export async function sendChatMessage(rideId: string, actorId: string, role: CommsRole, text: string) {
  const res = await apiFetch(`/api/rides/${encodeURIComponent(rideId)}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId, role, text }),
  })
  const data = await readJson<{ room?: PublicChatRoom; message?: ChatMessage; error?: string }>(res)
  if (!res.ok || !data.room) throw new Error(data.error === 'archived' ? '채팅방이 종료되어 메시지를 보낼 수 없어요.' : data.error || '전송에 실패했어요.')
  return data.room
}
