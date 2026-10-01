import { handlePiApprove } from '@/lib/pi-payment-handlers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const POST = handlePiApprove
