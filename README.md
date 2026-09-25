# Our Little World

A private photo album for two people. No sign-up, no feed, no strangers —
just the two of you and everything you have saved together.

Built with **Next.js 15**, **TypeScript**, **Tailwind CSS 4** and **Supabase**.
See [ARCHITECTURE.md](./ARCHITECTURE.md) for how it works and why.

---

## What it does

- **Two accounts only.** Sign-up is off, and the database refuses anyone who is
  not on a hand-written allow list.
- **Private photos.** The storage bucket is not public. Images are served
  through links that expire after two hours.
- **Upload many at once**, with a caption, the date the memory happened, and an
  optional "special" mark. Photos are resized on your phone before they upload.
- **Gallery** with a full-screen viewer — arrow keys, swipe, previous/next
  without closing.
- **Timeline** grouped by month and day, filterable by year and month.
- **Favorites** — you each keep your own hearts, and the viewer shows who
  loved what.
- **Edit and delete** any photo, either of you.
- **Download** any photo to your phone or computer.
- **Days together** counter, with a start date you set in Settings.
- **Light and dark mode**, and a layout built for phones first.

---

# Setup, start to finish

Roughly 20 minutes. You need a [Supabase](https://supabase.com) account and a
[Vercel](https://vercel.com) account. Both are free at this size.

## 1. Create the Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and click
   **New project**.
2. Fill in:
   - **Name** — anything, e.g. `our-little-world`
   - **Database Password** — generate one and save it in your password manager
   - **Region** — whichever is closest to the two of you
3. Click **Create new project** and wait about two minutes.

## 2. Set up the database

1. In the left sidebar open **SQL Editor** → **New query**.
2. Open [`supabase/schema.sql`](./supabase/schema.sql) from this project, copy
   **all** of it, and paste it in.
3. Click **Run**.

You should see `Success. No rows returned`. That one script creates every
table, every security policy, and the private storage bucket. It is safe to run
again later if you ever need to.

## 3. Check the private photo storage

The script in step 2 already created the bucket. Confirm it:

1. Sidebar → **Storage**.
2. You should see a bucket named **memories**, marked **Private**.

If it says Public, something went wrong — re-run the schema.

> The bucket has a 25 MB per-file ceiling and only accepts image types. The app
> compresses photos to roughly 1.6 MB before uploading, so you will never get
> near that.

## 4. Create your two accounts

**First, close the door behind you.**

1. Sidebar → **Authentication** → **Sign In / Providers**.
2. Find **Email**. Turn **off** "Allow new users to sign up"
   (older dashboards call this **Enable sign ups**).
3. Turn **off** "Confirm email" as well — with only two hand-made accounts
   there is nothing to confirm, and it saves you setting up an email sender.
4. **Save**.

**Now create the two users.**

5. Sidebar → **Authentication** → **Users** → **Add user** → **Create new user**.
6. Enter your email and a strong password. Tick **Auto Confirm User**. Create.
7. Do it again for your girlfriend.

**Finally, put both of you on the allow list.** Being able to log in is not
enough — the app also checks this table.

> **Quicker alternative to steps 5–7 above.** If you do
> [step 5](#5-configure-environment-variables) first (including the
> `service_role` key in `.env.backup.local`), one command creates the login
> *and* adds it to the allow list:
>
> ```bash
> npm run add-user -- you@example.com "Your Name"
> npm run add-user -- her@example.com "Her Name"
> ```
>
> It asks for a password without showing it on screen, or generates a strong
> one if you just press Enter. Re-running it is safe.

Otherwise, do it by hand. Sidebar → **SQL Editor** → **New query**. Change the
four values, then Run:

```sql
insert into public.allowed_users (user_id, display_name)
select id, 'Your Name' from auth.users where email = 'you@example.com'
on conflict (user_id) do update set display_name = excluded.display_name;

insert into public.allowed_users (user_id, display_name)
select id, 'Her Name' from auth.users where email = 'her@example.com'
on conflict (user_id) do update set display_name = excluded.display_name;
```

Check it worked:

```sql
select display_name, user_id from public.allowed_users;
```

You should see exactly two rows. **Anyone not in this table can log in and
still see absolutely nothing** — no photos, no captions, not even the count.

## 5. Configure environment variables

1. Sidebar → **Project Settings** → **API**.
2. Copy the **Project URL** and the **anon public** key (newer dashboards label
   it **publishable key** — same thing).
3. In the project folder:

```bash
cp .env.local.example .env.local
```

4. Open `.env.local` and paste them in:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://yourprojectref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Both variables are safe in the browser — every table and file is protected by
Row Level Security, so the key on its own grants nothing.

> **Never** put the `service_role` key in `.env.local`. It bypasses all
> security, and everything in `.env.local` is shipped to the browser.

**Optional but recommended — the admin key, kept separately.** The `add-user`,
`doctor` and `backup` scripts need it. It never leaves your machine.

```bash
cp .env.local .env.backup.local
```

Then add one more line to `.env.backup.local` (Supabase → Project Settings →
API → **service_role**, click to reveal):

```bash
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

`.env.backup.local` is git-ignored. Keep that key off GitHub and out of Vercel.

## 6. Run it on your computer

**First, check everything so far is right:**

```bash
npm install
npm run doctor
```

`doctor` walks through steps 1–5 in order and tells you exactly what to fix if
anything is off. It also proves the important thing: that a signed-out visitor
cannot read a single row. Keep running it until everything passes.

**Then start it:**

```bash
npm run dev
```

Open <http://localhost:3000>. You will land on the login page — there is no way
past it. Sign in with the account you made in step 4.

Try uploading a few photos. If they appear in the gallery, everything is wired
up correctly.

## 7. Deploy to Vercel

**Push to a private GitHub repository first.**

```bash
git init
git add .
git commit -m "Our little world"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

Make the repository **private**. `.env.local` is already git-ignored, so your
keys stay out of it.

**Then deploy.**

1. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
2. Vercel detects Next.js by itself — change nothing.
3. Expand **Environment Variables** and add both:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Click **Deploy** and wait a minute or two.

**Then tell Supabase about the new address.**

5. Supabase → **Authentication** → **URL Configuration**.
6. Set **Site URL** to your Vercel URL, e.g. `https://our-little-world.vercel.app`.
7. Under **Redirect URLs**, add the same address followed by `/**`.

Every push to `main` now redeploys automatically.

### Deploying on Hostinger instead

Vercel is the better fit here — it is free at this size, needs no
configuration, and this app is built for its runtime. But Hostinger works if
you would rather keep everything in one place. You need a plan with **Node.js
support** (Business/Cloud hosting or a VPS); the cheaper shared-PHP plans
cannot run Next.js.

1. hPanel → **Websites** → your site → **Node.js**.
2. Create an application:
   - **Node version**: 20 or newer
   - **Application root**: where you upload the project
   - **Startup file**: `node_modules/next/dist/bin/next` with argument `start`
     (or add `"start": "next start -p $PORT"` to `package.json`)
3. Add the two `NEXT_PUBLIC_*` variables in the Node.js **Environment
   Variables** panel.
4. Upload the project (Git deploy or File Manager), then run `npm install` and
   `npm run build` from the panel's terminal.
5. Restart the application.
6. Add the Hostinger URL to Supabase → Authentication → URL Configuration, as
   in step 7.

> Because `NEXT_PUBLIC_*` variables are baked in at build time, you must
> rebuild after changing them — on Hostinger and on Vercel alike.

## 8. Using your own domain later

Nothing in the app hardcodes a URL, so this can be done any time.

**On Vercel:**

1. Project → **Settings** → **Domains** → enter your domain → **Add**.
2. Vercel shows the exact DNS records to create. At your registrar, add them:
   - Root domain (`ourlittleworld.com`) needs an **A** record to `76.76.21.21`
   - Subdomain (`www` or `us`) needs a **CNAME** to `cname.vercel-dns.com`
   - *Use whatever values Vercel shows you — they can change.*
3. Wait for DNS to propagate (minutes to a few hours). HTTPS is issued
   automatically and free.

**Then update Supabase** → Authentication → URL Configuration:

- **Site URL** → `https://ourlittleworld.com`
- **Redirect URLs** → add `https://ourlittleworld.com/**`

Leave the old Vercel URL in the redirect list if you still want it to work.

## 9. Backing up your photos and data

Your memories should exist in more than one place. This project includes a
script that pulls down a complete copy — every image file plus every database
row.

This needs `SUPABASE_SERVICE_ROLE_KEY` in `.env.backup.local` — the same file
you set up in [step 5](#5-configure-environment-variables).

**Run a backup:**

```bash
npm run backup
```

You get a dated folder:

```
backups/2026-09-25/
  photos/photos/<user-id>/<uuid>.jpg   every full-size image
  photos/thumbs/<user-id>/<uuid>.jpg   every thumbnail
  photos.json                          captions, dates, who uploaded what
  favorites.json
  allowed_users.json
  app_settings.json
  manifest.json                        counts, total size, anything that failed
```

Copy that folder to an external drive or a cloud drive. Doing this every few
months is plenty.

**Also worth knowing:**

- Supabase → **Database** → **Backups** has automatic daily database backups on
  paid plans. On the free plan, the script above is your backup.
- Supabase → **Project Settings** → **General** lets you pause rather than
  remove a project you are not using.
- A free Supabase project is paused after a week of inactivity. Just open the
  site or the dashboard now and then, or move to the paid plan if you would
  rather not think about it.

---

## Everyday commands

```bash
npm run dev        # develop at http://localhost:3000
npm run doctor     # check Supabase setup; run this whenever something is odd
npm run add-user   # create an account + allow-list it in one step
npm run build      # production build (run before deploying, to catch errors)
npm run start      # serve the production build locally
npm run typecheck  # TypeScript only, no build
npm run backup     # download a full copy of photos + data
```

`npm run doctor` is the one to remember. If the site ever misbehaves, run it
first — it checks the project is awake, the schema is intact, the bucket is
still private, both accounts are on the allow list, and that nothing leaks to
a signed-out visitor.

## Changing things later

| What | Where |
|---|---|
| Start date, album title, homepage words, your name | The **Settings** page in the app |
| Colours, light and dark palettes | `src/app/globals.css` — the `:root` and `.dark` blocks |
| Image quality and size limits | `src/lib/constants.ts` |
| How long photo links stay valid | `SIGNED_URL_TTL` in `src/lib/constants.ts` |
| Photos per page | `PAGE_SIZE` in `src/lib/constants.ts` |

## Adding or removing a person

Everything hinges on the `allowed_users` table. To take someone's access away
immediately, remove their row in the SQL Editor:

```sql
delete from public.allowed_users where display_name = 'Name';
```

Their login still works but shows them nothing. To add someone, the easy way is
`npm run add-user -- their@email.com "Their Name"`; by hand, create the user in
Authentication → Users and insert the row as in step 4.

> Photos reference their uploader, so Postgres will refuse to remove a person
> who still has photos in the album. That is on purpose — it stops an accidental
> click from wiping years of memories.

## Troubleshooting

**"This account does not have access to this album."**
The login worked but there is no matching row in `allowed_users`. Re-run the
insert from step 4 and check the email matches exactly.

**Photos do not appear, or show as broken images.**
The signed links expired while the page sat open. Refresh. If it persists,
check that the `memories` bucket exists and that the storage policies from the
schema ran.

**Uploads fail with "new row violates row-level security policy".**
The signed-in account is not in `allowed_users`, or the schema did not finish.
Re-run `supabase/schema.sql`.

**A HEIC photo from an iPhone will not upload on a desktop browser.**
Desktop Chrome and Firefox cannot decode HEIC. Upload from the iPhone itself,
where it works, or change **Settings → Camera → Formats** to **Most
Compatible** on the phone.

**Everything redirects to the login page in a loop.**
The two `NEXT_PUBLIC_*` variables are missing or wrong on the deployment. Check
them in Vercel → Settings → Environment Variables, then redeploy.
