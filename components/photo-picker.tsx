'use client'

import { useRef, useState } from 'react'
import type { PhotoUpload } from '@/lib/support-client'

const MAX_PHOTOS = 5
const MAX_DIM = 1280
const JPEG_QUALITY = 0.78

type Props = {
  photos: PhotoUpload[]
  onChange: (photos: PhotoUpload[]) => void
  max?: number
}

/** 이미지를 최대 1280px JPEG로 축소한 dataURL로 변환 — 서버리스 요청 본문 제한(약 4.5MB) 안에 들어가도록 한다. */
function compressImage(file: File): Promise<PhotoUpload | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
        resolve({ name: file.name || 'photo.jpg', mime: 'image/jpeg', dataUrl })
      }
      img.onerror = () => resolve(null)
      img.src = String(reader.result)
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

/** 문의·분실물 접수용 사진 첨부 — 미리보기 썸네일, 개별 삭제, 최대 5장. */
export default function PhotoPicker({ photos, onChange, max = MAX_PHOTOS }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pick = async (files: FileList | null) => {
    if (!files?.length) return
    setError('')
    const room = max - photos.length
    if (room <= 0) {
      setError(`사진은 최대 ${max}장까지 첨부할 수 있습니다.`)
      return
    }
    setBusy(true)
    const next: PhotoUpload[] = []
    for (const file of Array.from(files).slice(0, room)) {
      if (!file.type.startsWith('image/')) continue
      const compressed = await compressImage(file)
      if (compressed) next.push(compressed)
    }
    if (!next.length) setError('이미지 파일만 첨부할 수 있습니다.')
    else onChange([...photos, ...next])
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="mt-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => void pick(event.target.files)}
      />
      <div className="flex flex-wrap gap-2">
        {photos.map((photo, index) => (
          <div key={index} className="relative h-16 w-16 overflow-hidden rounded-xl border-2 border-[#CBD5E1]">
            <img src={photo.dataUrl} alt={photo.name} className="h-full w-full object-cover" />
            <button
              type="button"
              aria-label="사진 삭제"
              onClick={() => onChange(photos.filter((_, i) => i !== index))}
              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#0F172A]/70 text-[10px] font-black text-white"
            >
              ✕
            </button>
          </div>
        ))}
        {photos.length < max ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="flex h-16 w-16 flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#CBD5E1] text-[#64748B] disabled:opacity-50"
          >
            <span className="text-lg font-black leading-4">+</span>
            <span className="mt-0.5 text-[9px] font-black">{busy ? '처리 중' : '사진'}</span>
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-[10px] font-bold text-[#94A3B8]">사진은 최대 {max}장까지 첨부할 수 있습니다. ({photos.length}/{max})</p>
      {error ? <p className="mt-1 text-[10px] font-black text-[#DC2626]">{error}</p> : null}
    </div>
  )
}
