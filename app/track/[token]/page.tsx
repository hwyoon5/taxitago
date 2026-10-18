import RideTrackPage from '@/components/ride-track-page'

export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <RideTrackPage token={token} />
}
