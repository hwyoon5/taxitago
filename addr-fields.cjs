const fs = require('fs')
const load = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const save = (p, s) => fs.writeFileSync(p, s)
const need = (s, frag, label) => { if (!s.includes(frag)) throw new Error('MISSING ' + label) }
const rep = (s, a, b, label) => { need(s, a, label); return s.split(a).join(b) }

const p = 'components/home-screen.tsx'
let s = load(p)

// ── 1. RouteSelectRow — 텍스트 인라인 입력 + 우측 돋보기 분리 ────────────────
{
  const old = `function RouteSelectRow({
  tone,
  label,
  value,
  placeholder,
  onClick,
  ariaLabel,
}: {
  tone: 'pickup' | 'waypoint' | 'dest'
  label: string
  value: string
  placeholder: string
  onClick: () => void
  ariaLabel?: string
}) {
  const Icon = tone === 'pickup' ? LocateFixed : tone === 'waypoint' ? MapPin : Search
  const iconCls = tone === 'pickup' ? 'bg-[#EEF2FF] text-[#4C1FB8]' : tone === 'waypoint' ? 'bg-[#FFF7ED] text-[#EA580C]' : 'bg-[#EDE5FF] text-[#6D28D9]'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel || \`\${label} \${value || placeholder}\`}
      className="flex w-full items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-left shadow-[0_3px_8px_rgba(15,23,42,0.05)]"
    >
      <span className={\`flex h-6 w-6 shrink-0 items-center justify-center rounded-full \${iconCls}\`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1 py-0.5">
        <span className="block text-[10px] font-bold leading-3 text-[#64748B]">{label}</span>
        <span className={\`mt-0.5 block truncate text-[13px] font-black leading-4 \${value ? 'text-[#0F172A]' : 'font-bold text-[#94A3B8]'}\`}>
          {value || placeholder}
        </span>
      </span>
      <Search className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" />
    </button>
  )
}`
  const neu = `function RouteSelectRow({
  tone,
  label,
  value,
  placeholder,
  onChange,
  onSearch,
  ariaLabel,
}: {
  tone: 'pickup' | 'waypoint' | 'dest'
  label: string
  value: string
  placeholder: string
  /** 주소 텍스트 직접 타이핑 — 상세 주소(동·호수 등) 입력용. */
  onChange: (value: string) => void
  /** 우측 돋보기 — 장소/지도 검색 화면 진입. */
  onSearch: () => void
  ariaLabel?: string
}) {
  const Icon = tone === 'pickup' ? LocateFixed : tone === 'waypoint' ? MapPin : MapPin
  const iconCls = tone === 'pickup' ? 'bg-[#EEF2FF] text-[#4C1FB8]' : tone === 'waypoint' ? 'bg-[#FFF7ED] text-[#EA580C]' : 'bg-[#EDE5FF] text-[#6D28D9]'
  return (
    <div className="flex w-full items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 shadow-[0_3px_8px_rgba(15,23,42,0.05)]">
      <span className={\`flex h-6 w-6 shrink-0 items-center justify-center rounded-full \${iconCls}\`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1 py-0.5">
        <span className="block text-[10px] font-bold leading-3 text-[#64748B]">{label}</span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel || \`\${label} \${placeholder}\`}
          className="mt-0.5 block w-full truncate bg-transparent text-[13px] font-black leading-4 text-[#0F172A] outline-none placeholder:font-bold placeholder:text-[#94A3B8]"
        />
      </span>
      <button
        type="button"
        onClick={onSearch}
        aria-label={ariaLabel || \`\${label} \${placeholder}\`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#94A3B8] transition hover:bg-[#F1F5F9] hover:text-[#4C1FB8] active:scale-95"
      >
        <Search className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}`
  s = rep(s, old, neu, 'P1')
}

// ── 2. 대리 시트 — 출발지/도착지 호출부 ──────────────────────────────────────
s = rep(s, `                value={pickup}
                placeholder={t('daeri.pickupPh')}
                ariaLabel={t('daeri.pickupAria')}
                onClick={() => setPickupSearchOpen(true)}`,
`                value={pickup}
                placeholder={t('daeri.pickupPh')}
                ariaLabel={t('daeri.pickupAria')}
                onChange={setPickup}
                onSearch={() => setPickupSearchOpen(true)}`, 'P2')

