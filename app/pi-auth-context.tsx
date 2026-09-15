'use client'

import { useEffect, useState } from 'react'

type PiProduct = {
  id: string
  slug: string
  name: string
  price_in_pi: number
}

type RestoredPurchases = {
  purchases?: Array<{ productId: string; quantity: number }>
}

type PiSdk = {
  makePurchase: (slug: string) => Promise<{
    ok: boolean
    productId?: string
    txid?: string
  }>
  state?: {
    consume?: (slug: string, quantity: number) => Promise<unknown>
  }
}

type PiAuthState = {
  sdk: PiSdk | null
  products: PiProduct[]
  restoredPurchases: RestoredPurchases | null
} | null

declare global {
  interface Window {
    SDKLite?: {
      init: () => Promise<PiSdk & { products?: PiProduct[]; restoredPurchases?: RestoredPurchases | null }>
    }
  }
}

export function usePiAuth(): PiAuthState {
  const [state, setState] = useState<PiAuthState | null>(null)

  useEffect(() => {
    let active = true

    async function initializePi() {
      let retries = 0
      // SDK가 주입될 때까지 최대 3초(10번) 대기
      while (!window.SDKLite && retries < 10) {
        await new Promise((r) => setTimeout(r, 300))
        retries++
      }

      try {
        if (window.SDKLite) {
          const sdk = await window.SDKLite.init()
          if (active) {
            setState({
              sdk,
              products: sdk.products ?? [],
              restoredPurchases: sdk.restoredPurchases ?? null,
            })
            return
          }
        }
      } catch (e) {
        console.error("Pi SDK init error:", e)
      }

      // SDK 로드 실패나 타임아웃 시에도 무한로딩을 깨고 화면을 띄움
      if (active) {
        setState({
          sdk: null,
          products: [],
          restoredPurchases: null,
        })
      }
    }

    initializePi()

    return () => {
      active = false
    }
  }, [])

  return state
}