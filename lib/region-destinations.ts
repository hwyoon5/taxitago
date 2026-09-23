export type RegionId =
  | 'seoul'
  | 'busan'
  | 'incheon'
  | 'daegu'
  | 'daejeon'
  | 'gwangju'
  | 'ulsan'
  | 'sejong'
  | 'gyeonggi'
  | 'gangwon'
  | 'chungbuk'
  | 'chungnam'
  | 'jeonbuk'
  | 'jeonnam'
  | 'gyeongbuk'
  | 'gyeongnam'
  | 'jeju'

export type SuggestedPlace = {
  name: string
  address: string
}

const REGION_KEYWORDS: { id: RegionId; keys: string[] }[] = [
  { id: 'chungbuk', keys: ['충청북도', '충북'] },
  { id: 'chungnam', keys: ['충청남도', '충남'] },
  { id: 'jeonbuk', keys: ['전북특별자치도', '전라북도', '전북'] },
  { id: 'jeonnam', keys: ['전라남도', '전남'] },
  { id: 'gyeongbuk', keys: ['경상북도', '경북'] },
  { id: 'gyeongnam', keys: ['경상남도', '경남'] },
  { id: 'gangwon', keys: ['강원특별자치도', '강원도', '강원'] },
  { id: 'gyeonggi', keys: ['경기도', '경기'] },
  { id: 'sejong', keys: ['세종특별자치시', '세종시', '세종'] },
  { id: 'seoul', keys: ['서울특별시', '서울시', '서울'] },
  { id: 'busan', keys: ['부산광역시', '부산시', '부산'] },
  { id: 'incheon', keys: ['인천광역시', '인천시', '인천'] },
  { id: 'daegu', keys: ['대구광역시', '대구시', '대구'] },
  { id: 'daejeon', keys: ['대전광역시', '대전시', '대전'] },
  { id: 'gwangju', keys: ['광주광역시', '광주'] },
  { id: 'ulsan', keys: ['울산광역시', '울산시', '울산'] },
  { id: 'jeju', keys: ['제주특별자치도', '제주도', '제주시', '서귀포', '제주'] },
]

const REGION_CENTERS: { id: RegionId; lat: number; lng: number }[] = [
  { id: 'seoul', lat: 37.5665, lng: 126.978 },
  { id: 'incheon', lat: 37.4563, lng: 126.7052 },
  { id: 'gyeonggi', lat: 37.4138, lng: 127.5183 },
  { id: 'busan', lat: 35.1796, lng: 129.0756 },
  { id: 'daegu', lat: 35.8714, lng: 128.6014 },
  { id: 'daejeon', lat: 36.3504, lng: 127.3845 },
  { id: 'gwangju', lat: 35.1595, lng: 126.8526 },
  { id: 'ulsan', lat: 35.5384, lng: 129.3114 },
  { id: 'sejong', lat: 36.48, lng: 127.289 },
  { id: 'gangwon', lat: 37.8228, lng: 128.1555 },
  { id: 'chungbuk', lat: 36.6357, lng: 127.4912 },
  { id: 'chungnam', lat: 36.5184, lng: 126.8 },
  { id: 'jeonbuk', lat: 35.8204, lng: 127.1088 },
  { id: 'jeonnam', lat: 34.8161, lng: 126.4629 },
  { id: 'gyeongbuk', lat: 36.4919, lng: 128.8889 },
  { id: 'gyeongnam', lat: 35.4606, lng: 128.2132 },
  { id: 'jeju', lat: 33.4996, lng: 126.5312 },
]

