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
    paymentId?: string
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
}

declare global {
  interface Window {
    SDKLite?: {
      init: () => Promise<PiSdk & {
        products?: PiProduct[]
        restoredPurchases?: RestoredPurchases
      }>
    }
  }
}

export function usePiAuth(): PiAuthState | null {
  const [state, setState] = useState<PiAuthState | null>(null)

  useEffect(() => {
    let active = true

    async function initializePi() {
      if (!window.SDKLite) return
      try {
        const sdk = await window.SDKLite.init()
        if (active) {
          setState({
            sdk,
            products: sdk.products ?? [],
            restoredPurchases: sdk.restoredPurchases ?? null,
          })
        }
      } catch {
        if (active) setState(null)
      }
    }

    initializePi()
    return () => {
      active = false
    }
  }, [])

  return state
}
