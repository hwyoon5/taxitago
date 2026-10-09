import ManualPayCheckout from '@/components/manual-pay-checkout'

export default async function ManualPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ManualPayCheckout manualId={id} />
}
