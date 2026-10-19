'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, Lock, LockOpen, MapPin, Route, ShieldAlert, Wallet, X } from 'lucide-react'

/**
 * 🚀 Hackathon Demo Mode — judge-facing English demo flow.
 *
 * Pure simulation: every value below is a constant and every transition is a
 * timer/state change. No API calls, no ledger writes, no dispatch records —
 * it cannot affect real service data. Mirrors the trial-demo policy.
 */

type Scenario = 'a' | 'b' | null

const StepBar = ({ step, total }: { step: number; total: number }) => (
  <div className="flex gap-1.5" aria-hidden="true">
    {Array.from({ length: total }, (_, i) => (
      <span key={i} className={`h-1 flex-1 rounded-full ${i < step ? 'bg-[#38BDF8]' : 'bg-[#DBEAFE]'}`} />
    ))}
  </div>
)

const DemoButton = ({ onClick, children, tone = 'blue' }: { onClick: () => void; children: ReactNode; tone?: 'blue' | 'green' | 'red' | 'slate' }) => {
  const cls =
    tone === 'green'
      ? 'bg-[#15803D]'
      : tone === 'red'
        ? 'bg-[#B91C1C]'
        : tone === 'slate'
          ? 'bg-white text-[#475569] border-2 border-[#CBD5E1]'
          : 'bg-[#3B82F6]'
  return (
    <button type="button" onClick={onClick} className={`w-full rounded-2xl py-3.5 text-sm font-black text-white shadow-sm transition active:scale-[0.98] ${tone === 'slate' ? 'text-[#475569]' : ''} ${cls}`}>
      {children}
    </button>
  )
}

const Row = ({ label, value, accent }: { label: string; value: string; accent?: string }) => (
  <div className="flex items-center justify-between rounded-xl bg-[#F8FAFC] px-3 py-2">
    <span className="text-[11px] font-bold text-[#64748B]">{label}</span>
    <span className="text-[12px] font-black" style={{ color: accent || '#0F172A' }}>{value}</span>
  </div>
)

/* ---------------- Scenario A · Integrated Multi-modal Journey Planner ---------------- */