s = rep(s, `                value={dest}
                placeholder={t('home.destPlaceholder')}
                ariaLabel={t('home.destSearch')}
                onClick={() => setDestSearchOpen(true)}`,
`                value={dest}
                placeholder={t('home.destPlaceholder')}
                ariaLabel={t('home.destSearch')}
                onChange={setDest}
                onSearch={() => setDestSearchOpen(true)}`, 'P3')

// ── 3. 택배 시트 — 출발지/도착지 호출부 ──────────────────────────────────────
s = rep(s, `                value={deliveryPickup}
                placeholder={t('daeri.pickupPh')}
                ariaLabel={t('daeri.pickupAria')}
                onClick={() => setDeliverySearchTarget('pickup')}`,
`                value={deliveryPickup}
                placeholder={t('daeri.pickupPh')}
                ariaLabel={t('daeri.pickupAria')}
                onChange={setDeliveryPickup}
                onSearch={() => setDeliverySearchTarget('pickup')}`, 'P4')

s = rep(s, `                value={deliveryDest}
                placeholder={t('home.destPh')}
                ariaLabel={t('home.destSearchOpen')}
                onClick={() => setDeliverySearchTarget('dest')}`,
`                value={deliveryDest}
                placeholder={t('home.destPh')}
                ariaLabel={t('home.destSearchOpen')}
                onChange={setDeliveryDest}
                onSearch={() => setDeliverySearchTarget('dest')}`, 'P5')

// ── 4. 택시 카드 — 출발지 행: 지도 전용 버튼 → 인라인 입력 + 돋보기 ──────────
{
  const old = `          <button
            type="button"
            onClick={() => onOpenMap()}
            className="flex w-full items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-left shadow-[0_3px_8px_rgba(15,23,42,0.05)]"
            aria-label={\`\${t('home.pickup')} \${pickup}\`}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-[#4C1FB8]">
              <LocateFixed className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 py-0.5">
              <span className="block text-[10px] font-bold leading-3 text-[#64748B]">{t('home.pickup')}</span>
              <span className="mt-0.5 block truncate text-[13px] font-black leading-4 text-[#0F172A]">{pickup}</span>
              {pickupHint ? <span className="mt-0.5 block truncate text-[10px] font-bold leading-3 text-[#64748B]">{pickupHint}</span> : null}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#94A3B8]" />
          </button>`
  const neu = `          <div className="flex w-full items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 shadow-[0_3px_8px_rgba(15,23,42,0.05)]">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-[#4C1FB8]">
              <LocateFixed className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 py-0.5">
              <span className="block text-[10px] font-bold leading-3 text-[#64748B]">{t('home.pickup')}</span>
              <input
                value={pickup}
                onChange={(event) => onPickupTextChange?.(event.target.value)}
                placeholder={t('daeri.pickupPh')}
                aria-label={\`\${t('home.pickup')} \${pickup}\`}
                className="mt-0.5 block w-full truncate bg-transparent text-[13px] font-black leading-4 text-[#0F172A] outline-none placeholder:font-bold placeholder:text-[#94A3B8]"
              />
              {pickupHint ? <span className="mt-0.5 block truncate text-[10px] font-bold leading-3 text-[#64748B]">{pickupHint}</span> : null}
            </span>
            <button
              type="button"
              onClick={() => onOpenMap()}
              aria-label={t('home.pickOnMap')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#94A3B8] transition hover:bg-[#F1F5F9] hover:text-[#4C1FB8] active:scale-95"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </div>`
  s = rep(s, old, neu, 'P6')
}

