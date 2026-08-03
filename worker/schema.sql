-- White Salmon Boat Library — D1 schema
-- Adapted from the Gorge rides (Waterfall Shuttle fleet) platform:
--   vehicles            -> gear_items
--   service_records     -> gear_maintenance
--   drivers/roster      -> members + volunteers
--   tours + claims      -> checkouts + shift_signups
--   tour_reminder_log   -> reminder_log (same dedupe contract)
--   notification_log    -> notification_log (same funnel: kill switch -> opt-out -> transport)
--   admin_audit_log     -> admin_audit_log (same pattern)

-- ============ Auth ============

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,             -- lowercase email
  password_hash TEXT NOT NULL,           -- "salt:hash" PBKDF2-SHA256
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',   -- admin | librarian | volunteer | member | disabled
  phone TEXT,
  member_id TEXT REFERENCES members(id), -- link to member record (like users.driver_id)
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

-- ============ Members ============

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  experience_level TEXT NOT NULL DEFAULT 'beginner', -- beginner | intermediate | advanced
  waiver_signed_at TEXT,
  waiver_version INTEGER,
  waiver_signature TEXT,                 -- typed full legal name
  orientation_completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | suspended | terminated
  suspension_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

-- ============ Gear inventory ============

CREATE TABLE IF NOT EXISTS gear_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gear_items (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES gear_categories(id),
  gear_code TEXT NOT NULL UNIQUE,        -- the physical ID written on the gear
  name TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  color TEXT,
  size TEXT,
  condition TEXT NOT NULL DEFAULT 'good',   -- excellent | good | fair | poor
  status TEXT NOT NULL DEFAULT 'available', -- available | checked_out | maintenance | retired
  oos_reason TEXT,                          -- why it's in maintenance/retired (mirrors vehicles.oos_reason)
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,        -- soft delete, mirrors vehicles.active
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

-- Damage / repair queue (mirrors service_records + maintenance_blocks)
CREATE TABLE IF NOT EXISTS gear_maintenance (
  id TEXT PRIMARY KEY,
  gear_item_id TEXT NOT NULL REFERENCES gear_items(id),
  reported_by TEXT,                      -- member id or username
  source TEXT NOT NULL DEFAULT 'return', -- return | staff | inspection
  issue TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'minor',-- minor | major | unusable
  status TEXT NOT NULL DEFAULT 'open',   -- open | in_progress | resolved
  resolution_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

-- ============ Checkouts (the tour state machine, adapted) ============
-- Lifecycle: ACTIVE (self check-in, code issued) -> RETURNED
-- Overdue is derived (due_at < now AND returned_at IS NULL), reminders dedupe via reminder_log.

CREATE TABLE IF NOT EXISTS checkouts (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  status TEXT NOT NULL DEFAULT 'active', -- active | returned | cancelled
  checked_out_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_at TEXT NOT NULL,
  returned_at TEXT,
  access_code TEXT,                      -- code issued for this checkout
  -- Safety acknowledgments captured at self check-in (the SOP safeguards):
  ack_sober INTEGER NOT NULL DEFAULT 0,          -- zero-tolerance drugs/alcohol
  ack_pfd INTEGER NOT NULL DEFAULT 0,            -- PFD worn on water
  ack_experience INTEGER NOT NULL DEFAULT 0,     -- beginner-buddy rule acknowledged
  ack_condition INTEGER NOT NULL DEFAULT 0,      -- will report damage honestly
  buddy_name TEXT,                               -- required when member is a beginner
  planned_river_section TEXT,
  trip_note TEXT,                                -- required for >3-day rentals and gear leaving the 100-mile radius
  return_notes TEXT,
  extended_by TEXT,                              -- staff username if due date extended
  force_returned_by TEXT                         -- staff username if staff closed it
);

CREATE TABLE IF NOT EXISTS checkout_items (
  checkout_id TEXT NOT NULL REFERENCES checkouts(id),
  gear_item_id TEXT NOT NULL REFERENCES gear_items(id),
  returned_at TEXT,
  condition_on_return TEXT,              -- ok | damaged
  damage_notes TEXT,
  PRIMARY KEY (checkout_id, gear_item_id)
);

-- Every code issuance is audited (who saw which door code, when).
CREATE TABLE IF NOT EXISTS access_code_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkout_id TEXT REFERENCES checkouts(id),
  member_id TEXT REFERENCES members(id),
  code TEXT NOT NULL,
  mode TEXT NOT NULL,                    -- per_checkout | daily
  issued_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ Volunteers & schedule (drivers/tours claims, adapted) ============

CREATE TABLE IF NOT EXISTS volunteer_shifts (
  id TEXT PRIMARY KEY,
  shift_date TEXT NOT NULL,              -- YYYY-MM-DD
  start_time TEXT NOT NULL,              -- HH:MM
  end_time TEXT NOT NULL,
  shift_type TEXT NOT NULL DEFAULT 'orientation', -- orientation | gear_maintenance | inventory_audit | event
  title TEXT NOT NULL,
  notes TEXT,
  needed INTEGER NOT NULL DEFAULT 1,     -- volunteers needed
  created_by TEXT,
  cancelled_at TEXT,                     -- soft delete, mirrors tours.cancelled_at
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shift_signups (
  shift_id TEXT NOT NULL REFERENCES volunteer_shifts(id),
  username TEXT NOT NULL REFERENCES users(username),
  signed_up_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (shift_id, username)
);

-- ============ Incidents (same domain as fleet incidents) ============

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  member_id TEXT REFERENCES members(id),
  checkout_id TEXT REFERENCES checkouts(id),
  type TEXT NOT NULL DEFAULT 'other',    -- injury | near_miss | gear_damage | policy_violation | other
  description TEXT NOT NULL,
  occurred_at TEXT,
  reported_by TEXT,
  status TEXT NOT NULL DEFAULT 'open',   -- open | investigating | resolved
  follow_up TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

-- ============ Notifications (same funnel + dedupe contract as fleet-app) ============

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,                -- due_soon | overdue | welcome | orientation | staff_digest | manual
  channel TEXT NOT NULL DEFAULT 'email',
  recipient TEXT NOT NULL,
  member_id TEXT,
  checkout_id TEXT,
  subject TEXT,
  status TEXT NOT NULL,                  -- sent | failed | suppressed_kill | suppressed_no_contact
  error TEXT,
  initiated_by TEXT NOT NULL DEFAULT 'system',
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dedupe index: any non-failed row counts as "handled" (fleet-app invariant #3).
CREATE TABLE IF NOT EXISTS reminder_log (
  checkout_id TEXT NOT NULL,
  reminder_type TEXT NOT NULL,           -- due_soon | overdue_1 | overdue_7
  channel TEXT NOT NULL DEFAULT 'email',
  status TEXT NOT NULL DEFAULT 'sent',
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_dedupe
  ON reminder_log (checkout_id, reminder_type, channel);

-- ============ Donations (Stripe Checkout; webhook flips pending -> completed) ============

CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY,
  stripe_session_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  email TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | completed | expired
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- ============ Admin audit (same pattern as fleet-app migration 021) ============

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,                  -- user.create, member.suspend, settings.update, ...
  target TEXT,
  meta TEXT,                             -- JSON
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============ Settings (runtime, admin-togglable — same registry pattern) ============

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('app_name', 'White Salmon Boat Library'),
  ('standard_loan_days', '3'),   -- WSBL rental period: 3 days
  ('max_loan_days', '9'),        -- 9 days (three rental periods) is the maximum, for multi-day/out-of-town trips
  ('max_items_per_checkout', '8'),  -- a full setup: boat, paddle, PFD, helmet, skirt, drytop, throwbag +1
  ('door_code_mode', 'per_checkout'),        -- per_checkout | daily
  ('notifications_paused', '0'),
  ('notifications_pause_reason', ''),
  ('orientation_info', 'New Member Orientations are Tuesdays at 5:30pm at the library shed at The Missing Corner in BZ Corner (across from the BZ Corner Mini Mart).'),
  ('waiver_version', '1'),
  ('library_address', 'The Missing Corner, BZ Corner, WA — Hwy 141 at Glenwood Hwy, across from the Mini Mart'),
  ('staff_digest_email', '');

-- ============ Seed data ============

INSERT OR IGNORE INTO gear_categories (id, name, sort) VALUES
  ('kayak',      'Whitewater Kayaks', 1),
  ('ik',         'Inflatable Kayaks', 2),
  ('paddle',     'Paddles',           3),
  ('pfd',        'PFDs',              4),
  ('helmet',     'Helmets',           5),
  ('skirt',      'Spray Skirts',      6),
  ('drytop',     'Drytops',           7),
  ('throwbag',   'Throwbags',         8),
  ('other',      'Other Gear',        9);

-- A small starter inventory so the app renders on first deploy.
-- Replace with the real shed inventory via the Inventory page.
INSERT OR IGNORE INTO gear_items (id, category_id, gear_code, name, brand, model, color, size, condition, status) VALUES
  ('k01', 'kayak', 'K-01', 'Creek Boat',        'Jackson',   'Zen 3.0',   'Blue',   'M',  'good', 'available'),
  ('k02', 'kayak', 'K-02', 'Creek Boat',        'Pyranha',   'Scorch',    'Red',    'L',  'good', 'available'),
  ('k03', 'kayak', 'K-03', 'River Runner',      'Dagger',    'Rewind',    'Green',  'M',  'good', 'available'),
  ('i01', 'ik',    'IK-01', 'Inflatable Kayak', 'AIRE',      'Tributary', 'Yellow', '1p', 'good', 'available'),
  ('p01', 'paddle','P-01', 'Whitewater Paddle', 'Werner',    'Powerhouse','Black',  '194','good', 'available'),
  ('p02', 'paddle','P-02', 'Whitewater Paddle', 'AT',        'Hercules',  'Blue',   '197','good', 'available'),
  ('f01', 'pfd',   'PFD-01','Rescue PFD',       'Astral',    'GreenJacket','Green', 'M/L','good', 'available'),
  ('f02', 'pfd',   'PFD-02','PFD',              'NRS',       'Ninja',     'Red',    'S/M','good', 'available'),
  ('h01', 'helmet','H-01', 'Helmet',            'Sweet',     'Rocker',    'White',  'M',  'good', 'available'),
  ('h02', 'helmet','H-02', 'Helmet',            'WRSI',      'Current',   'Black',  'L',  'good', 'available'),
  ('s01', 'skirt', 'SK-01','Spray Skirt',       'Immersion Research','Klingon','Black','L','good','available'),
  ('d01', 'drytop','DT-01','Drytop',            'Kokatat',   'Rogue',     'Blue',   'M',  'good', 'available'),
  ('t01', 'throwbag','TB-01','Throwbag',        'NRS',       'Pro 75ft',  'Orange', '75ft','good','available');
