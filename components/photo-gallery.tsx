'use client'

import { useEffect, useState } from 'react'
import { fetchAttachments } from '@/lib/support-client'

type Photo = { id: string; name: string; dataUrl: string }

/** 문의/분실물에 첨부된 사진 썸네일 — 클릭하면 전체 화면으로 확대된다. */
export default function AttachmentGallery({ entityId, photoCount }: { entityId: string; photoCount?: number }) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [zoomed, setZoomed] = useState<Photo | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!photoCount) return
    let live = true
    void fetchAttachments(entityId)
      .then((next) => {
        if (live) setPhotos(next)
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoaded(true)
      })
    return () => {
      live = false
    }
  }, [entityId, photoCount])

  if (!photoCount) return null

  return (
    <div className="mt-3">
      <p className="text-[10px] font-black text-[#64748B]">첨부 사진 {photos.length || photoCount}장</p>
      {photos.length ? (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {photos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setZoomed(photo)}
              className="h-16 w-16 overflow-hidden rounded-xl border-2 border-[#CBD5E1]"
            >
              <img src={photo.dataUrl} alt={photo.name} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : loaded ? (
        <p className="mt-1 text-[10px] font-bold text-[#94A3B8]">첨부된 사진을 불러오지 못했습니다.</p>
      ) : null}
      {zoomed ? (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setZoomed(null)}
        >
          <img src={zoomed.dataUrl} alt={zoomed.name} className="max-h-full max-w-full rounded-2xl object-contain" />
          <button
            type="button"
            onClick={() => setZoomed(null)}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-black text-white"
          >
            ✕
          </button>
        </div>
      ) : null}
    </div>
  )
}