// ── 5. 택시 카드 — 경유지 행: 전체 버튼 → 인라인 입력 + 돋보기 ───────────────
{
  const old = `              <button
                type="button"
                onClick={() => setWaypointSearchIndex(index)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                aria-label={t('daeri.wpSearch', { n: String(index + 1) })}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#FFF7ED] text-[#EA580C]">
                  <MapPin className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 py-0.5">
                  <span className="block text-[10px] font-bold leading-3 text-[#64748B]">{t('daeri.waypointPh', { n: String(index + 1) })}</span>
                  <span className={\`mt-0.5 block truncate text-[13px] font-black leading-4 \${waypoint ? 'text-[#0F172A]' : 'font-bold text-[#94A3B8]'}\`}>
                    {waypoint || t('daeri.wpSearchPh')}
                  </span>
                </span>
                <Search className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" />
              </button>`
  const neu = `              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#FFF7ED] text-[#EA580C]">
                <MapPin className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1 py-0.5">
                <span className="block text-[10px] font-bold leading-3 text-[#64748B]">{t('daeri.waypointPh', { n: String(index + 1) })}</span>
                <input
                  value={waypoint}
                  onChange={(event) => onWaypointsChange?.(waypoints.map((item, i) => (i === index ? event.target.value : item)))}
                  placeholder={t('daeri.wpSearchPh')}
                  aria-label={t('daeri.waypointPh', { n: String(index + 1) })}
                  className="mt-0.5 block w-full truncate bg-transparent text-[13px] font-black leading-4 text-[#0F172A] outline-none placeholder:font-bold placeholder:text-[#94A3B8]"
                />
              </span>
              <button
                type="button"
                onClick={() => setWaypointSearchIndex(index)}
                aria-label={t('daeri.wpSearch', { n: String(index + 1) })}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#94A3B8] transition hover:bg-[#F1F5F9] hover:text-[#EA580C] active:scale-95"
              >
                <Search className="h-3.5 w-3.5" />
              </button>`
  s = rep(s, old, neu, 'P7')
}

// ── 6. 택시 카드 — 목적지 행 ─────────────────────────────────────────────────
{
  const old = `            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex min-w-0 flex-1 items-stretch overflow-hidden rounded-lg border-2 border-[#7C3AED] bg-white text-left shadow-[0_6px_12px_rgba(124,58,237,0.1)]"
              style={{ WebkitTextSizeAdjust: '100%', textSizeAdjust: '100%' }}
              aria-label={destination ? \`\${t('home.dest')} \${destination}\` : t('home.destSearch')}
            >
              <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2.5 py-1.5">
                <span className="block shrink-0 text-[11px] font-bold leading-4 text-[#7C3AED]">{t('home.dest')}</span>
                <span className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EDE5FF] text-[#6D28D9]">
                    <Search className="h-3.5 w-3.5" />
                  </span>
                  <span className={\`min-w-0 flex-1 truncate text-sm font-black leading-4 \${destination ? 'text-[#0F172A]' : 'text-[#94A3B8]'}\`}>
                    {destination || t('home.destPlaceholder')}
                  </span>
                </span>
              </span>
              <DestinationTaxiLoop className="w-[6.75rem] shrink-0 self-stretch overflow-hidden" />
            </button>`
  const neu = `            <div
              className="flex min-w-0 flex-1 items-stretch overflow-hidden rounded-lg border-2 border-[#7C3AED] bg-white text-left shadow-[0_6px_12px_rgba(124,58,237,0.1)]"
              style={{ WebkitTextSizeAdjust: '100%', textSizeAdjust: '100%' }}
            >
              <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2.5 py-1.5">
                <span className="block shrink-0 text-[11px] font-bold leading-4 text-[#7C3AED]">{t('home.dest')}</span>
                <span className="flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EDE5FF] text-[#6D28D9]">
                    <MapPin className="h-3.5 w-3.5" />
                  </span>
                  <input
                    value={destination}
                    onChange={(event) => (onDestinationText ?? onDestination)(event.target.value)}
                    placeholder={t('home.destPlaceholder')}
                    aria-label={destination ? \`\${t('home.dest')} \${destination}\` : t('home.destSearch')}
                    className="min-w-0 flex-1 truncate bg-transparent text-sm font-black leading-4 text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
                  />
                </span>
              </span>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label={t('home.destSearchOpen')}
                className="flex w-9 shrink-0 items-center justify-center self-stretch text-[#94A3B8] transition hover:bg-[#F1F5F9] hover:text-[#4C1FB8] active:scale-95"
              >
                <Search className="h-4 w-4" />
              </button>
              <DestinationTaxiLoop className="w-[6.75rem] shrink-0 self-stretch overflow-hidden" />
            </div>`
  s = rep(s, old, neu, 'P8')
}

