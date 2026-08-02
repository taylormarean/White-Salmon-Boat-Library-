# Demoing WSBL to the client

Two demo tiers: an instant one (no deploy) and a full live one (~15 minutes
with a Cloudflare account).

## Tier 1 — instant: the marketing site

A hosted demo of the marketing site is published as a private claude.ai
artifact — open it, hit Share, and send the link to the library. App links
and the donate button show demo notices explaining what they do in
production. (Ask Claude for the current artifact URL, or republish from the
repo any time.)

For a pixel-perfect local look (with the real Archivo Black webfont, which
the artifact sandbox can't load): `cd site && python3 -m http.server 3001`
and open http://localhost:3001.

## Tier 2 — full live demo (~15 min): site + app + backend

Uses your existing Cloudflare account (same tooling as the fleet app). Free
tier covers all of it.

```bash
# 0. One-time
npm install -g wrangler && wrangler login

# 1. Resources — paste the two IDs into worker/wrangler.toml
wrangler d1 create wsbl-db
wrangler kv namespace create WSBL_KV

# 2. Database (schema + starter gear inventory)
cd worker && npm install && npm run db:init:remote

# 3. Minimum secrets for a demo
wrangler secret put JWT_SECRET          # any long random string
wrangler secret put DOOR_CODE_SECRET    # any long random string
# (skip Resend/Stripe for the demo — both degrade gracefully)

# 4. Deploy the API
npm run deploy                          # → https://wsbl-api.<you>.workers.dev

# 5. Admin account
node scripts/create-admin.mjs demo-admin@wsbl.org "Library Admin" "<password>"
# → run the printed wrangler command

# 6. Member app
cd ../frontend && npm install
echo "VITE_API_URL=https://wsbl-api.<you>.workers.dev" > .env.local
npm run build
wrangler pages deploy dist --project-name=wsbl-demo
# → https://wsbl-demo.pages.dev  (add this URL to ALLOWED_ORIGINS in
#   worker/src/index.ts and redeploy the worker: cd ../worker && npm run deploy)

# 7. Marketing site
cd ../site
wrangler pages deploy . --project-name=wsbl-site-demo
# → https://wsbl-site-demo.pages.dev
#   Link it to the app: open with ?app=https://wsbl-demo.pages.dev/#

# 8. Realistic demo data (members, checkouts with codes, shifts, incident)
cd ../worker
BASE=https://wsbl-api.<you>.workers.dev \
  ADMIN_EMAIL=demo-admin@wsbl.org ADMIN_PASSWORD=<password> \
  node scripts/seed-demo.mjs
```

### Demo accounts after seeding

| Who | Login | Password |
|---|---|---|
| Admin (staff view) | demo-admin@wsbl.org | what you chose |
| Advanced member (has gear out) | maya.demo@example.com | paddle123 |
| Beginner member (buddy rule) | sam.demo@example.com | paddle123 |
| Fresh member (clean slate) | jo.demo@example.com | paddle123 |

## Suggested 10-minute walkthrough

1. **Marketing site** — the pitch, the rules, the donate button (explain
   Stripe is one secret away from live).
2. **Join flow** (2 min) — sign up a new member live on the site's "Become a
   member" CTA; show the waiver being part of signup.
3. **Self-serve checkout as Sam** (3 min) — the heart of the demo. Show the
   safeguards firing: try to skip the acknowledgments (blocked), skip the
   buddy name (blocked — Sam is a beginner), then complete it and let the
   **shed code appear**. This is the moment that sells it.
4. **Return with damage as Maya** (2 min) — return the kayak "ok" and the
   PFD "damaged"; flip to the admin view and show the PFD sitting in the
   repair queue, pulled from circulation automatically.
5. **Staff dashboard as admin** (3 min) — gear out now, the repair queue,
   member roster (waiver/orientation columns), volunteer shifts, the
   access-code audit log, and Settings (loan limits, door-code mode, the
   notifications kill switch).
6. If asked about overdue handling: run the backdate command printed by the
   seed script, then show the Overdue tab + explain the three automated
   email waves.

## Tear-down / reset

```bash
wrangler d1 execute wsbl-db --remote --file=schema.sql   # re-runs idempotent schema
# or fully: wrangler d1 delete wsbl-db && wrangler pages project delete wsbl-demo ...
```
