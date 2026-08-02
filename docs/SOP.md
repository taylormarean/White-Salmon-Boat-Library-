# White Salmon Boat Library — Standard Operating Procedures

These SOPs adapt the Gorge rides operations playbook (Waterfall Shuttle fleet
platform) to a self-serve community gear library. Where the shuttle SOP put a
human in the loop (dispatcher, coordinator, mechanic sign-off), the library
version encodes the same safeguard in software so members can serve themselves
24/7 — the same philosophy as the fleet app's "there is no way to mark a
service complete without a receipt."

## Mapping from the Gorge rides platform

| Gorge rides concept | Boat library equivalent |
|---|---|
| Vehicles (Doce, Falcor, …) | Gear items (K-01, PFD-01, …) with the same status model: available / checked out / maintenance / retired |
| Vehicle OOS toggle + reason | Gear pulled from circulation with a required reason |
| Service records + receipt enforcement | Repair queue (`gear_maintenance`) + mandatory damage description on return |
| Tour state machine + claims | Checkout lifecycle: self check-in → active → returned; overdue derived from `due_at` |
| Pre-trip inspection | Safety acknowledgments at checkout (sober, PFD, buddy rule, honest-condition pledge) |
| Post-trip report (end miles, damage photo) | Self-return condition report per item; damage auto-opens a repair ticket |
| Driver roster, certs, compliance | Member roster with waiver version, orientation status, experience level |
| Driver claims tours | Volunteers claim shifts (orientation nights, repair nights, audits) |
| 24h/12h/4h tour reminders + `tour_reminder_log` dedupe | due-soon / overdue-1 / overdue-7 reminder waves + `reminder_log` dedupe (same contract: any non-failed row = handled) |
| Notifications kill switch + `notification_log` | Identical — one funnel, every outcome logged |
| Admin audit log, RBAC, role re-check per request | Identical — admin / librarian / volunteer / member / disabled |

## SOP 1 — Membership (self-serve)

1. Prospective members join at the website: contact info, emergency contact,
   experience level, and the liability waiver (typed signature). No account
   exists without a signed waiver — this is enforced in the API, not by policy.
2. New members get a welcome email with the orientation schedule and the
   safety rules.
3. Members who select "new to whitewater" are flagged `beginner` and cannot
   complete a checkout without naming an experienced buddy.
4. Staff mark orientation complete on the member's record after they attend.
5. **Waiver updates**: bump `waiver_version` in Settings. Every member is
   blocked from checking out until they re-sign (enforced at checkout time).

## SOP 2 — Self-serve checkout

1. Member signs in and picks available gear (limits: 6 items, 7-day loans —
   both configurable in Settings).
2. The system enforces, in order: active membership → current waiver →
   no overdue gear → item/loan limits → all four safety acknowledgments →
   buddy name for beginners → per-item availability (atomic; a race with
   another member rolls the whole checkout back).
3. On success the member receives the **shed access code** on screen and by
   email. Every code issuance is written to `access_code_log`.
4. Two lock modes (Settings → door_code_mode):
   - `per_checkout` — each checkout gets a random 6-digit code (pair with a
     lockbox you rotate, or a smart lock API later).
   - `daily` — one deterministic code per day, derived from
     `HMAC(DOOR_CODE_SECRET, date)`. Staff see today's (and can pre-program
     the lock) on the Checkouts page; members only see it after a valid
     check-in.
5. Member takes ONLY the gear on their checkout, closes the shed, scrambles
   the lock.

## SOP 3 — Returns and damage

1. Member returns gear clean and drained, then marks the return in the app
   with a per-item condition report.
2. **Damaged items require a description** — the return will not submit
   without one. The item goes straight to `maintenance` status and a repair
   ticket opens, so the next member can never take out unsafe gear. This is
   the library's receipt-enforcement equivalent.
3. Staff work the repair queue on the Inventory page; resolving a ticket can
   return the item to circulation (only when no other open tickets exist).
4. Gear physically returned but never marked in the app → staff use
   **Force return** (optionally routing items to inspection).

## SOP 4 — Overdue escalation (automated, hourly cron)

| Wave | Trigger | Recipient |
|---|---|---|
| due_soon | within 24h of due | member |
| overdue_1 | past due | member (also blocks new checkouts) |
| overdue_7 | 7+ days past due | member + staff digest email |

Deduped via `reminder_log` — extending a due date clears the log so reminders
re-arm for the new date. Staff options: extend, call, force-return, suspend.

## SOP 5 — Volunteers & schedule

1. Staff post shifts (orientation nights, gear repair nights, inventory
   audits, events) with a volunteer count.
2. Any signed-in member/volunteer claims or drops a shift; full shifts close
   automatically.
3. Recurring baseline: one orientation shift per week (Tuesdays 5:30pm),
   repair night as the queue demands, quarterly full inventory audit.

## SOP 6 — Incidents & enforcement

1. Injuries, near-misses, gear damage outside a return, and policy violations
   are logged as incidents with follow-up tracking.
2. Zero-tolerance violations (drugs/alcohol with gear, harassment) →
   suspension or termination from the member's page. Termination also
   disables the login. Every enforcement action lands in the admin audit log.

## SOP 7 — Admin safeguards

- Roles: `admin` (everything), `librarian` (staff ops), `volunteer` /
  `member` (self-service + shifts), `disabled`. Roles are re-checked from the
  DB on every request — demotions take effect immediately.
- Every admin mutation is audit-logged (`admin_audit_log`).
- Notifications kill switch pauses ALL outbound email; every suppressed send
  is still logged.
- An admin cannot demote or disable their own account (lockout protection).
