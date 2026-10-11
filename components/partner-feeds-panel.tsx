'use client'

import { useCallback, useEffect, useState } from 'react'
import { Link2, RefreshCw, Trash2 } from 'lucide-react'
import {
  fetchMyPartnerFeeds,
  registerPartnerFeed,
  deletePartnerFeed,
  updatePartnerFeed,
  syncPartnerFeed,
  type PartnerFeedInfo,
} from '@/lib/mobility-devices'

const feedSyncLabel = (feed: PartnerFeedInfo) => {
  if (feed.lastSyncStatus === 'ok') {
    return { text: `정상 · 기기 ${feed.deviceCount}대${feed.lastSyncAt ? ` · ${feed.lastSyncAt.slice(5, 16).replace('T', ' ')}` : ''}`, cls: 'text-[#047857]' }
  }
  if (feed.lastSyncStatus === 'error') {
    return { text: `동기화 실패${feed.lastError ? ` — ${feed.lastError}` : ''}`, cls: 'text-[#BE123C]' }
  }
  return { text: '첫 동기화 대기 중', cls: 'text-[#64748B]' }
}

/**
 * 외부 파트너 피드 관리 패널 — 파트너(ownerUid)는 본인 소스만,
 * 관리자(adminKey)는 전체 소스를 조회·수정·동기화·삭제한다.
 */