// ── 7. SearchCard — 목적지 런처 ─────────────────────────────────────────────
{
  const old = `      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="group relative z-10 flex w-full items-stretch overflow-hidden rounded-2xl border-2 border-[#94A3B8] bg-[#F8FAFC] text-left transition hover:border-[#4C1FB8] hover:bg-white"
        aria-label={t('home.destSearchOpen')}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-l-[14px] px-4 py-3.5">
          <Search className="h-5 w-5 shrink-0 text-[#4C1FB8]" />
          <span className={\`min-w-0 flex-1 truncate text-sm font-extrabold \${destination ? 'text-[#0F172A]' : 'text-[#64748B]'}\`}>{destination || t('home.destPh')}</span>
        </span>
        <DestinationTaxiLoop className="w-[10.25rem] shrink-0 self-stretch rounded-r-[14px]" />
      </button>`
  const neu = `      <div className="group relative z-10 flex w-full items-stretch overflow-hidden rounded-2xl border-2 border-[#94A3B8] bg-[#F8FAFC] text-left transition hover:border-[#4C1FB8] hover:bg-white">
        <span className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-l-[14px] px-4 py-3.5">
          <MapPin className="h-5 w-5 shrink-0 text-[#4C1FB8]" />
          <input
            value={destination}
            onChange={(event) => onSelect(event.target.value)}
            placeholder={t('home.destPh')}
            aria-label={destination ? \`\${t('home.dest')} \${destination}\` : t('home.destSearch')}
            className="min-w-0 flex-1 truncate bg-transparent text-sm font-extrabold text-[#0F172A] outline-none placeholder:text-[#64748B]"
          />
        </span>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label={t('home.destSearchOpen')}
          className="flex w-11 shrink-0 items-center justify-center self-stretch text-[#64748B] transition hover:bg-[#F1F5F9] hover:text-[#4C1FB8] active:scale-95"
        >
          <Search className="h-5 w-5" />
        </button>
        <DestinationTaxiLoop className="w-[10.25rem] shrink-0 self-stretch rounded-r-[14px]" />
      </div>`
  s = rep(s, old, neu, 'P9')
}

// ── 8. Home props — 텍스트 직접 입력 콜백 ────────────────────────────────────
s = rep(s, `  onWaypointPicked,
  onDestination,
  onService,
  onReceipt,
  onOpenMap,
  destSearchTick = 0,`,
`  onWaypointPicked,
  onDestination,
  onDestinationText,
  onPickupTextChange,
  onService,
  onReceipt,
  onOpenMap,
  destSearchTick = 0,`, 'P10a')

s = rep(s, `  onWaypointPicked?: (text: string, coords: RideCoords) => void
  onDestination: (value: string, coords?: RideCoords) => void`,
`  onWaypointPicked?: (text: string, coords: RideCoords) => void
  onDestination: (value: string, coords?: RideCoords) => void
  /** 목적지 텍스트 직접 타이핑 — 토스트·좌표 해석 없이 값만 갱신한다. */
  onDestinationText?: (value: string) => void
  /** 출발지 텍스트 직접 타이핑 — 좌표는 유지하고 주소 문자열만 바꾼다. */
  onPickupTextChange?: (value: string) => void`, 'P10b')

// ── 9. HomeScreen — 타이핑 핸들러 + Home 연결 ───────────────────────────────
s = rep(s, `  const selectDestination = (value: string, coords?: RideCoords) => {`,
`  // 주소 필드 직접 타이핑 — 검색 경유 없이 텍스트만 갱신한다.
  const editPickupText = (value: string) => {
    const next: PickupPlace = { ...origin, address: value }
    pickupRef.current = next
    setPickup(next)
  }
  const editDestinationText = (value: string) => {
    setDestination(value)
    setDestPlace(null)
  }
  const selectDestination = (value: string, coords?: RideCoords) => {`, 'P11a')

s = rep(s, `            onDestination={selectDestination}
            onService={openService}
            onReceipt={setReceiptRide}
            onOpenMap={openPickupMap}`,
`            onDestination={selectDestination}
            onDestinationText={editDestinationText}
            onPickupTextChange={editPickupText}
            onService={openService}
            onReceipt={setReceiptRide}
            onOpenMap={openPickupMap}`, 'P11b')

save(p, s)
console.log('home-screen ok')
