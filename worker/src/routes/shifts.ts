// Volunteer shifts + signups — the crew/schedule system, adapted from
// fleet-app's tour claim flow (drivers claim tours -> volunteers claim shifts).

import type { Env } from '../index';
import { json, err, newId, audit } from '../lib/util';
import { getRequestJwtPayload } from '../lib/auth';

export const handleShifts = {
  /** GET /shifts — upcoming shifts with signup counts (?from=YYYY-MM-DD&all=1). */
  async list(request: Request, env: Env, url: URL): Promise<Response> {
    const payload = await getRequestJwtPayload(request, env);
    const from = url.searchParams.get('from') ?? new Date().toISOString().slice(0, 10);
    const includePast = url.searchParams.get('all') === '1';
    const rows = await env.DB.prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM shift_signups ss WHERE ss.shift_id = s.id) AS signed_up,
        (SELECT json_group_array(json_object('username', ss.username, 'name', u.display_name))
         FROM shift_signups ss JOIN users u ON u.username = ss.username WHERE ss.shift_id = s.id) AS volunteers_json,
        EXISTS(SELECT 1 FROM shift_signups ss WHERE ss.shift_id = s.id AND ss.username = ?) AS caller_signed_up
       FROM volunteer_shifts s
       WHERE s.cancelled_at IS NULL ${includePast ? '' : 'AND s.shift_date >= ?'}
       ORDER BY s.shift_date, s.start_time LIMIT 200`,
    ).bind(...(includePast ? [payload?.sub ?? ''] : [payload?.sub ?? '', from])).all<any>();
    const out = (rows.results ?? []).map((r: any) => ({ ...r, volunteers: JSON.parse(r.volunteers_json ?? '[]'), volunteers_json: undefined }));
    return json(out);
  },

  /** POST /shifts — staff create a shift. */
  async create(request: Request, env: Env, actor: string): Promise<Response> {
    let b: any;
    try { b = await request.json(); } catch { return err('Invalid JSON'); }
    if (!b.shift_date || !b.start_time || !b.end_time || !b.title) {
      return err('shift_date, start_time, end_time, and title are required');
    }
    const type = ['orientation', 'gear_maintenance', 'inventory_audit', 'event'].includes(b.shift_type) ? b.shift_type : 'orientation';
    const id = newId('shift');
    await env.DB.prepare(
      `INSERT INTO volunteer_shifts (id, shift_date, start_time, end_time, shift_type, title, notes, needed, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, b.shift_date, b.start_time, b.end_time, type, b.title, b.notes ?? null, Math.max(1, parseInt(b.needed) || 1), actor).run();
    await audit(env, request, actor, 'shift.create', id, b);
    return json({ success: true, id });
  },

  /** PUT /shifts/:id — staff edit; DELETE — soft-cancel (mirrors tours.cancelled_at). */
  async update(request: Request, env: Env, id: string, actor: string): Promise<Response> {
    let b: any;
    try { b = await request.json(); } catch { return err('Invalid JSON'); }
    const existing = await env.DB.prepare('SELECT * FROM volunteer_shifts WHERE id = ?').bind(id).first<any>();
    if (!existing) return err('Shift not found', 404);
    await env.DB.prepare(
      `UPDATE volunteer_shifts SET shift_date = ?, start_time = ?, end_time = ?, shift_type = ?, title = ?, notes = ?, needed = ? WHERE id = ?`,
    ).bind(
      b.shift_date ?? existing.shift_date, b.start_time ?? existing.start_time, b.end_time ?? existing.end_time,
      b.shift_type ?? existing.shift_type, b.title ?? existing.title, b.notes ?? existing.notes,
      b.needed !== undefined ? Math.max(1, parseInt(b.needed) || 1) : existing.needed, id,
    ).run();
    await audit(env, request, actor, 'shift.update', id, b);
    return json({ success: true });
  },

  async cancel(request: Request, env: Env, id: string, actor: string): Promise<Response> {
    const res = await env.DB.prepare(`UPDATE volunteer_shifts SET cancelled_at = datetime('now') WHERE id = ? AND cancelled_at IS NULL`).bind(id).run();
    if ((res.meta?.changes ?? 0) === 0) return err('Shift not found or already cancelled', 404);
    await audit(env, request, actor, 'shift.cancel', id);
    return json({ success: true });
  },

  /** POST /shifts/:id/signup + DELETE — volunteers claim/unclaim (the tour-claim pattern). */
  async signup(request: Request, env: Env, id: string): Promise<Response> {
    const payload = await getRequestJwtPayload(request, env);
    if (!payload) return err('Unauthorized', 401);
    const shift = await env.DB.prepare('SELECT * FROM volunteer_shifts WHERE id = ? AND cancelled_at IS NULL').bind(id).first<any>();
    if (!shift) return err('Shift not found', 404);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM shift_signups WHERE shift_id = ?').bind(id).first<any>();
    if ((count?.n ?? 0) >= shift.needed) return err('This shift is already full', 409);
    try {
      await env.DB.prepare('INSERT INTO shift_signups (shift_id, username) VALUES (?, ?)').bind(id, payload.sub).run();
    } catch {
      return err('You are already signed up for this shift', 409);
    }
    return json({ success: true });
  },

  async unsignup(request: Request, env: Env, id: string): Promise<Response> {
    const payload = await getRequestJwtPayload(request, env);
    if (!payload) return err('Unauthorized', 401);
    await env.DB.prepare('DELETE FROM shift_signups WHERE shift_id = ? AND username = ?').bind(id, payload.sub).run();
    return json({ success: true });
  },
};
