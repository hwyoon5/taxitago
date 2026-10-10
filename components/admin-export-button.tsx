'use client'

import { Download } from 'lucide-react'
import { downloadCsvFile, type CsvCell } from '@/lib/export-csv'

/**
 * 관리자 리스트 공용 '엑셀 다운로드' 버튼 — 현재 필터된 전체 목록(페이지 무관)을
 * Excel에서 바로 열리는 UTF-8 CSV로 내려받는다.
 */
export function AdminExportButton({
  filename,
  headers,
  rows,
  disabled,
  className = '',
}: {
  filename: string
  headers: string[]
  rows: CsvCell[][]
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled || !rows.length}
      onClick={() => downloadCsvFile(filename, headers, rows)}
      title="현재 조회된 전체 내역을 엑셀 파일로 내려받습니다"
      className={`flex items-center gap-1 rounded-full bg-[#047857] px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-50 ${className}`}
    >
      <Download size={11} />
      엑셀 다운로드
    </button>
  )
}
