'use client'

export type CsvCell = string | number | null | undefined

/**
 * 관리자 리스트 공용 엑셀 내보내기 — UTF-8 BOM 포함 CSV를 즉시 다운로드한다.
 * BOM을 붙이면 Excel이 한글을 깨지지 않고 열고, 셀은 항상 따옴표로 감싸
 * 쉼표·줄바꿈·따옴표가 섞인 주소/메모도 안전하다.
 */
export function downloadCsvFile(filename: string, headers: string[], rows: CsvCell[][]) {
  const esc = (cell: CsvCell) => `"${String(cell ?? '').replace(/"/g, '""')}"`
  const lines = [headers, ...rows].map((row) => row.map(esc).join(','))
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  anchor.href = url
  anchor.download = `${filename}-${stamp}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
