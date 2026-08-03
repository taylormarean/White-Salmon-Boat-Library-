# White Salmon Boat Library — User Guide

Everything the system does and how to use it, for members, librarians, and
admins. (A shareable, styled version of this guide lives at
[docs/user-guide.html](user-guide.html).)

---

## 1. The big picture

The system has three parts that work together:

| Part | Who uses it | What it does |
|---|---|---|
| **Marketing site** | The public | The pitch: what the library is, the river rules, become-a-member, volunteer and donate calls to action |
| **Member app** | Members | Self-serve everything: join with the waiver, check out gear 24/7, get the shed code, return with a condition report, claim volunteer shifts |
| **Staff dashboard** | Librarians & admins | The same app, more doors: inventory, repairs, member roster, checkout board, schedule, incidents, settings |

Behind them, automation handles what used to need a person: overdue reminder
emails, access codes, damage triage, and audit logging.

**The core idea:** the shed stays open 24/7 with nobody behind a counter,
because every safeguard the paper system relied on a human for is enforced by
the software instead.

---

## 2. For members

### Joining the library

1. On the website, choose **Become a member** (it's free).
2. Fill in your contact info, an **emergency contact** (required), and your
   whitewater experience level. Be honest about experience — "new to
   whitewater" just means the app will ask who you're paddling with.
3. Read the **liability waiver** and sign it by typing your full legal name.
   There is no membership without a signed waiver — the system won't create
   the account.
4. You'll get a welcome email with the orientation schedule. New Member
   Orientations are Tuesdays at 5:30pm at the shed (The Missing Corner,
   BZ Corner — across from the Mini Mart). New paddlers are strongly
   encouraged to attend before their first checkout.

### Checking out gear (the whole point)

Sign in → **Check Out Gear**. Three steps:

1. **Pick your gear** — everything available right now, grouped by category
   (kayaks, IKs, paddles, PFDs, helmets, skirts, drytops, throwbags). Each
   item shows its code (matching the physical tag on the gear), brand/model,
   color, size, and condition — everything the paper checkout board required.
2. **Pick a return date** — the rental period is 3 days; rentals up to the
   9-day maximum are reserved for multi-day runs and out-of-town trips and
   require a trip note (the digital version of noting it on the checkout
   board). Gear leaving a 100-mile radius of the library? Tell us where
   it's going.
3. **The library agreement** — four checkboxes, each one a real rule:
   - Zero tolerance for drug and alcohol use on the river with library gear
   - A suitable PFD on whenever you're on the water
   - Boat within your skill level — no library equipment on Class V
     whitewater; beginners name the experienced person they're going with
   - Inspect your gear for defects before use, and report damage honestly
     on return

Hit the button and **your shed access code appears on screen** (and lands in
your email). Grab exactly the gear on your checkout, close the shed,
scramble the lock.

**The app will stop you if:** you have overdue gear out, your waiver is out
of date (re-sign and continue), your membership is suspended, someone
grabbed an item seconds before you (refresh and re-pick), or any
acknowledgment is missing.

### While you're out

Your **My Gear** page shows everything you have out, the due date, and your
shed code (in case you forget it). You'll get a friendly email reminder the
day before gear is due.

### Returning gear

1. Bring everything back clean and drained.
2. In **My Gear**, hit **Return gear** and give each item a condition
   report: *Good shape* or *Damaged*.
3. Damaged items need a short description — that's mandatory, and it's the
   deal: **nobody is ever charged for honestly reported damage.** The
   description goes straight to the repair queue so the next member never
   unknowingly takes out unsafe gear.

Overdue gear blocks new checkouts, triggers reminder emails (day before,
day after, and a week after with a librarian notified), and chronic
non-return can lead to suspension. Need more time? Ask — a librarian can
extend your loan in seconds.

### Volunteering

The **Volunteer** page lists upcoming shifts — orientation nights, repair
nights, inventory audits. Tap **Claim shift** to sign up, **Drop shift** if
plans change. Shifts show who else is coming and close automatically when
full.

---

## 3. For librarians (staff)

Staff accounts see the same app plus the operational pages.

### Dashboard

The at-a-glance page: gear available / checked out / overdue / in repair,
active member count, open incidents, everything currently out (with due
dates), the repair queue, and upcoming shifts. Every tile is clickable.

### Inventory

- **Add or edit gear**: code (write it on the physical item), category,
  brand/model, color, size, condition.
- **Log issue**: report a problem on any item. *Minor* keeps it in
  circulation; *major/unusable* pulls it automatically.
- **Pull / Restore**: take an item out of circulation (reason required —
  it's shown to staff, members just see "In for repair") or put it back.
- **Repairs tab**: the queue. Damage reported by members on return lands
  here automatically. Resolving a ticket can return the item to service in
  the same action.

### Members

The roster shows every member with waiver status, orientation status,
experience level, gear currently out, and overdues. Click into a member for
their full history. From there you can:

- **Mark orientation done** after they attend a Tuesday session
- **Suspend / Reinstate** (reason required; suspended members can't check out)
- **Terminate** for policy violations — this also disables their login

### Checkouts

The digital checkout board. Tabs: Active, Overdue, Returned, and the
**Code log** (every access code ever issued, to whom, when).

- **Extend** — set a new due date; the reminder emails automatically re-arm
  for the new date.
- **Force return** — for gear that came back without being marked returned,
  or lost gear. You choose whether the items go back to circulation or to
  the repair queue for inspection.
- **Today's door code** — when the library uses daily-code mode, the code to
  program into the shed keypad is displayed here.

### Schedule

Create volunteer shifts (orientation / repair night / inventory audit /
event), set how many volunteers each needs, and watch signups fill. Staff
can also edit or cancel shifts.

### Incidents

Log injuries, near-misses, gear damage outside a return, and policy
violations. Each incident tracks status (open → investigating → resolved)
and follow-up notes, and links to a member when relevant.

---

## 4. For admins

Everything librarians have, plus:

### Users

Create and manage accounts. Roles:

| Role | Can do |
|---|---|
| `admin` | Everything, including users and settings |
| `librarian` | All staff operations |
| `volunteer` / `member` | Self-service + shift signup |
| `disabled` | Nothing (used for terminated memberships) |

Role changes take effect immediately — the system re-checks the database on
every request. You can also reset passwords here. Safety rail: you can't
demote or disable your own admin account.

### Settings

Live configuration — changes apply instantly:

- **Rental periods**: standard (3 days) and maximum (9 days), max items per checkout
- **Door code mode**: `per_checkout` (each checkout gets a random code) or
  `daily` (one code per day, shown to staff for programming the keypad;
  members only see it after a valid check-in)
- **Waiver version**: bump this number and *every* member must re-sign the
  waiver before their next checkout — use it whenever the waiver text changes
- **Notifications kill switch**: pauses every outbound email at once (with a
  reason). For emergencies or maintenance.
- **Orientation info** text, library address, staff digest email

### The paper trail

Three logs, all searchable in the app:

- **Audit log** — every admin action: who did what, to whom, when
- **Notification log** — every email the system sent (or suppressed, and why)
- **Access code log** — every shed code issued, to which member, when

### Donations (Stripe)

The library accepts donations by Venmo (@TheBoatLibrary), PayPal, and the
secure drop box at the facility (checks payable to "White Salmon Boat
Library") — donations are tax-deductible. The website's card option opens a
Stripe-hosted checkout; card details never touch the library's systems, and
completed card donations appear for staff with running totals.

---

## 5. Behind the scenes (the automation)

**Reminder emails** run hourly, three waves per checkout, each sent at most
once: *due soon* (24h before), *overdue* (past due — also blocks new
checkouts), *week overdue* (member gets a firmer note, staff digest email
gets a heads-up). Extending a due date resets the waves.

**Access codes**: every issuance is logged. In per-checkout mode each member
gets their own random 6-digit code; in daily mode the code is derived from a
secret key and the date, so staff can program the lock ahead of time.

**Damage triage**: a "damaged" condition report instantly pulls the item
from circulation and opens a repair ticket — there is no gap where unsafe
gear is borrowable.

**Security, in one paragraph**: passwords are properly hashed, logins are
rate-limited, staff pages verify the caller's role against the database on
every single request, members can only touch their own checkouts, and every
sensitive action lands in a log. A full security review lives in
`docs/SECURITY_AUDIT.md`.

---

## 6. Quick reference

| I want to… | Where |
|---|---|
| Join the library | Website → Become a member |
| Check out gear | App → Check Out Gear |
| See my shed code again | App → My Gear |
| Return gear / report damage | App → My Gear → Return gear |
| Volunteer for a shift | App → Volunteer |
| Add a new boat to inventory | Staff → Inventory → + Add gear |
| Handle a damage report | Staff → Inventory → Repairs |
| Extend someone's loan | Staff → Checkouts → Extend |
| Mark orientation complete | Staff → Members → (member) |
| Suspend a member | Staff → Members → (member) → Suspend |
| Post an orientation night | Staff → Schedule → + New shift |
| Change loan length / door code mode | Admin → Settings |
| Force everyone to re-sign the waiver | Admin → Settings → bump Waiver version |
| Pause all emails | Admin → Settings → kill switch |
| Add a librarian account | Admin → Users → + Add user |
