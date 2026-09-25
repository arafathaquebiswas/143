import { redirect } from 'next/navigation';

import UploadClient from '@/components/UploadClient';
import PageHeading from '@/components/PageHeading';
import { getViewer } from '@/lib/photos';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Upload' };

export default async function UploadPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Add to our album"
        title="A new memory"
        hint={`Saved as ${viewer.displayName}. Only the two of us can ever see it.`}
      />
      <UploadClient userId={viewer.id} />
    </div>
  );
}
