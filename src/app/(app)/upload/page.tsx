import { redirect } from 'next/navigation';

import UploadClient from '@/components/UploadClient';
import PageHeading from '@/components/PageHeading';
import { getPhotos, getViewer } from '@/lib/photos';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Upload' };

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<{ recreate?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  const { recreate } = await searchParams;

  // When recreating, look up the inspiration so we can name it on the page.
  let recreateCaption: string | null = null;
  if (recreate) {
    const [inspiration] = await getPhotos({ collection: 'inspiration', limit: 200 })
      .then((rows) => rows.filter((r) => r.id === recreate));
    recreateCaption = inspiration?.caption ?? null;
  }

  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Add to our album"
        title="A new memory"
        hint={`Saved as ${viewer.displayName}. Only the two of us can ever see it.`}
      />
      <UploadClient userId={viewer.id} recreateFor={recreate} recreateCaption={recreateCaption} />
    </div>
  );
}
