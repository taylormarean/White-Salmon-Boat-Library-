# Security Audit — White Salmon Boat Library

Date: 2026-08-02 · Scope: Worker API (`worker/`), frontend (`frontend/`),
marketing site (`site/`), Stripe integration. Methodology: full read of the
auth layer and every route registration, plus live testing of the guards
(documented in the functional audit).

## Summary

No critical issues open. Two findings were fixed during the audit
(signup rate limiting, gear-list information leak). The remaining items are
accepted risks or deploy-time requirements, listed so they don't get lost.

## Fixed during this audit

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Medium | `POST /public/join` had no rate limit — a bot could mass-create members and trigger unlimited welcome emails through Resend. | Per-IP limit: 5 successful signups/hour via KV (`join:<ip>`), mirroring the login limiter. |
| 2 | Medium | `GET /api/gear?all=1` was public and returned `oos_reason`/`notes`, which can quote member damage reports ("Damage reported on return: …") — an information leak tying members to damage. Retired/inactive gear was also visible. | `all=1` and raw `oos_reason`/`notes` now require a staff JWT; public callers get a sanitized "In for repair" placeholder. |
| 3 | Low | Stripe donation endpoint could be used to spam Checkout session creation. | Per-IP limit: 10 sessions/hour. Amounts clamped to $1–$10,000. |

## Verified sound (tested, not just read)

- **AuthN**: PBKDF2-SHA256 (100k iterations, per-user salt), constant-work
  login (dummy hash when the user doesn't exist), per-username AND per-IP
  login rate limiting with 15-min lockout, JWTs HMAC-SHA256 with 7-day expiry.
- **AuthZ**: explicit public-route whitelist; everything else requires a JWT.
  Roles are re-read from the DB on every staff/admin check, so demotion takes
  effect immediately (fleet-app invariant). All mutating staff routes gate
  through `requireStaff`/`requireAdmin`; verified route-by-route.
- **Ownership checks**: `/me/member` and `/checkouts/:id/return` resolve the
  member from the JWT and refuse cross-member access (tested: 403 on another
  member's checkout).
- **SQL injection**: every query uses D1 prepared statements with bound
  parameters, including the dynamic `IN (...)` lists (placeholder-generated).
- **XSS**: React escapes all interpolation; the marketing site writes dynamic
  text via `textContent` only.
- **CSRF**: not applicable — Bearer tokens in headers, no cookies.
- **Race conditions**: concurrent checkout of the same item is prevented by an
  atomic conditional UPDATE (`WHERE status='available'`) with full rollback
  when fewer rows than requested flip (tested with a double-checkout attempt).
- **Stripe webhook**: signature verified (HMAC-SHA256 over `t.payload`),
  constant-time comparison, 5-minute replay tolerance, and state transitions
  only from `pending` — a replayed/forged `completed` event can't overwrite
  records. No card data ever touches the Worker (Stripe-hosted Checkout).
- **Admin lockout protection**: an admin cannot demote or disable their own
  account; membership termination disables the linked login.
- **Headers**: `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, HSTS on every response; CORS restricted to an explicit
  origin allowlist.
- **Audit trails**: every admin mutation → `admin_audit_log` (with IP); every
  access-code issuance → `access_code_log`; every outbound email →
  `notification_log`.

## Accepted risks / deploy-time requirements

| # | Severity | Item | Notes |
|---|---|---|---|
| A | **High (deploy req)** | `JWT_SECRET` falls back to a hardcoded string if the secret is unset. | MUST run `wrangler secret put JWT_SECRET` before production. Listed in README step 3. Consider making the Worker refuse logins without it. |
| B | Medium | No email verification on signup — anyone can register with any address. | Accepted for now: matches the paper sign-up sheet's trust level, and the waiver signature is the operative record. Revisit if abuse appears (the rate limiter caps blast radius). |
| C | Low | Passwords require only 6 characters. | Matches the Gorge rides platform. Raise to 8+ if desired — one constant in `auth.ts`/`admin.ts`/`members.ts`. |
| D | Low | Access codes travel in confirmation emails. | Inherent to the self-serve design; email compromise ≈ shed access until the code rotates. `per_checkout` mode limits each code's value; a smart-lock integration with expiring codes is the long-term fix. |
| E | Low | `CF-Connecting-IP` is trusted for rate limiting. | Safe when the Worker runs on Cloudflare (header is set by the edge); do not port the limiter elsewhere unchanged. |
| F | Low | Daily door code derives from `DOOR_CODE_SECRET` **or falls back to `JWT_SECRET`**. | Set both secrets so a JWT-secret rotation doesn't silently change the shed code (and vice versa). |
| G | Info | Public gear list shows what exists and when items are due back. | By design — it's the point of the library. No member identity is exposed. |

## Recommendations (future)

1. Turn finding **A** into a hard failure: refuse `handleLogin` when
   `env.JWT_SECRET` is missing in production.
2. Add Cloudflare Turnstile to `/public/join` and `/public/donate` if bot
   traffic ever gets past the IP limits.
3. Wire `per_checkout` codes to a smart-lock API (Igloohome/RemoteLock) so
   codes expire at `due_at` — closes accepted risk D.
4. Consider soft-deleting `users` rows instead of role='disabled' for
   terminated members if churn grows.
