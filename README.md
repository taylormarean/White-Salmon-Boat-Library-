# White Salmon Boat Library — Self-Serve Gear Library

The Gorge rides operations platform (Waterfall Shuttle fleet app), adapted for
the [White Salmon Boat Library](https://www.whitesalmonboatlibrary.org/) — a
free, donation-based community whitewater gear library in Husum, WA.

Members check **themselves** in: sign up online (waiver included), pick gear,
acknowledge the safety rules, and instantly receive the shed access code. The
paper checkout board, the sign-up sheet, and the honor-system return all move
into software — with the same safeguards the Gorge rides platform used for
fleet ops (see [docs/SOP.md](docs/SOP.md) for the full mapping).

## What it does

**Members (self-serve, 24/7)**
- Free signup with digital liability waiver (typed signature, versioned —
  bump the version and everyone must re-sign before their next checkout)
- Browse live gear availability by category (kayaks, IKs, paddles, PFDs,
  helmets, skirts, drytops, throwbags)
- Self checkout: pick items → return date → safety acknowledgments
  (zero-tolerance sober pledge, PFD rule, beginner-buddy rule, honest-condition
  pledge) → **shed access code issued instantly** (screen + email)
- Self return with per-item condition report — damage descriptions are
  mandatory and auto-open repair tickets
- Volunteer shift signup (orientation nights, repair nights, audits)

**Staff (librarians/admins)**
- Dashboard: gear out, overdue, repair queue, member stats, upcoming shifts
- Inventory management with the fleet status model (available / checked out /
  maintenance / retired) and a repair queue
- Member roster: waiver + orientation status, suspend / reinstate / terminate
- Checkout board: extend, force-return, access-code audit log, today's door code
- Volunteer schedule builder, incident log, user management, runtime settings,
  admin audit log, notifications kill switch

**Automated (hourly cron)**
- Overdue reminder waves (due-soon → overdue → 7-day escalation + staff
  digest), deduped exactly like the fleet app's tour reminders

## Enforced safeguards (not just policy text)

- No account without a signed waiver; no checkout with an outdated waiver
- Beginners must name an experienced buddy at every checkout
- No new checkouts while anything is overdue
- Atomic availability claim — two members can't take the same boat
- Damaged returns require a description and pull the item from circulation
- Membership termination disables the login; roles re-checked on every request
- Every admin action, code issuance, and outbound email is logged

## Stack

Same as the Gorge rides platform:

| Tier | Tech | Path |
|---|---|---|
| API | Cloudflare Worker (TypeScript, no framework) | [worker/](worker/) |
| DB | Cloudflare D1 (SQLite) | [worker/schema.sql](worker/schema.sql) |
| Rate limiting | Cloudflare KV | — |
| Web | React 18 + Vite → Cloudflare Pages | [frontend/](frontend/) |
| Email | Resend | secrets |
| Auth | PBKDF2 + HS256 JWT, role re-check per request | [worker/src/lib/auth.ts](worker/src/lib/auth.ts) |

## Deploy

```bash
# 1. Create resources
wrangler d1 create wsbl-db          # → database_id into worker/wrangler.toml
wrangler kv namespace create WSBL_KV # → id into worker/wrangler.toml

# 2. Initialize the database (schema + seed categories/starter gear)
cd worker && npm install
npm run db:init:remote

# 3. Secrets
wrangler secret put JWT_SECRET        # any long random string
wrangler secret put DOOR_CODE_SECRET  # any long random string (daily code mode)
wrangler secret put RESEND_API_KEY    # optional — email
wrangler secret put FROM_EMAIL        # verified Resend sender

# 4. Deploy the Worker
npm run deploy                        # note the workers.dev URL

# 5. Bootstrap the first admin
node scripts/create-admin.mjs you@example.com "Your Name" "password"
# → run the printed wrangler d1 execute command

# 6. Frontend
cd ../frontend && npm install
cp .env.example .env.local            # set VITE_API_URL to the Worker URL
npm run build
wrangler pages deploy dist --project-name=wsbl
```

Add your Pages/custom domain to `ALLOWED_ORIGINS` in
[worker/src/index.ts](worker/src/index.ts) before going live.

## Local development

```bash
cd worker && npm run db:init && npm run dev   # http://localhost:8787
cd frontend && npm run dev                    # http://localhost:3000
```

## The door code

Two modes (Settings page):

- **per_checkout** (default): every checkout gets a random 6-digit code.
  Pair with a lockbox you rotate, or wire `issueAccessCode()` in
  [worker/src/routes/checkouts.ts](worker/src/routes/checkouts.ts) to a smart
  lock API (Igloohome, RemoteLock, etc.) to provision real one-time codes.
- **daily**: one deterministic code per day derived from
  `HMAC(DOOR_CODE_SECRET, date)` — staff see today's code on the Checkouts
  page and program the shed's keypad ahead of time; members only see it after
  completing a valid self check-in.

Every issuance is audited in `access_code_log`.

## Docs

- [docs/SOP.md](docs/SOP.md) — standard operating procedures + the full
  Gorge-rides → boat-library concept mapping
