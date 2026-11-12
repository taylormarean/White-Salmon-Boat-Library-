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
  checked = true;
}
