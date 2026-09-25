import PhotoBrowser from '@/components/PhotoBrowser';
import { HeartIcon } from '@/components/icons';
import { PAGE_SIZE } from '@/lib/constants';
import { getPhotos } from '@/lib/photos';
import type { PhotoFilter } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Favorites' };

export default async function FavoritesPage() {
  const filter: PhotoFilter = { favoritesOnly: true, sort: 'memory', limit: PAGE_SIZE };
  const photos = await getPhotos(filter);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2.5 font-display text-3xl sm:text-4xl">
          <span className="text-accent">
            <HeartIcon filled width={26} height={26} />
          </span>
          Favorites
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          Every photo either of us hearted. Open one to see who loved it.
        </p>
      </header>

      <PhotoBrowser
        initialPhotos={photos}
        filter={filter}
        layout="grid"
        loadMore
        emptyTitle="No favorites yet"
        emptyHint="Tap the heart on any photo — or double-tap the photo itself — and it will land here."
      />
    </div>
  );
}
