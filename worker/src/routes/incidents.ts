// Incident reporting — same domain as fleet-app incidents.ts, reshaped for a
// gear library: injuries, near-misses, gear damage, policy violations.

import type { Env } from '../index';
import { json, err, newId, audit } from '../lib/util';

const TYPES = ['injury', 'near_miss', 'gear_damage', 'policy_violation', 'other'];

export const handleIncidents = {
  async list(env: Env, url: URL): Promise<Response> {
    const status = url.searchParams.get('status');
    let sql = `SELECT i.*, m.name AS member_name FROM incidents i LEFT JOIN members m ON m.id = i.member_id`;
    const binds: unknown[] = [];
    if (status) { sql += ' WHERE i.status = ?'; binds.push(status); }
    sql += ' ORDER BY i.created_at DESC LIMIT 200';
    const rows = await env.DB.prepare(sql).bind(...binds).all();
    return json(rows.results ?? []);
  },

  async create(request: Request, env: Env, actor: string): Promise<Response> {
    let b: any;
    try { b = await request.json(); } catch { return err('Invalid JSON'); }
    if (!b.description) return err('description is required');
    const id = newId('inc');
    await env.DB.prepare(
      `INSERT INTO incidents (id, member_id, checkout_id, type, description, occurred_at, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, b.member_id ?? null, b.checkout_id ?? null, TYPES.includes(b.type) ? b.type : 'other',
      b.description, b.occurred_at ?? null, actor).run();
    await audit(env, request, actor, 'incident.create', id, b);
    return json({ success: true, id });
  },

  async update(request: Request, env: Env, id: string, actor: string): Promise<Response> {
    let b: any;
    try { b = await request.json(); } catch { return err('Invalid JSON'); }
    const existing = await env.DB.prepare('SELECT * FROM incidents WHERE id = ?').bind(id).first<any>();
    if (!existing) return err('Incident not found', 404);
    const status = ['open', 'investigating', 'resolved'].includes(b.status) ? b.status : existing.status;
    await env.DB.prepare(
      `UPDATE incidents SET type = ?, description = ?, status = ?, follow_up = ?,
         resolved_at = CASE WHEN ? = 'resolved' AND resolved_at IS NULL THEN datetime('now') ELSE resolved_at END
       WHERE id = ?`,
    ).bind(TYPES.includes(b.type) ? b.type : existing.type, b.description ?? existing.description,
      status, b.follow_up ?? existing.follow_up, status, id).run();
    await audit(env, request, actor, 'incident.update', id, b);
    return json({ success: true });
  },
};