export const REGION_DESTINATIONS: Record<RegionId, SuggestedPlace[]> = {
  seoul: [
    { name: '서울시청', address: '서울특별시 중구 세종대로 110' },
    { name: '서울역', address: '서울특별시 용산구 한강대로 405' },
    { name: '강남역', address: '서울특별시 강남구 강남대로 396' },
    { name: '명동', address: '서울특별시 중구 명동길 14' },
    { name: '홍대입구', address: '서울특별시 마포구 양화로 160' },
  ],
  busan: [
    { name: '부산시청', address: '부산광역시 연제구 중앙대로 1001' },
    { name: '부산역', address: '부산광역시 동구 중앙대로 206' },
    { name: '서면 롯데백화점', address: '부산광역시 부산진구 가야대로 772' },
    { name: '해운대 해수욕장', address: '부산광역시 해운대구 해운대해변로 264' },
    { name: '김해공항', address: '부산광역시 강서구 공항진입로 108' },
  ],
  incheon: [
    { name: '인천공항', address: '인천광역시 중구 공항로 272' },
    { name: '송도 센트럴파크', address: '인천광역시 연수구 컨벤시아대로 160' },
    { name: '부평역', address: '인천광역시 부평구 광장로 16' },
    { name: '인천시청', address: '인천광역시 남동구 정각로 29' },
  ],
  daegu: [
    { name: '대구시청', address: '대구광역시 중구 공평로 88' },
    { name: '대구역', address: '대구광역시 북구 칠성동2가 칠성남로30길 24' },
    { name: '동대구역', address: '대구광역시 동구 동대구로 550' },
    { name: '동성로', address: '대구광역시 중구 동성로 2' },
    { name: '수성못', address: '대구광역시 수성구 무학로 43' },
    { name: '대구공항', address: '대구광역시 동구 공항로 221' },
  ],
  daejeon: [
    { name: '대전시청', address: '대전광역시 서구 둔산로 100' },
    { name: '대전역', address: '대전광역시 동구 중앙로 215' },
    { name: '둔산 타임월드', address: '대전광역시 서구 둔산로 30' },
    { name: '유성온천', address: '대전광역시 유성구 온천로 87' },
    { name: '대전복합터미널', address: '대전광역시 동구 동서대로 1689' },
  ],
  gwangju: [
    { name: '광주광역시청', address: '광주광역시 서구 내방로 111' },
    { name: '광주송정역', address: '광주광역시 광산구 상무대로 201' },
    { name: '충장로', address: '광주광역시 동구 충장로 1' },
    { name: '상무지구', address: '광주광역시 서구 치평동 1171' },
    { name: '광주공항', address: '광주광역시 광산구 상무대로 420-25' },
  ],
  ulsan: [
    { name: '울산역', address: '울산광역시 울주군 삼남읍 울산역로 177' },
    { name: '성남동 젊음의거리', address: '울산광역시 중구 젊음의거리 30' },
    { name: '태화강국가정원', address: '울산광역시 중구 태화강국가정원길 154' },
    { name: '울산공항', address: '울산광역시 북구 산업로 1103' },
  ],
  sejong: [
    { name: '세종시청', address: '세종특별자치시 한누리대로 2130' },
    { name: '정부세종청사', address: '세종특별자치시 도움6로 11' },
    { name: '오송역', address: '충청북도 청주시 흥덕구 오송읍 오송가락로 123' },
    { name: '조치원역', address: '세종특별자치시 조치원읍 조치원로 50' },
  ],
  gyeonggi: [
    { name: '수원역', address: '경기도 수원시 팔달구 덕영대로 924' },
    { name: '판교역', address: '경기도 성남시 분당구 판교역로 160' },
    { name: '킨텍스', address: '경기도 고양시 일산서구 킨텍스로 217-60' },
    { name: '에버랜드', address: '경기도 용인시 처인구 포곡읍 에버랜드로 199' },
  ],
  gangwon: [
    { name: '강릉역', address: '강원특별자치도 강릉시 용지로 176' },
    { name: '속초해수욕장', address: '강원특별자치도 속초시 해오름로 186' },
    { name: '남이섬', address: '강원특별자치도 춘천시 남산면 남이섬길 1' },
    { name: '평창 알펜시아', address: '강원특별자치도 평창군 대관령면 솔봉로 325' },
  ],
  chungbuk: [
    { name: '청주 성안길', address: '충청북도 청주시 상당구 성안로 65' },
    { name: '오송역', address: '충청북도 청주시 흥덕구 오송읍 오송가락로 123' },
    { name: '충주호', address: '충청북도 충주시 충주호수로 400' },
    { name: '청주공항', address: '충청북도 청주시 청원구 내수읍 오창대로 980' },
  ],
  chungnam: [
    { name: '천안아산역', address: '충청남도 아산시 배방읍 희망로 100' },
    { name: '공주 공산성', address: '충청남도 공주시 웅진로 280' },
    { name: '대천해수욕장', address: '충청남도 보령시 대해로 876' },
    { name: '독립기념관', address: '충청남도 천안시 동남구 목천읍 독립기념관로 1' },
  ],
  jeonbuk: [
    { name: '전주 한옥마을', address: '전북특별자치도 전주시 완산구 기린대로 99' },
    { name: '전주역', address: '전북특별자치도 전주시 덕진구 동부대로 680' },
    { name: '익산역', address: '전북특별자치도 익산시 익산대로 153' },
    { name: '군산 은파호수공원', address: '전북특별자치도 군산시 백토로 455' },
  ],
  jeonnam: [
    { name: '여수엑스포역', address: '전라남도 여수시 망양로 2' },
    { name: '순천만국가정원', address: '전라남도 순천시 국가정원1호길 47' },
    { name: '목포역', address: '전라남도 목포시 영산로 201' },
    { name: '죽녹원', address: '전라남도 담양군 담양읍 죽녹원로 119' },
  ],
  gyeongbuk: [
    { name: '경주 불국사', address: '경상북도 경주시 불국로 385' },
    { name: '포항역', address: '경상북도 포항시 북구 흥해읍 포스코대로 160' },
    { name: '안동 하회마을', address: '경상북도 안동시 풍천면 전서로 186' },
    { name: '구미역', address: '경상북도 구미시 구미중앙로 76' },
  ],
  gyeongnam: [
    { name: '창원중앙역', address: '경상남도 창원시 의창구 창원대로 363' },
    { name: '진주성', address: '경상남도 진주시 남강로 626' },
    { name: '통영 동피랑', address: '경상남도 통영시 동피랑1길 17' },
    { name: '거제 외도', address: '경상남도 거제시 일운면 외도길 17' },
  ],
  jeju: [
    { name: '제주국제공항', address: '제주특별자치도 제주시 공항로 2' },
    { name: '서귀포 올레시장', address: '제주특별자치도 서귀포시 중정로 22' },
    { name: '성산일출봉', address: '제주특별자치도 서귀포시 성산읍 일출로 284-12' },
    { name: '중문관광단지', address: '제주특별자치도 서귀포시 중문관광로 224' },
  ],
}

