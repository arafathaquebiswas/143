import { redirect } from 'next/navigation';

import SettingsForm from '@/components/SettingsForm';
import { getSettings, getViewer } from '@/lib/photos';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  const settings = await getSettings();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="font-display text-3xl sm:text-4xl">Settings</h1>
        <p className="mt-1.5 text-sm text-muted">
          {viewer.partner
            ? `It is just you and ${viewer.partner.display_name} in here.`
            : 'It is just you in here for now.'}
        </p>
      </header>

      <SettingsForm
        settings={settings}
        displayName={viewer.displayName}
        email={viewer.email}
      />
    </div>
  );
}
