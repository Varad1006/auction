# Cricket Auction

A live player-auction app for a college cricket tournament: 6 teams, separate
men's and women's pools, a spin-the-wheel draw, real-time bidding from owners'
phones, and a public live view for everyone else. Installable as a PWA.

**Stack:** Next.js 16 (App Router) on Vercel · Supabase (Postgres, Auth with
Google, Realtime, Storage) · Tailwind CSS.

- [Roles](#roles)
- [How it works](#how-it-works)
- [Setup (one time)](#setup-one-time)
- [Running the event](#running-the-event)
- [Local development and tests](#local-development-and-tests)
- [Wrapping as a native app later](#wrapping-as-a-native-app-later)

## Roles

| Role | Who | Can do |
|---|---|---|
| **Admin** | Gmail addresses in `ADMIN_EMAILS` | Everything: run the auction, bid on a team's behalf, undo, manage players/teams/settings/owners, export CSV |
| **Owner** | Emails you map to a team on **Admin → Owners** | Bid for *their own team only*; sees everything else read-only |
| **Viewer** | Anyone with the link, no sign-in | Watch the wheel, current player, bids, purses, rosters and results |

A signed-in Gmail that is neither an admin nor an owner is a viewer. Only
Google sign-ins can get admin or owner rights.

## How it works

### Authorization is enforced on the server, three layers deep

1. **Browsers can only read.** Row-level security lets the public key `SELECT`
   the auction tables and nothing else. Browsers have no `INSERT`, `UPDATE` or
   `DELETE` rights on any table, and no rights at all on the owner mappings,
   signed-in sessions or audit log (they contain emails).
2. **Every write is an API action.** `POST /api/actions/<name>` verifies the
   Google session with Supabase Auth and works out the caller's role
   (`ADMIN_EMAILS` → owners table → viewer). It then checks the role against
   the action's allow-list, validates the input and rejects cross-site
   requests. See `src/server/actions.ts`: each action declares its `roles`.
3. **The auction rules live in Postgres functions** (`auction_*` in
   `supabase/migrations`). Only the server's service-role key can execute
   them. An owner's team is taken from their session, never from the request.

The end-to-end test checks this directly. Owners calling sell, undo, edit or
settings get 403. Forged team IDs are ignored. Direct REST and RPC calls with
the public key are refused.

### Concurrent bids

Every state change (bid, sell, undo, spin) starts by locking the single
`auction_state` row, so changes are applied one at a time. A bid carries the
amount the owner saw. If someone else bid first, that amount is now too low
and the bid is rejected with "Outbid: current bid is now X" rather than being
silently overwritten. Tests fire simultaneous bids from many connections and
check that exactly one wins, and that the bid chain stays strictly increasing.
They also show that removing the lock breaks this.

### Bid rules (checked by the server; the owner's buttons mirror them)

- Opening bid ≥ the player's base price. After that, ≥ current bid +
  increment. Increments can be flat (`5`) or tiered (`0:5, 100:10`).
- A team can't outbid itself.
- The squad must not be full (per-pool max squad).
- The bid can't exceed the remaining purse.
- **Reserve rule:** after the bid, the team must still afford its minimum
  squad at the pool's lowest base price.

### Real-time sync

All screens subscribe to Supabase Realtime changes on the public tables.
Clients reload a full snapshot when they reconnect, when the app returns to
the foreground (phones sleep), and every 60 s as a safety net. State updates
carry a version number, so out-of-order messages can't roll the screen back.

### The wheel

The server picks the player (a cryptographically random, equal-weight draw
from players still in the pool). It stores the candidate list and start time;
every device animates to the same result, and late joiners skip to the
reveal. The admin then taps **Open bidding**.

### Rounds and undo

- Sold and unsold players are excluded from the wheel. When a pool's round is
  finished, **Start round N+1** puts that round's unsold players back in the
  pool.
- **Undo last bid** voids the latest bid; nothing is deleted.
- **Undo last result** marks the result as undone and puts the player back on
  the block with the last bid restored.
- **Assign** (Players page) sells a leftover player at a fixed price after the
  final round. It is logged and can be undone.
- Every admin action is recorded in `audit_log`.

## Setup (one time)

You need three accounts: **Supabase** (database, auth, realtime), **Google
Cloud** (OAuth client) and **Vercel** (hosting). All have free tiers that are
enough for this event (see [Limits](#limits)).

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com) (done:
   `xltgjnmeccyzncstgtlv`).
2. **Create the database schema**, using one of these:
   - **SQL Editor** (simplest): open **SQL Editor → New query**, then paste
     and **Run** each file in `supabase/migrations/`, in filename order (5
     files).
   - **Script over HTTPS:** create a personal access token (avatar →
     **Account preferences → Access Tokens**), then run
     `SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=xltgjnmeccyzncstgtlv npm run db:migrate`.
   - **Supabase CLI:** `npx supabase link --project-ref xltgjnmeccyzncstgtlv`
     then `npx supabase db push` (asks for the database password).
3. Optional, for a rehearsal: run `supabase/sample-players.sql` to load 84
   sample players. Delete them later from **Admin → Players**, or reset.
4. **Project Settings → API Keys:** copy the project URL, the **anon /
   publishable** key and the **service_role / secret** key.

### 2. Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com), create a
   project and open **APIs & Services → OAuth consent screen**:
   - User type **External**; fill in the app name and support email.
   - Scopes: the defaults (`openid`, `email`, `profile`). These need no Google
     verification.
   - **Publish the app** ("In production"). While it's in "Testing", only
     Gmail accounts you list as test users can sign in.
2. **Credentials → Create credentials → OAuth client ID → Web application**:
   - Authorized redirect URI:
     `https://xltgjnmeccyzncstgtlv.supabase.co/auth/v1/callback`
   - Copy the client ID and client secret.
3. In Supabase, open **Authentication → Sign In / Providers**:
   - **Google:** enable it and paste the client ID and secret.
   - **Email:** disable it, so Google is the only way in. The app also ignores
     non-Google logins for admin and owner rights.
4. In Supabase, open **Authentication → URL Configuration**:
   - **Site URL:** your Vercel URL, e.g. `https://your-app.vercel.app`
   - **Redirect URLs:** `https://your-app.vercel.app/auth/callback` and
     `http://localhost:3000/auth/callback`

### 3. Vercel

1. Import the GitHub repo in [Vercel](https://vercel.com/new). The framework
   (Next.js) is detected automatically.
2. Add these environment variables (see `.env.example`):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://xltgjnmeccyzncstgtlv.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key (**server only**) |
   | `ADMIN_EMAILS` | your Gmail address(es), comma-separated |
   | `NEXT_PUBLIC_APP_NAME` | optional, e.g. `XYZ College Premier League` |
   | `NEXT_PUBLIC_CURRENCY_LABEL` | optional, default `pts` |

3. Deploy. Then put the production URL into Supabase's Site URL and Redirect
   URLs (step 2.4).

### 4. Before the event

1. Sign in at `/login` with an admin Gmail and open **Admin**.
2. **Settings:** rename the 6 teams and set their colours. For each pool, set
   the purse, min/max squad, base prices per grade and bid increments.
   Per-team overrides are under **Limits**.
3. **Players:** add players or use **Bulk import** (paste from Google Sheets).
   Upload photos: they're resized in the browser before upload.
4. **Owners:** map each owner's Gmail to their team. A team can have several
   owners. The page also lists who is signed in right now.
5. Do a rehearsal, then **Settings → Danger zone → Reset auction**. This keeps
   players, teams, settings and owners.

### Player registration form

Share `https://<your-site>/register` with residents. It asks for name, contact details, flat, age,
gender, playing role, batting/bowling style, T-shirt size, availability, a photo and the payment
receipt. Submissions are private (only admins see contact details, flats and receipts).

On **Admin → Registrations**: open/close the form, set the intro, payment instructions,
availability options (e.g. match dates) and declaration; review each registration (photo and
receipt links), pick a grade and **Approve** to add them to the auction pool with their photo,
availability and notes on the player card. **CSV** exports everything (useful for T-shirt orders).

## Running the event

- **Admin (laptop):** Admin → Auction. Spin → Open bidding → owners bid (or
  tap a team to bid on its behalf, or type a custom amount) → **SOLD** or
  **Mark unsold**. Switch between Men and Women at any time between players.
- **Owners (phones):** open the site, tap **Owner sign-in**, then use **Add to
  Home Screen** (iOS Safari: Share → Add to Home Screen; Android Chrome: menu →
  Install app). The bid bar at the bottom shows one-tap bids, with the reason
  whenever a bid isn't allowed.
- **Viewers:** just share the site URL. No sign-in needed.
- **Export:** Admin → Results → *Squads CSV* / *Results log CSV*.

### Limits

Supabase's free plan allows **200 simultaneous realtime connections**. Each
open screen (owners, admin and every viewer) uses one. If you expect more than
~190 people watching at once (e.g. a projector plus a big crowd on phones),
upgrade the project to Pro for the day, or have viewers watch the projector.

## Local development and tests

```bash
npm install
npm test                  # unit tests (bid rules, bulk import)
npm run test:db           # database tests against a local Postgres
                          # (TEST_DATABASE_URL, default postgres://postgres:postgres@localhost:5432/postgres)
```

A full local stack with the [Supabase CLI](https://supabase.com/docs/guides/local-development):

```bash
npx supabase start        # applies migrations and loads the sample players
cp .env.example .env.local   # then fill in the local URL and keys printed by `supabase start`,
                             # with ADMIN_EMAILS=admin@test.local
npm run build && npm start
bash scripts/e2e-users.sh # local test users: admin/owner1/owner2/stranger@test.local
npm run test:e2e          # drives admin + 2 owners + a viewer in real browsers
```

To also emulate hosted Supabase's `safeupdate` guard (no `UPDATE`/`DELETE`
without `WHERE`), run the database tests against the CLI's database:
`TEST_DATABASE_URL=postgres://supabase_admin:postgres@127.0.0.1:54322/postgres npm run test:db`

Project layout:

```
supabase/migrations/   schema, auction functions, access rules, defaults
src/server/            role resolution, action registry (all writes), Supabase clients
src/app/api/           actions, me, heartbeat, admin overview/photo/export
src/components/live/   realtime store, wheel, player card, bid status, teams, results, owner bid bar
src/components/admin/  auction controls, players, settings, owners, results
public/sw.js           service worker (never caches live data)
tests/                 unit, database and end-to-end tests
```

## Wrapping as a native app later

The PWA already installs to the home screen and opens full-screen. To publish
to the app stores later:

1. Wrap the deployed site with **Capacitor** (`@capacitor/core`, `ios`,
   `android`), pointing `server.url` at the production URL, or bundle a static
   shell.
2. **Google sign-in:** Google blocks OAuth inside embedded web views. Use a
   native plugin (e.g. `@capgo/capacitor-social-login`) and pass the ID token
   to `supabase.auth.signInWithIdToken`. You'll also need separate iOS and
   Android OAuth client IDs in Google Cloud, and a deep-link / custom URL
   scheme added to Supabase's redirect URLs.
3. **Apple:** App Store guideline 4.8 requires **Sign in with Apple** when
   Google sign-in is offered. That means an Apple Developer account
   ($99/year), Xcode on a Mac, app icons and splash screens, and App Store
   review.
4. **Android:** a Google Play developer account ($25 one-time). A **Trusted
   Web Activity** (e.g. with Bubblewrap) is a lighter option than Capacitor
   for Android, and keeps normal browser sign-in working.
5. Push notifications ("you've been outbid") would need Web Push (iOS 16.4+
   supports it for installed PWAs) or native push in the wrapper.
