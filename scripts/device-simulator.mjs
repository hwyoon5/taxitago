// 기기 GPS 실시간 시뮬레이터 — /api/devices/location-update로 5초마다 위치를 보낸다.
// 사용법:
//   node scripts/device-simulator.mjs                       → localhost:3000
//   SERVER_URL=https://test.example.com node scripts/device-simulator.mjs
//   DEVICE_KEY=<DEVICE_INGEST_TOKEN> node scripts/device-simulator.mjs  (서버가 토큰을 요구하는 경우)

const SERVER_URL = (process.env.SERVER_URL || 'http://localhost:3000') + '/api/devices/location-update'
const DEVICE_KEY = process.env.DEVICE_KEY || ''

// 테스트할 가상 기기 리스트 (ID와 초기 위치 - 부산역/서면 등)
const devices = [
  { deviceId: 'BK-2048', type: 'bicycle', lat: 35.1150, lng: 129.0422, battery: 85 },
  { deviceId: 'KB-1012', type: 'kickboard', lat: 35.1578, lng: 129.0591, battery: 92 },
]

async function sendLocationUpdate() {
  for (const device of devices) {
    // 좌표를 살짝씩 움직여서 이동하는 것처럼 시뮬레이션
    device.lat += (Math.random() - 0.5) * 0.001
    device.lng += (Math.random() - 0.5) * 0.001
    // 배터리 미세 소모
    device.battery = Math.max(10, device.battery - 0.1)

    try {
      const response = await fetch(SERVER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(DEVICE_KEY ? { 'x-device-key': DEVICE_KEY } : {}),
        },
        body: JSON.stringify({
          deviceId: device.deviceId,
          type: device.type,
          latitude: device.lat,
          longitude: device.lng,
          batteryLevel: Math.round(device.battery),
          status: 'active',
          timestamp: new Date().toISOString(),
        }),
      })
      if (response.ok) {
        console.log(`[성공] 기기 ${device.deviceId} 위치 전송 완료: (${device.lat.toFixed(4)}, ${device.lng.toFixed(4)})`)
      } else {
        const text = await response.text().catch(() => '')
        console.error(`[실패] 기기 ${device.deviceId} HTTP ${response.status}: ${text}`)
      }
    } catch (error) {
      console.error(`[실패] 기기 ${device.deviceId} 통신 오류:`, error.message)
    }
  }
}

console.log('🚀 기기 GPS 실시간 시뮬레이터 시작 (5초 주기)...')
console.log(`   → ${SERVER_URL}`)
setInterval(sendLocationUpdate, 5000)
void sendLocationUpdate()
