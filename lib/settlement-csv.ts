import type { SettlementEntry, SettlementService } from '@/lib/settlement-types'
import type { AuditEntry } from '@/lib/audit-store'

const SERVICE_LABEL: Record<SettlementService, string> = {
  taxi: '택시',
  daeri: '대리운전',
  delivery: '택배',
  bicycle: '자전거',
  kickboard: '킥보드',
  ev: 'EV충전',
  parking: '주차',
}

const AUDIT_LABEL: Record<string, string> = {
  rates: '수수료율 변경',
  fare: '요금·수수료 설정',
  settle: '정산 처리',
  'settle-all': '일괄 정산',
  adjust: '수동 보정',
  reconcile: '내역 동기화',
}

const cell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const row = (values: unknown[]) => values.map(cell).join(',')

const stamp = (iso: string | undefined) => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

const pi = (value: number) => Number.isFinite(value) ? value.toFixed(7) : ''

function auditTrailFor(entry: SettlementEntry, audit: AuditEntry[]) {
  return audit
    .filter((log) => log.entryId === entry.id || (log.refId && log.refId === entry.refId))
    .map((log) => `${stamp(log.createdAt)} [${AUDIT_LABEL[log.kind] || log.kind}]${log.reason ? ` 사유:${log.reason}` : ''}${log.detail ? ` ${log.detail}` : ''}`)
    .join(' | ')
}

/**
 * Builds the admin ledger workbook as a single CSV text (caller adds the BOM).
 * Section 1: settlement rows with a per-entry adjustment-history column.
 * Section 2: the raw audit log so global actions (rate changes, bulk settle)
 * are preserved even when they are not bound to one ledger row.
 */
export function buildSettlementCsv(entries: SettlementEntry[], audit: AuditEntry[]) {
  const lines: string[] = []
  lines.push(row(['정산 ID', '운행/결제 참조', '서비스', '승객 ID', '기사 ID', '기사명', '내용', '결제 금액(Pi)', '수수료율(%)', '플랫폼 수수료(Pi)', '기사 순지급(Pi)', '기사 지갑', '관리자 지갑', '정산 상태', '생성 일시', '정산 완료 일시', '조정 이력']))
  for (const entry of entries) {
    lines.push(row([
      entry.id,
      entry.refId,
      SERVICE_LABEL[entry.service] || entry.service,
      entry.passengerId || '',
      entry.driverId,
      entry.driverName,
      entry.memo,
      pi(entry.gross),
      entry.rate,
      pi(entry.commission),
      pi(entry.net),
      entry.driverWallet || '',
      entry.adminWallet || '',
      entry.status === 'settled' ? '정산 완료' : '정산 대기',
      stamp(entry.createdAt),
      stamp(entry.settledAt),
      auditTrailFor(entry, audit),
    ]))
  }
  lines.push('')
  lines.push(row(['[감사 로그] 일시', '종류', '대상 정산 ID', '참조', '사유', '내용', '변경 전', '변경 후']))
  for (const log of audit) {
    lines.push(row([
      stamp(log.createdAt),
      AUDIT_LABEL[log.kind] || log.kind,
      log.entryId || '',
      log.refId || '',
      log.reason || '',
      log.detail || '',
      log.before === undefined ? '' : JSON.stringify(log.before),
      log.after === undefined ? '' : JSON.stringify(log.after),
    ]))
  }
  return lines.join('\r\n')
}
