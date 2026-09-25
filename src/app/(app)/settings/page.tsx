import { redirect } from 'next/navigation';

import SettingsForm from '@/components/SettingsForm';
import PageHeading from '@/components/PageHeading';
import { getSettings, getViewer } from '@/lib/photos';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  const settings = await getSettings();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeading
        eyebrow="Just the two of you"
        title="Settings"
        hint={
          viewer.partner
            ? `You and ${viewer.partner.display_name} share this album.`
            : 'It is just you in here for now.'
        }
      />
      <SettingsForm settings={settings} displayName={viewer.displayName} email={viewer.email} />
    </div>
  );
}
