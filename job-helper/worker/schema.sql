-- Next Chapter — AI job search helper. Cloudflare D1 (SQLite). Schema version 2 (multi-account).
-- Every row of personal data carries user_id: each customer has a private workspace.
-- Money is stored in micro-dollars (1 USD = 1,000,000) so per-call AI costs don't round away.

-- ---------------------------------------------------------------- accounts + billing

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'paid' CHECK (plan IN ('paid','free')),   -- free = comped (her mom); the owner pays the AI cost
  is_admin INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','waitlist','suspended')),
  referral_code TEXT NOT NULL UNIQUE,
  referred_by INTEGER REFERENCES users(id),     -- one level only: whoever signed this person up
  balance_micro INTEGER NOT NULL DEFAULT 0,     -- prepaid credit, drawn down at 2× AI cost
  monthly_cap_micro INTEGER,                    -- her own spending cap per calendar month (NULL = no cap)
  stripe_customer_id TEXT,
  connect_account_id TEXT,                      -- Stripe Connect Express account for referral payouts
  connect_ready INTEGER NOT NULL DEFAULT 0,
  api_key_hash TEXT,                            -- browser-helper extension key (SHA-256)
  phone TEXT,                                   -- for optional text messages
  sms_opt_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- Family/friends invited to help with someone's search (they see and act in her workspace).
CREATE TABLE IF NOT EXISTS helpers (
  owner_id INTEGER NOT NULL REFERENCES users(id),
  helper_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner_id, helper_email)
);

-- Every Claude call: tokens, what it cost the business, and what the customer was charged.
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  web_searches INTEGER NOT NULL DEFAULT 0,
  cost_micro INTEGER NOT NULL,      -- what Anthropic charges the business
  charge_micro INTEGER NOT NULL,    -- what the customer pays (2× cost; 0 for free plans)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_events(created_at);

-- Credit purchases (Stripe Checkout) and manual adjustments.
CREATE TABLE IF NOT EXISTS credit_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  amount_micro INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','refunded','adjustment')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Referral earnings: 50% of the profit (charge − AI cost) on every call made by someone they referred.
CREATE TABLE IF NOT EXISTS referral_earnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER NOT NULL REFERENCES users(id),
  referred_id INTEGER NOT NULL REFERENCES users(id),
  usage_event_id INTEGER REFERENCES usage_events(id),
  amount_micro INTEGER NOT NULL,          -- negative for reversals (refunds)
  payout_id INTEGER REFERENCES payouts(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_earn_referrer ON referral_earnings(referrer_id, payout_id);

CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount_micro INTEGER NOT NULL,
  stripe_transfer_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Business-wide key/value (global AI spending cap, run markers). Per-user settings live in `settings`.
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------- each person's workspace

-- JSON blobs per person: prefs, voice, lessons, positioning, google tokens, run markers.
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('resume','cover_letter','email','writing_sample','reference','other')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  filename TEXT,
  use_for_voice INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docs_user ON documents(user_id);

CREATE TABLE IF NOT EXISTS voice_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  url TEXT,
  apply_url TEXT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  work_mode TEXT NOT NULL DEFAULT 'unknown' CHECK (work_mode IN ('remote','onsite','hybrid','unknown')),
  salary TEXT,
  description TEXT NOT NULL DEFAULT '',
  posted_at TEXT,
  found_at TEXT NOT NULL DEFAULT (datetime('now')),
  fit_score INTEGER,
  fit_label TEXT,
  fit_summary TEXT,
  fit_json TEXT,
  apply_method TEXT,
  application_email TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','filtered','shortlisted','dismissed','applying')),
  vote INTEGER,
  vote_reason TEXT,
  voted_at TEXT,
  company_report TEXT,       -- JSON: funding, layoffs, rep reviews, pay realism, red flags
  still_open INTEGER,        -- 1 / 0 / NULL (unknown) — last check of the posting link
  checked_open_at TEXT,
  UNIQUE (user_id, dedupe_key),
  UNIQUE (user_id, source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status, fit_score);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  status TEXT NOT NULL DEFAULT 'drafting' CHECK (status IN (
    'drafting','ready','submitted','following_up','interviewing','offer','won','rejected','closed','withdrawn')),
  apply_method TEXT NOT NULL DEFAULT 'web' CHECK (apply_method IN ('email','web','in_person')),
  contact_email TEXT,
  resume_md TEXT,
  cover_letter_md TEXT,
  email_subject TEXT,
  email_body TEXT,
  form_answers TEXT,
  ai_notes TEXT,
  gmail_thread_id TEXT,
  rfc_message_id TEXT,
  submitted_at TEXT,
  last_contact_at TEXT,
  follow_up_count INTEGER NOT NULL DEFAULT 0,
  closed_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_apps_user_status ON applications(user_id, status);

CREATE TABLE IF NOT EXISTS app_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_app ON app_events(application_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_user ON app_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  application_id INTEGER REFERENCES applications(id),
  kind TEXT NOT NULL CHECK (kind IN ('application','follow_up','reply','thank_you','digest','negotiation')),
  to_email TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  attach_resume INTEGER NOT NULL DEFAULT 0,
  attach_cover_letter INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','sent','failed','cancelled')),
  approved_by TEXT,
  thread_id TEXT,
  in_reply_to TEXT,
  notes_for_her TEXT,
  error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_outbox_user_status ON outbox(user_id, status);

CREATE TABLE IF NOT EXISTS inbox_seen (
  user_id INTEGER NOT NULL,
  gmail_id TEXT NOT NULL,
  application_id INTEGER,
  category TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, gmail_id)
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  sentiment TEXT NOT NULL CHECK (sentiment IN ('good','bad','note')),
  about TEXT NOT NULL DEFAULT 'general',
  application_id INTEGER,
  context TEXT,
  text TEXT NOT NULL,
  learned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Interview prep sheets, practice role-plays, hiring-manager outreach, offer help.
CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  starts_at TEXT,                 -- ISO time, if scheduled
  kind TEXT,                      -- phone screen, hiring manager, panel, role-play…
  interviewers TEXT,
  prep_md TEXT,
  calendar_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','done','cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS practice_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  scenario TEXT NOT NULL,
  application_id INTEGER,
  messages TEXT NOT NULL DEFAULT '[]',   -- JSON [{role, text}]
  scorecard TEXT,                         -- JSON once finished
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outreach (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  person_name TEXT,
  person_title TEXT,
  profile_url TEXT,
  email TEXT,
  why TEXT,
  linkedin_note TEXT,
  email_subject TEXT,
  email_body TEXT,
  status TEXT NOT NULL DEFAULT 'drafted' CHECK (status IN ('drafted','sent','replied','skipped')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id, created_at);

-- Problems someone should know about (Gmail disconnected, out of credit, AI key failing…).
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(user_id, resolved);

-- Support assistant: every question and answer, and whether the answer helped (null = not rated).
CREATE TABLE IF NOT EXISTS support_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, helpful INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_support_user ON support_messages(user_id, created_at);

-- Company career pages, fetched at most about once a day and shared by every account (go-to-market roles only).
CREATE TABLE IF NOT EXISTS board_cache (board TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, jobs TEXT NOT NULL);
