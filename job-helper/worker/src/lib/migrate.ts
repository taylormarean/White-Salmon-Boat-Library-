// Database version check. v2 (multi-account) changed the shape of most tables, so a v1 database is
// rebuilt by `npm run setup` (which asks first) rather than altered in place.
import type { Env } from '../env';

let checked = false;
export async function migrate(env: Env): Promise<void> {
  if (checked) return;
  const cols = (await env.DB.prepare("SELECT name FROM pragma_table_info('settings')").all<{ name: string }>()).results.map((c) => c.name);
  if (cols.length && !cols.includes('user_id')) {
    throw new Error('This database is from the single-user version of Next Chapter. Run `npm run setup` to upgrade it.');
  }
  // Tables added after v2 first shipped (kept in step with schema.sql).
  if (cols.length) {
    await env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS support_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, helpful INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_support_user ON support_messages(user_id, created_at)'),
    ]);
  }
  checked = true;
}