const DEFAULT_REGION: RegionId = 'busan'

export function centerForRegion(id: RegionId) {
  return REGION_CENTERS.find((area) => area.id === id) ?? REGION_CENTERS.find((area) => area.id === 'busan') ?? REGION_CENTERS[0]
}

const ACCESS_REGION_ALIASES: { id: RegionId; pattern: RegExp }[] = [
  { id: 'busan', pattern: /부산|busan|pusan/i },
  { id: 'incheon', pattern: /인천|incheon/i },
  { id: 'daegu', pattern: /대구|daegu/i },
  { id: 'daejeon', pattern: /대전|daejeon/i },
  { id: 'gwangju', pattern: /광주|gwangju/i },
  { id: 'ulsan', pattern: /울산|ulsan/i },
  { id: 'sejong', pattern: /세종|sejong/i },
  { id: 'gyeonggi', pattern: /경기|gyeonggi|suwon|seongnam|bucheon|goyang|yongin/i },
  { id: 'gangwon', pattern: /강원|gangwon|gangneung|sokcho|chuncheon/i },
  { id: 'chungbuk', pattern: /충북|chungbuk|cheongju/i },
  { id: 'chungnam', pattern: /충남|chungnam|cheonan|asan/i },
  { id: 'jeonbuk', pattern: /전북|jeonbuk|jeonju/i },
  { id: 'jeonnam', pattern: /전남|jeonnam|yeosu|mokpo|suncheon/i },
  { id: 'gyeongbuk', pattern: /경북|gyeongbuk|pohang|gyeongju/i },
  { id: 'gyeongnam', pattern: /경남|gyeongnam|changwon|gimhae|jinju/i },
  { id: 'jeju', pattern: /제주|jeju/i },
  { id: 'seoul', pattern: /서울|seoul/i },
]

export function regionFromAccessText(city?: string, region?: string, country?: string): RegionId {
  const text = `${city || ''} ${region || ''} ${country || ''}`.trim()
  const fromAddress = regionFromAddress(text)
  if (fromAddress) return fromAddress
  for (const item of ACCESS_REGION_ALIASES) {
    if (item.pattern.test(text)) return item.id
  }
  return DEFAULT_REGION
}

