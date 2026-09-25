# Architecture

A short tour of how this app is put together and, more importantly, why.

---

## 1. The shape of it

```
Your phone / laptop
        |
        |  (1) HTML + JSON over HTTPS
        v
Next.js on Vercel  ---- (2) SQL over HTTPS ---->  Supabase Postgres
   (App Router)    ---- (3) signs URLs      ---->  Supabase Storage (private)
        ^
        |  (4) image bytes go straight from the browser to Storage,
        |      never through Vercel
        v
   Supabase Storage
```

Four things are worth calling out:

1. **Every page is server-rendered per request.** Nothing about your album is
   ever cached in a CDN or baked into a static file.
2. **The browser never talks to the database without a session.** Row Level
   Security is applied inside Postgres, so even a stolen anon key is useless.
3. **Photos are never public.** The storage bucket is private. The server mints
   a signed link that expires in two hours, per request, per photo.
4. **Uploads bypass our server entirely.** The browser compresses the image and
   sends it straight to Supabase Storage. Vercel's bandwidth bill stays near
   zero, and uploads are faster.

## 2. Why Supabase, and why this little

| Need | Chosen | Why not something else |
|---|---|---|
| Auth | Supabase Auth (email + password) | No OAuth setup, no email server to run, and sign-up can simply be switched off. |
| Database | Supabase Postgres | Real RLS. The security rule lives next to the data instead of in app code you could forget to call. |
| Files | Supabase Storage, private bucket | Signed URLs out of the box. No S3 policy wrangling. |
| Resizing | `browser-image-compression`, in the browser | Server-side resizing (`sharp`) would mean every byte passes through Vercel twice. Supabase's own image transforms are a paid add-on. |
| State | Server Components + Server Actions | No React Query, no Redux, no API layer to maintain. |

There is no ORM, no auth library, no component library and no state manager.
For two people and a few thousand photos, they would all be weight without
benefit.

## 3. Data model

```
auth.users                         (managed by Supabase)
    |
    | 1:1
    v
allowed_users  ───────┐            the allow list — the real gate
  user_id (PK, FK)    │
  display_name        │
                      │
photos  <─────────────┘            uploader_id -> allowed_users.user_id
  id (PK)
  uploader_id (FK)
  storage_path        ← "photos/<user-id>/<uuid>.jpg"
  thumb_path          ← "thumbs/<user-id>/<uuid>.jpg"
  caption
  memory_date         ← when it *happened*
  is_special
  width, height, size_bytes, original_name
  created_at          ← when it was *uploaded*
  updated_at
    ^
    | 1:many
favorites                          a heart is per person
  photo_id (PK, FK)
  user_id  (PK, FK)

app_settings                       key/value, so nothing is hardcoded
  key (PK)   → relationship_start_date | home_title | home_quote
  value
```

Two deliberate choices:

- **`memory_date` is separate from `created_at`.** You can upload a photo from
  2019 today, and the timeline still puts it in 2019.
- **Favorites are per person, not shared.** The Favorites page shows both
  sets, and the viewer tells you who loved what.

## 4. Storage layout

```
memories/                      (bucket, public = false)
├── photos/<user-id>/<uuid>.jpg     full size, longest edge 2048px, ~1.6MB max
└── thumbs/<user-id>/<uuid>.jpg     thumbnail, longest edge 640px, ~120KB max
```

The gallery only ever loads thumbnails. The full image is fetched when you
open the lightbox. On a phone this is the difference between a grid that loads
instantly and one that eats your data plan.

Folders are named by uploader purely for tidiness — both of you can read,
edit and delete everything, exactly as asked.

## 5. Security, layer by layer

Four independent layers. Any one of them alone would stop an intruder; all
four have to fail at once for a photo to leak.

| Layer | What it does |
|---|---|
| **Middleware** (`src/middleware.ts`) | Runs before every route. No session → redirect to `/login`. Uses `getUser()`, which revalidates the token with Supabase, not `getSession()`, which only reads a cookie. |
| **Layout guard** (`src/app/(app)/layout.tsx`) | Confirms the account appears in `allowed_users` before rendering. A valid login that is not on the list gets nothing. |
| **Row Level Security** (`supabase/schema.sql`) | Every table and every storage object is gated on `public.is_allowed()`. This is enforced inside Postgres, so it holds even if the app code is wrong. |
| **Private storage** | The bucket is not public. URLs are signed, expire in two hours, and are minted per request on the server. |

`allowed_users` has **no INSERT policy and no DELETE policy**. Nobody can add
themselves to the album, not even through a bug in the app. The only way in is
for you to add a row from the Supabase dashboard.

Sign-up is also disabled in the Supabase dashboard, so `/auth/v1/signup` fails
before it ever reaches the database.

## 6. Pages

| Route | What's on it |
|---|---|
| `/login` | The only page reachable without a session. |
| `/` | Hero, days-together counter, stats, special moments, recent photos, favorites. |
| `/gallery` | Everything, as a grid. Sort by memory date or upload date, or show special only. |
| `/timeline` | Grouped into month sections, then day sub-sections, with year/month filters. |
| `/favorites` | Every photo either of you hearted. |
| `/upload` | Multi-file picker, shared or per-photo captions, date, special toggle. |
| `/settings` | Start date, album title, homepage words, your name, password, sign out. |
| `/api/download/[id]` | Checks the session, then redirects to a 60-second download link. |

## 7. Request flow for a single photo

```
GET /gallery
  → middleware: getUser() → ok, session is valid
  → (app)/layout: is this user in allowed_users? → yes
  → gallery/page.tsx: getPhotos({ limit: 48 })
        SELECT ... FROM photos          (RLS: is_allowed() must be true)
        SELECT ... FROM favorites       (RLS: same)
        createSignedUrls([...96 paths]) (one batched call, 2h expiry)
  → HTML streams back with signed thumbnail URLs already embedded
  → browser loads thumbnails straight from Supabase
```

Opening the lightbox uses the full-size URL that was already signed in the
same batch, so there is no extra round trip.
