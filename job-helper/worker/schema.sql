-- Next Chapter — job search helper. Cloudflare D1 (SQLite).

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Key/value JSON blobs: prefs, voice (guide + career record), google tokens, run markers.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Her source material: resumes, cover letters, emails, writing samples.
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('resume','cover_letter','email','writing_sample','reference','other')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  filename TEXT,
  use_for_voice INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every time she edits an AI draft, the before/after is kept so future drafts sound more like her.
CREATE TABLE IF NOT EXISTS voice_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,              -- resume | cover_letter | email
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
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
  -- fit assessment (filled by AI)
  fit_score INTEGER,
  fit_label TEXT,
  fit_summary TEXT,
  fit_json TEXT,
  apply_method TEXT,
  application_email TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','filtered','shortlisted','dismissed','applying')),
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, fit_score);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  status TEXT NOT NULL DEFAULT 'drafting' CHECK (status IN (
    'drafting','ready','submitted','following_up','interviewing','offer','won','rejected','closed','withdrawn')),
  apply_method TEXT NOT NULL DEFAULT 'web' CHECK (apply_method IN ('email','web','in_person')),
  contact_email TEXT,
  resume_md TEXT,
  cover_letter_md TEXT,
  email_subject TEXT,
  email_body TEXT,
  form_answers TEXT,               -- JSON [{question, answer}]
  ai_notes TEXT,                   -- what the AI wants her to double-check
  gmail_thread_id TEXT,
  rfc_message_id TEXT,             -- Message-ID header of the last email we sent (for threading)
  submitted_at TEXT,
  last_contact_at TEXT,
  follow_up_count INTEGER NOT NULL DEFAULT 0,
  closed_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_apps_status ON applications(status);

CREATE TABLE IF NOT EXISTS app_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  type TEXT NOT NULL,              -- created | drafted | submitted | follow_up_sent | reply | status | note | task
  summary TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_app ON app_events(application_id, created_at);

-- Every outgoing email. Nothing leaves without status = approved (by her, or by autopilot if she turned it on).
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id),
  kind TEXT NOT NULL CHECK (kind IN ('application','follow_up','reply','thank_you','digest')),
  to_email TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  attach_resume INTEGER NOT NULL DEFAULT 0,
  attach_cover_letter INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','sent','failed','cancelled')),
  approved_by TEXT,                -- 'her' | 'autopilot'
  thread_id TEXT,                  -- Gmail thread to reply in
  in_reply_to TEXT,                -- RFC Message-ID being answered
  notes_for_her TEXT,              -- what the AI wants her to check before sending
  error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);

-- Gmail messages already looked at, so replies are classified once.
CREATE TABLE IF NOT EXISTS inbox_seen (
  gmail_id TEXT PRIMARY KEY,
  application_id INTEGER,
  category TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
