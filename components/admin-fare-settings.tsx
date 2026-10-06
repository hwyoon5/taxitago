'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import { DEFAULT_RATES, type CommissionRates, type SettlementService } from '@/lib/settlement-types'
import { DEFAULT_FARE_CONFIG, FLAT_SERVICE_LABEL, type FareConfig, type FlatServiceId } from '@/lib/fare-config'
import { isPiWalletAddress, piWalletError, PLATFORM_DEPOSIT_WALLET } from '@/lib/pi-wallet'
import type { DepositEntry } from '@/lib/deposit-store'

const SERVICES: SettlementService[] = ['taxi', 'daeri', 'delivery', 'bicycle', 'kickboard', 'ev', 'parking']
const SERVICE_LABEL: Record<SettlementService, string> = {
  taxi: '택시',
  daeri: '대리운전',
  delivery: '택배',
  bicycle: '자전거',
  kickboard: '킥보드',
  ev: 'EV충전',
  parking: '주차',
}

export default function AdminFareSettings() {
  const [wallet, setWallet] = useState(PLATFORM_DEPOSIT_WALLET)
  const [walletDraft, setWalletDraft] = useState(PLATFORM_DEPOSIT_WALLET)
  const [rates, setRates] = useState<CommissionRates>({ ...DEFAULT_RATES })
  const [rateDraft, setRateDraft] = useState<CommissionRates>({ ...DEFAULT_RATES })
  const [fare, setFare] = useState<FareConfig>(DEFAULT_FARE_CONFIG)
  const [fareDraft, setFareDraft] = useState<FareConfig>(DEFAULT_FARE_CONFIG)
  const [deposits, setDeposits] = useState<DepositEntry[]>([])
  const [depositTotal, setDepositTotal] = useState<{ count: number; total: number } | null>(null)
  const [depositDraft, setDepositDraft] = useState({ txid: '', fromWallet: '', amount: '', memo: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const tell = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  const reload = useCallback(() => {
    void fetch('/api/admin/settlements', { headers: adminHeaders(), cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error || 'load_failed')
        return data as { rates: CommissionRates; fare?: FareConfig; adminWallet?: string; deposits?: DepositEntry[]; depositTotal?: { count: number; total: number } }
      })
      .then((data) => {
        setDeposits(data.deposits ?? [])
        setDepositTotal(data.depositTotal ?? null)
        if (typeof data.adminWallet === 'string' && data.adminWallet) {
          setWallet(data.adminWallet)
          setWalletDraft(data.adminWallet)
        }
        setRates(data.rates)
        setRateDraft(data.rates)
        if (data.fare) {
          setFare(data.fare)
          setFareDraft(data.fare)
        }
        setError('')
      })
      .catch(() => setError('설정을 불러오지 못했습니다.'))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const patch = (body: Record<string, unknown>) =>
    fetch('/api/admin/settlements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(body),
    }).then(async (res) => {
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'failed')
      return data
    })

  const saveWallet = () => {
    if (busy) return
    const address = walletDraft.trim()
    if (!isPiWalletAddress(address)) return
    setBusy(true)
    void patch({ action: 'wallet', wallet: address })
      .then(() => {
        setWallet(address)
        tell('관리자 Pi 지갑 주소가 안전하게 저장되었습니다.')
      })
      .catch((err) => setError(err instanceof Error && err.message !== 'failed' ? err.message : '지갑 주소 저장에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const addDeposit = () => {
    if (busy) return
    const txid = depositDraft.txid.trim()
    const fromWallet = depositDraft.fromWallet.trim()
    const amount = Number(depositDraft.amount)
    if (!txid || !fromWallet || !Number.isFinite(amount) || amount <= 0) return
    setBusy(true)
    void patch({ action: 'deposit', txid, fromWallet, amount, memo: depositDraft.memo.trim() })
      .then(() => {
        setDepositDraft({ txid: '', fromWallet: '', amount: '', memo: '' })
        tell('테스트넷 입금이 장부에 기록되었습니다.')
        reload()
      })
      .catch((err) => setError(err instanceof Error && err.message !== 'failed' ? err.message : '입금 기록에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const saveRates = () => {
    if (busy) return
    setBusy(true)
    void patch({ action: 'rates', rates: rateDraft })
      .then(() => {
        setRates(rateDraft)
        tell('수수료율을 저장했습니다. 이후 정산부터 적용됩니다.')
        reload()
      })
      .catch(() => setError('수수료율 저장에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const saveFare = () => {
    if (busy) return
    setBusy(true)
    void patch({ action: 'fare', fare: fareDraft })
      .then(() => {
        setFare(fareDraft)
        tell('요금·수수료 설정을 저장했습니다. 이후 호출부터 적용됩니다.')
        reload()
      })
      .catch(() => setError('요금 설정 저장에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const ratesDirty = SERVICES.some((service) => rateDraft[service] !== rates[service])
  const fareDirty = JSON.stringify(fareDraft) !== JSON.stringify(fare)

  const ruleEditor = (label: string, key: 'taxi' | 'daeri') => (
    <div className="rounded-xl border-2 border-[#E2E8F0] p-2.5">
      <p className="text-[11px] font-black text-[#475569]">{label}</p>
      <div className="mt-1.5 grid grid-cols-4 gap-1.5">
        {(['base', 'perKm', 'perMin', 'congestionPerMin'] as const).map((field) => (
          <label key={field} className="block">
            <span className="text-[10px] font-bold text-[#94A3B8]">{field === 'base' ? '기본' : field === 'perKm' ? 'km당' : field === 'perMin' ? '분당' : '정체/분'}</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={fareDraft[key][field]}
              onChange={(event) => setFareDraft((prev) => ({ ...prev, [key]: { ...prev[key], [field]: Number(event.target.value) } }))}
              className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
            />
          </label>
        ))}
      </div>
    </div>
  )

  return (
    <div className="mt-4 space-y-4">
      {error ? <p className="text-xs font-black text-[#DC2626]">{error}</p> : null}
      <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
        <p className="text-sm font-black">관리자 Pi 지갑 주소 설정</p>
        <p className="mt-0.5 text-xs font-bold text-[#64748B]">플랫폼 수수료가 적립될 관리자(운영자)의 Pi 테스트넷 입금 주소를 입력하세요. 주소는 <span className="font-black text-[#0F172A]">G로 시작하는 56자리</span> 대문자·숫자(Stellar 규격)여야 합니다. (현재는 데모용 주소가 기본 세팅되어 있습니다.)</p>
        <input
          type="text"
          value={walletDraft}
          onChange={(event) => setWalletDraft(event.target.value)}
          placeholder="G로 시작하는 56자리 테스트넷 주소"
          spellCheck={false}
          autoComplete="off"
          className="mt-3 w-full rounded-lg border border-[#CBD5E1] px-3 py-2 font-mono text-xs font-bold outline-none focus:border-[#4C1FB8]"
        />
        {walletDraft.trim() && !isPiWalletAddress(walletDraft) ? (
          <p className="mt-1.5 rounded-lg bg-[#FEF2F2] px-2.5 py-1.5 text-[11px] font-black text-[#DC2626]">
            ⚠ {piWalletError(walletDraft) ?? 'Pi 지갑 주소 형식이 올바르지 않습니다.'}
          </p>
        ) : null}
        {!isPiWalletAddress(wallet) ? (
          <p className="mt-1.5 rounded-lg bg-[#FFFBEB] px-2.5 py-1.5 text-[11px] font-bold text-[#B45309]">
            저장된 주소가 데모용 플레이스홀더입니다. 실제 테스트넷 입금 주소를 등록해 주세요.
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy || !isPiWalletAddress(walletDraft) || walletDraft.trim() === wallet}
          onClick={saveWallet}
          className="mt-3 w-full rounded-xl bg-[#047857] py-2.5 text-xs font-black text-white disabled:opacity-50"
        >
          지갑 주소 저장
        </button>
      </section>

      <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black">플랫폼 지갑 입금 내역</p>
          {depositTotal ? (
            <span className="rounded-full bg-[#DBEAFE] px-2.5 py-1 text-[10px] font-black text-[#1D4ED8]">
              {depositTotal.count}건 · {depositTotal.total.toFixed(7)} Pi
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs font-bold text-[#64748B]">사용자 테스트넷 지갑 → 플랫폼 입금 주소로 들어온 전송 기록입니다. txid 기준 중복 없이 기록됩니다.</p>
        {deposits.length ? (
          <div className="mt-3 space-y-1.5">
            {deposits.slice(0, 10).map((deposit) => (
              <div key={deposit.id} className="rounded-xl bg-[#F8FAFC] px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-[11px] font-black">
                  <span>{deposit.amount.toFixed(7)} Pi</span>
                  <span className="text-[#94A3B8]">{new Date(deposit.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="mt-0.5 truncate font-mono text-[10px] font-bold text-[#64748B]">
                  {deposit.fromWallet.slice(0, 14)}… → {deposit.toWallet.slice(0, 14)}… · tx {deposit.txid.slice(0, 14)}…
                </p>
                {deposit.memo ? <p className="mt-0.5 text-[10px] font-bold text-[#94A3B8]">{deposit.memo}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-xl bg-[#F8FAFC] px-3 py-2.5 text-center text-[11px] font-bold text-[#94A3B8]">아직 기록된 입금이 없습니다.</p>
        )}
        <div className="mt-3 space-y-1.5 rounded-xl border-2 border-dashed border-[#CBD5E1] p-3">
          <p className="text-[10px] font-black text-[#475569]">테스트넷 입금 수동 동기화</p>
          <input
            type="text"
            value={depositDraft.txid}
            onChange={(event) => setDepositDraft((prev) => ({ ...prev, txid: event.target.value }))}
            placeholder="트랜잭션 ID (txid)"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-lg border border-[#CBD5E1] px-2.5 py-1.5 font-mono text-xs font-bold outline-none focus:border-[#4C1FB8]"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="text"
              value={depositDraft.fromWallet}
              onChange={(event) => setDepositDraft((prev) => ({ ...prev, fromWallet: event.target.value }))}
              placeholder="보낸 지갑 주소"
              spellCheck={false}
              autoComplete="off"
              className="rounded-lg border border-[#CBD5E1] px-2.5 py-1.5 font-mono text-xs font-bold outline-none focus:border-[#4C1FB8]"
            />
            <input
              type="number"
              min={0}
              step={0.0000001}
              value={depositDraft.amount}
              onChange={(event) => setDepositDraft((prev) => ({ ...prev, amount: event.target.value }))}
              placeholder="금액 (Pi)"
              className="rounded-lg border border-[#CBD5E1] px-2.5 py-1.5 text-xs font-bold outline-none focus:border-[#4C1FB8]"
            />
          </div>
          <input
            type="text"
            value={depositDraft.memo}
            onChange={(event) => setDepositDraft((prev) => ({ ...prev, memo: event.target.value }))}
            placeholder="메모 (선택)"
            className="w-full rounded-lg border border-[#CBD5E1] px-2.5 py-1.5 text-xs font-bold outline-none focus:border-[#4C1FB8]"
          />
          <button
            type="button"
            disabled={busy || !depositDraft.txid.trim() || !depositDraft.fromWallet.trim() || !(Number(depositDraft.amount) > 0)}
            onClick={addDeposit}
            className="w-full rounded-xl bg-[#1D4ED8] py-2 text-xs font-black text-white disabled:opacity-50"
          >
            입금 기록 추가
          </button>
        </div>
      </section>

      <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
        <p className="text-sm font-black">서비스별 플랫폼 수수료율</p>
        <p className="mt-0.5 text-xs font-bold text-[#64748B]">운행 완료(택배는 배정 수락) 시 결제액에서 자동 계산됩니다.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SERVICES.map((service) => (
            <label key={service} className="rounded-xl border-2 border-[#E2E8F0] p-2.5">
              <span className="text-[11px] font-black text-[#475569]">{SERVICE_LABEL[service]}</span>
              <div className="mt-1 flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={0.5}
                  value={rateDraft[service]}
                  onChange={(event) => setRateDraft((prev) => ({ ...prev, [service]: Number(event.target.value) }))}
                  className="w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-sm font-black outline-none focus:border-[#4C1FB8]"
                />
                <span className="text-sm font-black text-[#64748B]">%</span>
              </div>
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || !ratesDirty}
          onClick={saveRates}
          className="mt-3 w-full rounded-xl bg-[#4C1FB8] py-2.5 text-xs font-black text-white disabled:opacity-50"
        >
          수수료율 저장
        </button>
      </section>

      <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
        <p className="text-sm font-black">서비스 요금 · 취소 수수료</p>
        <p className="mt-0.5 text-xs font-bold text-[#64748B]">택시·대리는 기본 요금 + (거리 × km당 요율) + (예상 시간 × 분당 요율)로 산정됩니다.</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ruleEditor('택시', 'taxi')}
          {ruleEditor('대리운전', 'daeri')}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(Object.keys(FLAT_SERVICE_LABEL) as FlatServiceId[]).map((key) => (
            <label key={key} className="rounded-xl border-2 border-[#E2E8F0] p-2.5">
              <span className="text-[11px] font-black text-[#475569]">{FLAT_SERVICE_LABEL[key]}</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={fareDraft.flatBase[key]}
                onChange={(event) => setFareDraft((prev) => ({ ...prev, flatBase: { ...prev.flatBase, [key]: Number(event.target.value) } }))}
                className="mt-1 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
              />
            </label>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="rounded-xl border-2 border-[#FDE68A] bg-[#FFFBEB] p-2.5">
            <span className="text-[11px] font-black text-[#B45309]">중도 취소 수수료율</span>
            <div className="mt-1 flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={fareDraft.cancel.rate}
                onChange={(event) => setFareDraft((prev) => ({ ...prev, cancel: { ...prev.cancel, rate: Number(event.target.value) } }))}
                className="w-full rounded-lg border border-[#FDE68A] bg-white px-2 py-1.5 text-xs font-black outline-none focus:border-[#B45309]"
              />
              <span className="text-xs font-black text-[#B45309]">%</span>
            </div>
          </label>
          <label className="rounded-xl border-2 border-[#FDE68A] bg-[#FFFBEB] p-2.5">
            <span className="text-[11px] font-black text-[#B45309]">취소 수수료 최소액</span>
            <div className="mt-1 flex items-center gap-1">
              <input
                type="number"
                min={0}
                step={0.01}
                value={fareDraft.cancel.min}
                onChange={(event) => setFareDraft((prev) => ({ ...prev, cancel: { ...prev.cancel, min: Number(event.target.value) } }))}
                className="w-full rounded-lg border border-[#FDE68A] bg-white px-2 py-1.5 text-xs font-black outline-none focus:border-[#B45309]"
              />
              <span className="text-xs font-black text-[#B45309]">Pi</span>
            </div>
          </label>
        </div>
        <button
          type="button"
          disabled={busy || !fareDirty}
          onClick={saveFare}
          className="mt-3 w-full rounded-xl bg-[#0F172A] py-2.5 text-xs font-black text-white disabled:opacity-50"
        >
          요금·수수료 설정 저장
        </button>
      </section>
      {notice ? <p className="text-center text-xs font-black text-[#047857]">{notice}</p> : null}
    </div>
  )
}
