'use client'

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
  user: { username: string }
}

const LOCAL_TEST_USER = { username: 'local-test-user' }

export function usePiAuth(): PiAuthState {
  return {
    sdk: null,
    products: [],
    restoredPurchases: null,
    user: LOCAL_TEST_USER,
  }
}