function ScenarioA({ onDone }: { onDone: () => void }) {
  // step: 0 route setup · 1 EV stopover · 2 parcel leg · 3 journey summary
  const [step, setStep] = useState(0)
  const [planning, setPlanning] = useState(false)

  useEffect(() => {
    if (!planning) return
    const timer = window.setTimeout(() => {
      setPlanning(false)
      setStep(3)
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [planning])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Route className="h-4 w-4 text-[#1D4ED8]" />
        <p className="text-xs font-black text-[#1D4ED8]">Scenario A · Multi-modal Journey Planner</p>
        <span className="ml-auto rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[9px] font-black text-[#1D4ED8]">Step {Math.min(step + 1, 4)}/4</span>
      </div>
      <StepBar step={Math.min(step + 1, 4)} total={4} />

      {step === 0 ? (
        <section className="rounded-[22px] border-2 border-[#BFDBFE] bg-white p-4 shadow-[0_8px_20px_rgba(59,130,246,0.10)]">
          <p className="text-[11px] font-black text-[#64748B]">1 · ROUTE SETUP</p>
          <h3 className="mt-1 text-base font-black text-[#0F172A]">Seoul Station → Gangnam Station</h3>
          <div className="mt-3 space-y-2">
            <Row label="Pickup" value="Seoul Station (KTX)" />
            <Row label="Destination" value="Gangnam Station Exit 5" />
            <Row label="Base estimate" value="8.4 km · 24 min · 5.2 Pi" />
          </div>
          <p className="mt-3 rounded-xl bg-[#EFF6FF] px-3 py-2 text-[11px] font-bold leading-4 text-[#1D4ED8]">
            The rider adds an EV charging stop and a parcel pickup to the same journey — one plan, one route chain.
          </p>
          <div className="mt-3">
            <DemoButton onClick={() => setStep(1)}>Add EV charging stopover</DemoButton>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="rounded-[22px] border-2 border-[#BBF7D0] bg-white p-4 shadow-[0_8px_20px_rgba(21,128,61,0.10)]">
          <p className="text-[11px] font-black text-[#15803D]">2 · EV CHARGING STOPOVER</p>
          <h3 className="mt-1 text-base font-black text-[#0F172A]">EV Fast Charger — Yeouido Park</h3>
          <div className="mt-3 space-y-2">
            <Row label="Charger" value="50 kW DC fast · Slot 2/4" />
            <Row label="Reserved window" value="14:30 – 15:00 (30 min)" />
            <Row label="Queue status" value="No wait · turn secured" accent="#15803D" />
            <Row label="Route impact" value="+1.1 km detour · +32 min" />
          </div>
          <p className="mt-3 rounded-xl bg-[#F0FDF4] px-3 py-2 text-[11px] font-bold leading-4 text-[#15803D]">
            The stopover is inserted as a route waypoint and the booking window is synced to the taxi leg's ETA — the queue holds the slot.
          </p>
          <div className="mt-3">
            <DemoButton tone="green" onClick={() => setStep(2)}>Add parcel delivery leg</DemoButton>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="rounded-[22px] border-2 border-[#FED7AA] bg-white p-4 shadow-[0_8px_20px_rgba(234,88,12,0.10)]">
          <p className="text-[11px] font-black text-[#B45309]">3 · PARCEL DELIVERY LEG</p>
          <h3 className="mt-1 text-base font-black text-[#0F172A]">Parcel pickup at destination</h3>
          <div className="mt-3 space-y-2">
            <Row label="Pickup point" value="Gangnam Station Exit 5 · on arrival" />
            <Row label="Vehicle spec" value="1-ton truck (Damas)" />
            <Row label="Package" value="LARGE box · 80×60×40 cm · 12 kg" />
            <Row label="Deliver to" value="Jamsil Lotte World · 18:00" />
            <Row label="Delivery fee" value="3.4 Pi · driver insured" />
          </div>
          <p className="mt-3 rounded-xl bg-[#FFF7ED] px-3 py-2 text-[11px] font-bold leading-4 text-[#B45309]">
            Pickup is scheduled at the exact arrival time of the ride leg — vehicle class and parcel size are validated against the courier's role.
          </p>
          <div className="mt-3">
            <DemoButton onClick={() => setPlanning(true)}>Generate integrated journey</DemoButton>
          </div>
        </section>
      ) : null}

      {planning ? (
        <div className="rounded-[22px] border-2 border-[#BFDBFE] bg-white p-5 text-center">
          <span className="inline-flex animate-pulse rounded-full bg-[#DBEAFE] px-3 py-1 text-[11px] font-black text-[#1D4ED8]">PLANNING…</span>
          <p className="mt-3 text-sm font-bold text-[#475569]">Linking legs, syncing schedules, and reserving the charger slot…</p>
        </div>
      ) : null}

      {step === 3 && !planning ? (
        <section className="rounded-[22px] border-2 border-[#0F172A] bg-[#0F172A] p-4 text-white shadow-[0_10px_24px_rgba(15,23,42,0.28)]">
          <p className="text-[11px] font-black tracking-wide text-[#93C5FD]">4 · INTEGRATED JOURNEY — TRIP-0827</p>
          <div className="mt-3 space-y-2">
            <div className="rounded-xl bg-white/10 px-3 py-2.5">
              <p className="text-[12px] font-black">Leg 1 · Taxi — Seoul Station → Yeouido → Gangnam</p>
              <p className="mt-0.5 text-[10px] font-bold text-[#CBD5E1]">9.5 km · 26 min · 5.6 Pi · escrow locked on boarding</p>
            </div>
            <div className="rounded-xl bg-white/10 px-3 py-2.5">
              <p className="text-[12px] font-black">Leg 2 · EV Charge — Yeouido Park, Slot 2</p>
              <p className="mt-0.5 text-[10px] font-bold text-[#CBD5E1]">14:30–15:00 reserved · 0.9 Pi deposit · auto check-in</p>
            </div>
            <div className="rounded-xl bg-white/10 px-3 py-2.5">
              <p className="text-[12px] font-black">Leg 3 · Parcel — Gangnam → Jamsil Lotte World</p>
              <p className="mt-0.5 text-[10px] font-bold text-[#CBD5E1]">1-ton truck · LARGE · pickup synced to arrival · 3.4 Pi</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-white/15 px-3 py-2.5">
            <span className="text-[11px] font-black text-[#93C5FD]">TOTAL</span>
            <span className="text-base font-black">9.9 Pi · 3 linked services</span>
          </div>
          <p className="mt-2 text-[10px] font-bold leading-4 text-[#CBD5E1]">
            All legs settle through one Pi checkout chain — each service keeps its own escrow lifecycle, cancellation policy, and driver payout.
          </p>
          <div className="mt-3">
            <DemoButton onClick={onDone}>Finish demo</DemoButton>
          </div>
        </section>
      ) : null}
    </div>
  )
}

/* ---------------- Scenario B · Pi Payment Exception & FDS Security Logic ---------------- */

type BPhase = 'pay' | 'fail' | 'altpay' | 'locked' | 'carry'

function ScenarioB({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<BPhase>('pay')
  const [attempting, setAttempting] = useState(false)
  const [uses, setUses] = useState(1)
  const fee = 0.32

  const addUses = (n: number) => {
    const next = Math.min(3, uses + n)
    setUses(next)
    if (next >= 3) setPhase('locked')
  }

  useEffect(() => {
    if (!attempting) return
    const timer = window.setTimeout(() => {
      setAttempting(false)
      setPhase('fail')
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [attempting])

  const step = phase === 'pay' || phase === 'fail' ? 1 : phase === 'altpay' ? 2 : phase === 'locked' ? 3 : 4

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-[#B45309]" />
        <p className="text-xs font-black text-[#B45309]">Scenario B · Pi Payment Exception & FDS Security</p>
        <span className="ml-auto rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[9px] font-black text-[#B45309]">Step {step}/4</span>
      </div>
      <StepBar step={step} total={4} />

      {phase === 'pay' ? (
        <section className="rounded-[22px] border-2 border-[#BFDBFE] bg-white p-4">
          <p className="text-[11px] font-black text-[#64748B]">1 · PI CHECKOUT ATTEMPT</p>
          <h3 className="mt-1 text-base font-black text-[#0F172A]">Ride fare · 6.4 Pi</h3>
          <div className="mt-3 space-y-2">
            <Row label="Passenger" value="rider_9f2c · Pi wallet" />
            <Row label="Provider" value="Driver Kim · GBD-2210" />
            <Row label="Commission (5%)" value="0.32 Pi" />
          </div>
          <div className="mt-3">
            <DemoButton onClick={() => setAttempting(true)}>Pay with Pi</DemoButton>
          </div>
        </section>
      ) : null}

      {attempting ? (
        <div className="rounded-[22px] border-2 border-[#BFDBFE] bg-white p-5 text-center">
          <span className="inline-flex animate-pulse rounded-full bg-[#DBEAFE] px-3 py-1 text-[11px] font-black text-[#1D4ED8]">Pi SDK…</span>
          <p className="mt-3 text-sm font-bold text-[#475569]">Awaiting wallet authorization on Pi Testnet…</p>
        </div>
      ) : null}

      {phase === 'fail' ? (
        <section className="rounded-[22px] border-2 border-[#FECACA] bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-black text-[#B91C1C]">PAYMENT FAILED</p>
            <span className="rounded-full bg-[#FEE2E2] px-2 py-0.5 text-[10px] font-black text-[#B91C1C]">Insufficient balance ×1</span>
          </div>
          <p className="mt-2 text-sm font-bold leading-5 text-[#475569]">
            Policy gate: one insufficient-balance failure (or two network errors) unlocks the alternative-payment option for this user.
          </p>
          <div className="mt-3">
            <DemoButton tone="red" onClick={() => setPhase('altpay')}>Complete trip with another method</DemoButton>
          </div>
        </section>
      ) : null}

      {phase === 'altpay' ? (
        <section className="rounded-[22px] border-2 border-[#99F6E4] bg-white p-4">
          <p className="text-[11px] font-black text-[#0F766E]">2 · ALTERNATIVE PAYMENT</p>
          <h3 className="mt-1 text-base font-black text-[#0F172A]">Trip completed via Card</h3>
          <div className="mt-3 space-y-2">
            <Row label="Status logged" value="'타 결제 수단 이용 완료'" accent="#0F766E" />
            <Row label="Reason" value="insufficient balance ×1" />
            <Row label="Unpaid commission" value={`${fee.toFixed(2)} Pi → provider ledger`} accent="#B45309" />
            <Row label="Pi proof" value="none — altpay:card marker only" />
          </div>
          <p className="mt-3 rounded-xl bg-[#F0FDFA] px-3 py-2 text-[11px] font-bold leading-4 text-[#0F766E]">
            The fare went straight to the provider, so the platform commission is accrued as a carryover on the provider's ledger — never a fake Pi receipt.
          </p>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-[#F8FAFC] px-3 py-2">
            <span className="text-[11px] font-bold text-[#64748B]">Provider alt-pay count</span>
            <span className="text-[12px] font-black text-[#B45309]">{uses} / 3 — auto-lock at 3×</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <DemoButton tone="slate" onClick={() => addUses(1)}>+1 alt-pay use</DemoButton>
            <DemoButton tone="slate" onClick={() => addUses(2)}>+2 more uses</DemoButton>
          </div>
        </section>
      ) : null}

      {phase === 'locked' ? (
        <section className="rounded-[22px] border-2 border-[#FECACA] bg-white p-4">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-[#B91C1C]" />
            <p className="text-[11px] font-black text-[#B91C1C]">3 · AUTO-LOCK ENGAGED (3×)</p>
          </div>
          <div className="mt-3 space-y-2">
            <Row label="Alt-pay count" value="3 / 3 — threshold hit" accent="#B91C1C" />
            <Row label="Outstanding commission" value={`${(fee * 3).toFixed(2)} Pi`} accent="#B45309" />
            <Row label="FDS block" value="by='altpay' — partner suspended" accent="#B91C1C" />
            <Row label="Registry lock" value="by='ALTPAY' — service gated" accent="#B91C1C" />
          </div>
          <p className="mt-3 rounded-xl bg-[#FEF2F2] px-3 py-2 text-[11px] font-bold leading-4 text-[#B91C1C]">
            The provider is locked out of dispatch and partner services until the full unpaid commission is settled — an admin's independent lock stays untouched.
          </p>
          <div className="mt-3">
            <DemoButton onClick={() => setPhase('carry')}>Next: normal Pi settlement</DemoButton>
          </div>
        </section>
      ) : null}

      {phase === 'carry' ? (
        <section className="rounded-[22px] border-2 border-[#BBF7D0] bg-white p-4">
          <div className="flex items-center gap-2">
            <LockOpen className="h-4 w-4 text-[#15803D]" />
            <p className="text-[11px] font-black text-[#15803D]">4 · CARRYOVER SETTLEMENT → AUTO-UNLOCK</p>
          </div>
          <div className="mt-3 space-y-2">
            <Row label="Next trip gross" value="5.00 Pi" />
            <Row label="Current commission" value="−0.25 Pi" />
            <Row label="Carryover deducted" value={`−${(fee * 3).toFixed(2)} Pi`} accent="#B45309" />
            <Row label="Driver net payout" value={`${(5 - 0.25 - fee * 3).toFixed(2)} Pi (A2U)`} />
            <Row label="Ledger balance" value="0.00 Pi" accent="#15803D" />
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#DCFCE7] px-3 py-2.5">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#15803D]" />
            <p className="text-[11px] font-black text-[#15803D]">Balance cleared → lock released automatically · idempotent · audit-logged</p>
          </div>
          <div className="mt-3">
            <DemoButton tone="green" onClick={onDone}>Finish demo</DemoButton>
          </div>
        </section>
      ) : null}
    </div>
  )
}

/* ---------------- Modal shell ---------------- */

export default function HackathonDemoModal({ onClose }: { onClose: () => void }) {
  const [scenario, setScenario] = useState<Scenario>(null)

  return (
    <div className="fixed inset-0 z-[97] flex items-end justify-center bg-[#0F172A]/60 sm:items-center sm:p-4">
      <section className="relative flex h-[min(96dvh,100%)] w-full max-w-md flex-col overflow-hidden rounded-t-[32px] bg-[#F8FAFC] shadow-2xl sm:h-[min(92dvh,820px)] sm:rounded-[32px]">
        <header className="shrink-0 border-b border-[#1E293B] bg-[#0F172A] px-5 pb-3 pt-3">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[#334155]" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black tracking-wide text-[#38BDF8]">TaxiTago · Pi Network Global Hackathon</p>
              <h2 className="mt-0.5 text-xl font-black text-white">🚀 Hackathon Demo Mode</h2>
              <p className="mt-1 text-[11px] font-bold text-[#94A3B8]">Judge-facing walkthrough · simulation only — no real payments, rides, or ledger writes</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full bg-white/10 p-2 text-white" aria-label="Close demo">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {scenario === null ? (
            <div className="space-y-3">
              <p className="text-xs font-bold leading-5 text-[#475569]">
                Pick a scenario to run a scripted, English-narrated walkthrough of the platform's core flows. Each step mirrors a real subsystem of TaxiTago.
              </p>
              <button
                type="button"
                onClick={() => setScenario('a')}
                className="w-full rounded-[22px] border-2 border-[#BFDBFE] bg-white p-4 text-left shadow-[0_8px_20px_rgba(59,130,246,0.10)] transition active:scale-[0.99]"
              >
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0 text-[#1D4ED8]" />
                  <p className="text-sm font-black text-[#0F172A]">Scenario A · Integrated Multi-modal Journey Planner</p>
                </div>
                <p className="mt-1.5 text-[11px] font-bold leading-4 text-[#64748B]">
                  Route setup → EV charging stopover → parcel delivery with vehicle &amp; size specs — one linked trip, one Pi checkout chain.
                </p>
                <div className="mt-2 flex gap-1.5">
                  <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[9px] font-black text-[#1D4ED8]">Taxi</span>
                  <span className="rounded-full bg-[#F0FDF4] px-2 py-0.5 text-[9px] font-black text-[#15803D]">EV Charging</span>
                  <span className="rounded-full bg-[#FFF7ED] px-2 py-0.5 text-[9px] font-black text-[#B45309]">Parcel</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setScenario('b')}
                className="w-full rounded-[22px] border-2 border-[#FED7AA] bg-white p-4 text-left shadow-[0_8px_20px_rgba(234,88,12,0.10)] transition active:scale-[0.99]"
              >
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-[#B45309]" />
                  <p className="text-sm font-black text-[#0F172A]">Scenario B · Pi Payment Exception &amp; FDS Security Logic</p>
                </div>
                <p className="mt-1.5 text-[11px] font-bold leading-4 text-[#64748B]">
                  Pi failure fallback → unpaid commission carryover → 3× abuse auto-lock → settlement-triggered auto-unlock.
                </p>
                <div className="mt-2 flex gap-1.5">
                  <span className="rounded-full bg-[#FEE2E2] px-2 py-0.5 text-[9px] font-black text-[#B91C1C]">Alt-Pay Fallback</span>
                  <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[9px] font-black text-[#B45309]">Carryover</span>
                  <span className="rounded-full bg-[#E0E7FF] px-2 py-0.5 text-[9px] font-black text-[#4338CA]">FDS Lock/Unlock</span>
                </div>
              </button>
              <div className="flex items-start gap-2 rounded-2xl border border-dashed border-[#CBD5E1] bg-white/70 p-3">
                <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-[#64748B]" />
                <p className="text-[10px] font-bold leading-4 text-[#64748B]">
                  Demo Mode is read-only for the ledger: all figures are staged values for presentation. Real settlements continue to require Pi payment proof (paymentId + txid).
                </p>
              </div>
            </div>
          ) : null}
          {scenario === 'a' ? <ScenarioA onDone={() => setScenario(null)} /> : null}
          {scenario === 'b' ? <ScenarioB onDone={() => setScenario(null)} /> : null}
          {scenario ? (
            <button type="button" onClick={() => setScenario(null)} className="mt-3 w-full rounded-2xl border-2 border-[#CBD5E1] bg-white py-2.5 text-xs font-black text-[#475569]">
              ← Back to scenarios
            </button>
          ) : null}
        </div>
      </section>
    </div>
  )
}
