// Brings an existing database up to date (schema.sql creates new ones). Idempotent; runs once per isolate.
import type { Env } from '../env';

const STEPS = [
  'ALTER TABLE jobs ADD COLUMN vote INTEGER',
  'ALTER TABLE jobs ADD COLUMN vote_reason TEXT',
  'ALTER TABLE jobs ADD COLUMN voted_at TEXT',
  `CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sentiment TEXT NOT NULL CHECK (sentiment IN ('good','bad','note')),
    about TEXT NOT NULL DEFAULT 'general',
    application_id INTEGER,
    context TEXT,
    text TEXT NOT NULL,
    learned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

let done = false;
export async function migrate(env: Env): Promise<void> {
  if (done) return;
  for (const sql of STEPS) {
    try {
      await env.DB.prepare(sql).run();
    } catch (e) {
      if (!/duplicate column|already exists/i.test(String(e))) throw e;
    }
  }
  done = true;
}