export const REGION_DISPLAY: Record<RegionId, string> = {
  seoul: '서울특별시',
  busan: '부산광역시',
  incheon: '인천광역시',
  daegu: '대구광역시',
  daejeon: '대전광역시',
  gwangju: '광주광역시',
  ulsan: '울산광역시',
  sejong: '세종특별자치시',
  gyeonggi: '경기도',
  gangwon: '강원특별자치도',
  chungbuk: '충청북도',
  chungnam: '충청남도',
  jeonbuk: '전북특별자치도',
  jeonnam: '전라남도',
  gyeongbuk: '경상북도',
  gyeongnam: '경상남도',
  jeju: '제주특별자치도',
}

function regionFromAddress(address: string): RegionId | null {
  const text = address.replace(/\s+/g, '')
  if (!text) return null
  for (const { id, keys } of REGION_KEYWORDS) {
    if (keys.some((key) => text.includes(key.replace(/\s+/g, '')))) return id
  }
  return null
}

function regionFromCoords(lat: number, lng: number): RegionId {
  return REGION_CENTERS.reduce((best, area) => {
    const distance = (area.lat - lat) ** 2 + (area.lng - lng) ** 2
    return distance < best.distance ? { id: area.id, distance } : best
  }, { id: DEFAULT_REGION, distance: Number.POSITIVE_INFINITY }).id
}

export function inferRegion(address: string, lat?: number, lng?: number): RegionId | null {
  const fromAddress = regionFromAddress(address)
  if (fromAddress) return fromAddress
  if (Number.isFinite(lat) && Number.isFinite(lng)) return regionFromCoords(lat as number, lng as number)
  return null
}

export function regionFromQuery(text: string): RegionId | null {
  return regionFromAddress(text)
}

export function regionDisplayName(id: RegionId) {
  return REGION_DISPLAY[id]
}

export function resolveRegion(address: string, lat?: number, lng?: number): RegionId {
  const fromAddress = regionFromAddress(address)
  if (fromAddress) return fromAddress
  if (Number.isFinite(lat) && Number.isFinite(lng)) return regionFromCoords(lat as number, lng as number)
  return DEFAULT_REGION
}

export function suggestedDestinationsFor(address: string, lat?: number, lng?: number): SuggestedPlace[] {
  return REGION_DESTINATIONS[resolveRegion(address, lat, lng)]
}

