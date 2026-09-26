import { redirect } from 'next/navigation';

import PageHeading from '@/components/PageHeading';
import ReelsClient from '@/components/ReelsClient';
import { getReels, getViewer } from '@/lib/photos';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Clips' };

export default async function ReelsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  const reels = await getReels(24);

  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Clips"
        title="Our little films"
        hint="Short videos of the two of us. Up to 45 seconds each."
      />
      <ReelsClient initialReels={reels} userId={viewer.id} />
    </div>
  );
}
