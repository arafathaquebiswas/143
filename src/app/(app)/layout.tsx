import { redirect } from 'next/navigation';

import Nav from '@/components/Nav';
import { getSettings, getViewer } from '@/lib/photos';

/**
 * The gate for every signed-in page. The middleware already turned away
 * anyone without a session; this makes sure the account is on the allow list
 * too, before a single photo is fetched.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  const settings = await getSettings();

  return (
    <div className="min-h-dvh">
      <Nav title={settings.home_title} name={viewer.displayName} />
      <main className="mx-auto w-full max-w-6xl px-5 pb-32 pt-8 sm:px-8 sm:pt-12 min-[1200px]:pb-20">
        {children}
      </main>
    </div>
  );
}
