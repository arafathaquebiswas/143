import PhotoBrowser from '@/components/PhotoBrowser';
import PageHeading from '@/components/PageHeading';
import { PAGE_SIZE } from '@/lib/constants';
import { getPhotos } from '@/lib/photos';
import type { PhotoFilter } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Favorites' };

export default async function FavoritesPage() {
  const filter: PhotoFilter = { favoritesOnly: true, sort: 'memory', limit: PAGE_SIZE };
  const photos = await getPhotos(filter);

  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Loved"
        title="Our favourites"
        hint="Every photo either of us hearted. Open one to see who loved it."
      />

      <PhotoBrowser
        initialPhotos={photos}
        filter={filter}
        layout="masonry"
        loadMore
        emptyTitle="No favourites yet"
        emptyHint="Tap the heart on any photo — or double-tap the photo itself — and it will land here."
      />
    </div>
  );
}