const PLACE_COORDS: Record<string, { lat: number; lng: number }> = {
  서울시청: { lat: 37.566395, lng: 126.977952 },
  서울역: { lat: 37.554678, lng: 126.970606 },
  강남역: { lat: 37.497952, lng: 127.027619 },
  명동: { lat: 37.563768, lng: 126.985226 },
  홍대입구: { lat: 37.557192, lng: 126.925381 },
  부산시청: { lat: 35.179554, lng: 129.075641 },
  부산역: { lat: 35.115226, lng: 129.041517 },
  '서면 롯데백화점': { lat: 35.157268, lng: 129.057396 },
  '해운대 해수욕장': { lat: 35.158698, lng: 129.160384 },
  김해공항: { lat: 35.179558, lng: 128.938241 },
  인천공항: { lat: 37.460192, lng: 126.440696 },
  '송도 센트럴파크': { lat: 37.3925, lng: 126.6395 },
  부평역: { lat: 37.489467, lng: 126.724559 },
  인천시청: { lat: 37.456256, lng: 126.705206 },
  대구시청: { lat: 35.87139, lng: 128.601445 },
  대구광역시청: { lat: 35.87139, lng: 128.601445 },
  대구역: { lat: 35.876282, lng: 128.597118 },
  동대구역: { lat: 35.879729, lng: 128.628359 },
  동성로: { lat: 35.869558, lng: 128.595926 },
  수성못: { lat: 35.82885, lng: 128.6218 },
  대구공항: { lat: 35.894108, lng: 128.658862 },
  대전시청: { lat: 36.350412, lng: 127.384548 },
  대전역: { lat: 36.332363, lng: 127.434217 },
  '둔산 타임월드': { lat: 36.351848, lng: 127.377751 },
  유성온천: { lat: 36.3548, lng: 127.345 },
  대전복합터미널: { lat: 36.351, lng: 127.437 },
  광주광역시청: { lat: 35.159545, lng: 126.852601 },
  광주송정역: { lat: 35.137577, lng: 126.790508 },
  충장로: { lat: 35.149, lng: 126.913 },
  상무지구: { lat: 35.152, lng: 126.85 },
  광주공항: { lat: 35.1264, lng: 126.8086 },
  울산역: { lat: 35.5514, lng: 129.1386 },
  '성남동 젊음의거리': { lat: 35.553, lng: 129.32 },
  태화강국가정원: { lat: 35.548, lng: 129.296 },
  울산공항: { lat: 35.5933, lng: 129.3515 },
  세종시청: { lat: 36.48, lng: 127.289 },
  정부세종청사: { lat: 36.504, lng: 127.265 },
  오송역: { lat: 36.6205, lng: 127.327 },
  조치원역: { lat: 36.601, lng: 127.296 },
  수원역: { lat: 37.2658, lng: 126.9999 },
  판교역: { lat: 37.394761, lng: 127.111217 },
  킨텍스: { lat: 37.6688, lng: 126.7452 },
  에버랜드: { lat: 37.294, lng: 127.202 },
  강릉역: { lat: 37.764, lng: 128.899 },
  속초해수욕장: { lat: 38.19, lng: 128.604 },
  남이섬: { lat: 37.791, lng: 127.526 },
  '평창 알펜시아': { lat: 37.658, lng: 128.67 },
  '청주 성안길': { lat: 36.6357, lng: 127.489 },
  충주호: { lat: 36.99, lng: 127.99 },
  청주공항: { lat: 36.7166, lng: 127.4991 },
  천안아산역: { lat: 36.7944, lng: 127.1045 },
  '공주 공산성': { lat: 36.463, lng: 127.126 },
  대천해수욕장: { lat: 36.31, lng: 126.514 },
  독립기념관: { lat: 36.783, lng: 127.223 },
  '전주 한옥마을': { lat: 35.8154, lng: 127.153 },
  전주역: { lat: 35.8498, lng: 127.161 },
  익산역: { lat: 35.941, lng: 126.954 },
  '군산 은파호수공원': { lat: 35.965, lng: 126.737 },
  여수엑스포역: { lat: 34.751, lng: 127.746 },
  순천만국가정원: { lat: 34.928, lng: 127.509 },
  목포역: { lat: 34.791, lng: 126.387 },
  죽녹원: { lat: 35.325, lng: 126.986 },
  '경주 불국사': { lat: 35.79, lng: 129.332 },
  포항역: { lat: 36.071, lng: 129.343 },
  '안동 하회마을': { lat: 36.539, lng: 128.518 },
  구미역: { lat: 36.128, lng: 128.331 },
  창원중앙역: { lat: 35.221, lng: 128.675 },
  진주성: { lat: 35.19, lng: 128.077 },
  '통영 동피랑': { lat: 34.845, lng: 128.424 },
  '거제 외도': { lat: 34.769, lng: 128.71 },
  제주국제공항: { lat: 33.5113, lng: 126.492 },
  '서귀포 올레시장': { lat: 33.248, lng: 126.564 },
  성산일출봉: { lat: 33.458, lng: 126.942 },
  중문관광단지: { lat: 33.25, lng: 126.412 },
}

export function lookupSuggestedPlace(query: string) {
  const q = query.trim()
  if (!q) return null
  const compact = q.replace(/\s+/g, '')
  const ranked: Array<{ name: string; address: string; lat: number; lng: number; score: number }> = []
  for (const list of Object.values(REGION_DESTINATIONS)) {
    for (const place of list) {
      const name = place.name.replace(/\s+/g, '')
      let score = 0
      if (place.name === q || place.address === q) score = 100
      else if (name === compact) score = 90
      else if (compact.length >= 2 && (name.startsWith(compact) || compact.startsWith(name) && name.length >= 4)) score = 70
      if (!score) continue
      const coords = PLACE_COORDS[place.name] || centerForRegion(resolveRegion(place.address))
      ranked.push({ ...place, ...coords, score })
    }
  }
  const coords = PLACE_COORDS[q] || PLACE_COORDS[compact]
  if (coords) {
    const known = ranked.find((item) => item.lat === coords.lat && item.lng === coords.lng)
    ranked.push({ name: q, address: known?.address || q, ...coords, score: 80 })
  }
  ranked.sort((a, b) => b.score - a.score)
  const hit = ranked[0]
  return hit ? { name: hit.name, address: hit.address, lat: hit.lat, lng: hit.lng } : null
}