export function PartnerFeedsPanel({
  ownerUid = '',
  adminKey = '',
  onNotice,
}: {
  ownerUid?: string
  /** 관리자 모드 — x-admin-key로 전체 소스를 관리한다. */
  adminKey?: string
  onNotice?: (message: string) => void
}) {
  const uid = ownerUid.trim()
  const admin = Boolean(adminKey)
  const [feeds, setFeeds] = useState<PartnerFeedInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState('')
  const [editing, setEditing] = useState('')
  const [editName, setEditName] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editKey, setEditKey] = useState('')
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formKey, setFormKey] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(() => {
    if (!uid && !admin) return
    void fetchMyPartnerFeeds(uid, adminKey || undefined)
      .then(setFeeds)
      .finally(() => setLoading(false))
  }, [uid, admin, adminKey])

  useEffect(() => {
    reload()
    const timer = window.setInterval(reload, 30_000)
    return () => window.clearInterval(timer)
  }, [reload])

  const notify = (message: string) => onNotice?.(message)

  const submitNew = async () => {
    if (!formName.trim() || !formUrl.trim()) {
      setError('업체 상호명과 API 엔드포인트 URL을 입력해 주세요.')
      return
    }
    setSaving(true)
    setError('')
    const result = await registerPartnerFeed({ name: formName, endpointUrl: formUrl, apiKey: formKey, ownerUid: uid })
    setSaving(false)
    if (!result.ok) {
      setError(result.error || '연동 등록에 실패했습니다.')
      return
    }
    setFormName('')
    setFormUrl('')
    setFormKey('')
    setFormOpen(false)
    notify('외부 연동이 등록되었습니다. 다음 동기화부터 기기가 지도에 표시됩니다.')
    reload()
  }

  const saveEdit = async (feed: PartnerFeedInfo) => {
    setSaving(true)
    setError('')
    const result = await updatePartnerFeed(
      feed.id,
      uid || feed.ownerUid,
      {
        name: editName,
        endpointUrl: editUrl,
        ...(editKey.trim() ? { apiKey: editKey } : {}),
      },
      adminKey || undefined,
    )
    setSaving(false)
    if (!result.ok) {
      setError(result.error || '수정에 실패했습니다.')
      return
    }
    setEditing('')
    setEditKey('')
    notify('연동 정보가 수정되었습니다.')
    reload()
  }

  const toggleEnabled = async (feed: PartnerFeedInfo) => {
    const result = await updatePartnerFeed(feed.id, uid || feed.ownerUid, { enabled: !feed.enabled }, adminKey || undefined)
    if (result.ok) {
      notify(feed.enabled ? `${feed.name} 연동을 중지했어요.` : `${feed.name} 연동을 다시 켰어요.`)
      reload()
    }
  }

  const runSync = async (feed: PartnerFeedInfo) => {
    setSyncing(feed.id)
    const ok = await syncPartnerFeed(feed.id, uid || feed.ownerUid, adminKey || undefined)
    setSyncing('')
    notify(ok ? `${feed.name} 기기 데이터를 동기화했어요.` : '동기화에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    reload()
  }

  const removeFeed = async (feed: PartnerFeedInfo) => {
    if (await deletePartnerFeed(feed.id, uid || feed.ownerUid, adminKey || undefined)) {
      notify(`${feed.name} 연동과 연결된 기기가 정리되었습니다.`)
      setFeeds((list) => list.filter((item) => item.id !== feed.id))
    }
  }

  const inputCls = 'w-full rounded-2xl border-2 border-[#BFDBFE] bg-white px-4 py-2.5 text-xs font-bold outline-none focus:border-[#4A82B8]'

  return (
    <div className="space-y-3">
      {loading ? <p className="py-3 text-center text-xs font-bold text-[#64748B]">연동 목록을 불러오는 중…</p> : null}
      {!loading && !feeds.length ? (
        <p className="rounded-2xl border-2 border-dashed border-[#CBD5E1] p-4 text-center text-xs font-bold leading-5 text-[#64748B]">
          등록된 외부 연동이 없습니다.{!admin ? ' 업체 API 주소를 등록하면 기기 위치가 자동으로 취합됩니다.' : ''}
        </p>
      ) : null}

      {feeds.map((feed) => {
        const sync = feedSyncLabel(feed)
        return (
          <div key={feed.id} className="rounded-2xl border border-[#E2E8F0] bg-white px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-black text-[#0F172A]">
                  <span className="truncate">{feed.name}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${feed.enabled ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#F1F5F9] text-[#64748B]'}`}>
                    {feed.enabled ? '연동 중' : '중지됨'}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-[10px] font-bold text-[#94A3B8]">{feed.endpointUrl}</p>
                {admin ? <p className="mt-0.5 truncate text-[10px] font-bold text-[#94A3B8]">소유자: {feed.ownerUid || '(없음)'}</p> : null}
                <p className={`mt-1.5 text-[11px] font-bold ${sync.cls}`}>{sync.text}</p>
              </div>
              <button type="button" onClick={() => void removeFeed(feed)} className="shrink-0 rounded-full bg-[#FEF2F2] p-2 text-[#BE123C]" aria-label={`${feed.name} 연동 삭제`}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {editing === feed.id ? (
              <div className="mt-3 space-y-2">
                <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="업체 상호명" className={inputCls} />
                <input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} placeholder="API 엔드포인트 URL" className={inputCls} />
                <input value={editKey} onChange={(e) => setEditKey(e.target.value)} placeholder={feed.hasApiKey ? 'API 키 (변경 시에만 입력)' : 'API 키 (선택)'} className={inputCls} />
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setEditing('')} className="rounded-2xl border border-[#CBD5E1] py-2 text-xs font-black text-[#475569]">취소</button>
                  <button type="button" disabled={saving} onClick={() => void saveEdit(feed)} className="rounded-2xl bg-[#4A82B8] py-2 text-xs font-black text-white disabled:opacity-60">
                    {saving ? '저장 중…' : '저장'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={syncing === feed.id}
                  onClick={() => void runSync(feed)}
                  className="flex items-center gap-1 rounded-full border border-[#BFDBFE] px-3 py-1.5 text-[11px] font-black text-[#4A82B8] disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${syncing === feed.id ? 'animate-spin' : ''}`} />
                  {syncing === feed.id ? '동기화 중…' : '지금 동기화'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(feed.id)
                    setEditName(feed.name)
                    setEditUrl(feed.endpointUrl)
                    setEditKey('')
                    setError('')
                  }}
                  className="rounded-full border border-[#E2E8F0] px-3 py-1.5 text-[11px] font-black text-[#475569]"
                >
                  정보 수정
                </button>
                <button
                  type="button"
                  onClick={() => void toggleEnabled(feed)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-black ${feed.enabled ? 'bg-[#0F172A] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
                >
                  {feed.enabled ? '연동 중지' : '연동 재개'}
                </button>
              </div>
            )}
          </div>
        )
      })}

      {error ? <p className="text-xs font-bold text-[#B91C1C]">{error}</p> : null}

      {!admin ? (
        formOpen ? (
          <div className="space-y-2 rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-3">
            <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="업체 상호명 (예: ○○모빌리티)" className={inputCls} />
            <input value={formUrl} onChange={(e) => setFormUrl(e.target.value)} placeholder="API 엔드포인트 URL (https://…/devices)" className={inputCls} />
            <input value={formKey} onChange={(e) => setFormKey(e.target.value)} placeholder="API 키 (선택 — Bearer 인증용)" className={inputCls} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-2xl border border-[#CBD5E1] py-2.5 text-xs font-black text-[#475569]">취소</button>
              <button type="button" disabled={saving} onClick={() => void submitNew()} className="rounded-2xl bg-[#4A82B8] py-2.5 text-xs font-black text-white disabled:opacity-60">
                {saving ? '등록 중…' : '연동 등록'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#BFDBFE] py-3 text-xs font-black text-[#4A82B8]"
          >
            <Link2 className="h-4 w-4" />
            외부 API 연동 추가
          </button>
        )
      ) : null}
    </div>
  )
}
