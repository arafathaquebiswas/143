import { redirect } from 'next/navigation';

import UploadClient from '@/components/UploadClient';
import { getViewer } from '@/lib/photos';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Upload' };

export default async function UploadPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl sm:text-4xl">Add a memory</h1>
        <p className="mt-1.5 text-sm text-muted">
          Everything you add is saved as {viewer.displayName}, and only the two of you can ever
          see it.
        </p>
      </header>

      <UploadClient userId={viewer.id} />
    </div>
  );
}
