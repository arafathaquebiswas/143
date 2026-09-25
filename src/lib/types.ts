/** A row exactly as it is stored in public.photos. */
export type PhotoRow = {
  id: string;
  uploader_id: string;
  storage_path: string;
  thumb_path: string;
  caption: string | null;
  memory_date: string; // yyyy-MM-dd
  is_special: boolean;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  original_name: string | null;
  created_at: string;
  updated_at: string;
};

/** One comment on a photo. */
export type PhotoComment = {
  id: string;
  photo_id: string;
  author_id: string;
  /** Display name of whoever wrote it. */
  authorName: string;
  body: string;
  created_at: string;
  /** Whether the person viewing wrote it — only they may edit or remove it. */
  isMine: boolean;
};

/** A photo enriched with everything the UI needs to render it. */
export type Photo = PhotoRow & {
  uploaderName: string;
  /** Short-lived signed link to the full-size image. */
  url: string;
  /** Short-lived signed link to the small gallery thumbnail. */
  thumbUrl: string;
  /** Display names of everyone who hearted this photo. */
  favoritedBy: string[];
  /** Whether the person currently looking at the page hearted it. */
  isFavorite: boolean;
  /** Comments on this photo, oldest first. */
  comments: PhotoComment[];
};

export type Person = {
  user_id: string;
  display_name: string;
};

export type AppSettings = {
  relationship_start_date: string;
  home_title: string;
  home_quote: string;
};

export type PhotoFilter = {
  year?: number;
  month?: number; // 1-12
  specialOnly?: boolean;
  favoritesOnly?: boolean;
  /** 'memory' sorts by when it happened, 'created' by when it was uploaded. */
  sort?: 'memory' | 'created';
  limit?: number;
  offset?: number;
};
