// Gear inventory + maintenance queue (adapted from fleet-app vehicles + service records).
// Status model mirrors vehicles: available / checked_out / maintenance / retired,
// soft-delete via active=0, oos_reason for anything pulled from circulation.

import type { Env } from '../index';
import { json, err, newId, audit } from '../lib/util';

export const handleGear = {
  /**
   * GET /gear — public availability list (members browse before check-in).
   * `includeSensitive` (staff callers only, decided at the router) keeps
   * oos_reason/notes — they can quote member damage reports.
   */
  async list(env: Env, url: URL, includeSensitive = false): Promise<Response> {
    const category = url.searchParams.get('category');
    const includeInactive = url.searchParams.get('all') === '1';
    let sql = `
      SELECT g.*, cat.name AS category_name,
        (SELECT COUNT(*) FROM gear_maintenance gm WHERE gm.gear_item_id = g.id AND gm.status != 'resolved') AS open_issues,
        (SELECT c.due_at FROM checkout_items ci JOIN checkouts c ON c.id = ci.checkout_id
         WHERE ci.gear_item_id = g.id AND ci.returned_at IS NULL AND c.status = 'active'
         ORDER BY c.checked_out_at DESC LIMIT 1) AS due_back_at
      FROM gear_items g JOIN gear_categories cat ON cat.id = g.category_id
      WHERE 1=1`;
    const binds: unknown[] = [];
    if (!includeInactive) sql += ' AND g.active = 1';
    if (category) { sql += ' AND g.category_id = ?'; binds.push(category); }
    sql += ' ORDER BY cat.sort, g.gear_code';
    const rows = await env.DB.prepare(sql).bind(...binds).all();
    const out = (rows.results ?? []).map((g: any) =>
      includeSensitive ? g : { ...g, oos_reason: g.oos_reason ? 'In for repair' : null, notes: null },
    );
    return json(out);
  },

  /** GET /gear/categories */
  async categories(env: Env): Promise<Response> {
    const rows = await env.DB.prepare('SELECT * FROM gear_categories ORDER BY sort').all();
    return json(rows.results ?? []);
  },

  /** POST /gear — staff add an item. */
  async create(request: Request, env: Env, actor: string): Promise<Response> {
    let b: any;
    try { b = await request.json(); } catch { return err('Invalid JSON'); }
    if (!b.category_id || !b.gear_code || !b.name) return err('category_id, gear_code, and name are required');

    const cat = await env.DB.prepare('SELECT id FROM gear_categories WHERE id = ?').bind(b.category_id).first();
    if (!cat) return err('Unknown category');
    const dup = await env.DB.prepare('SELECT id FROM gear_items WHERE gear_code = ?').bind(b.gear_code).first();
    if (dup) return err(`Gear code ${b.gear_code} is already in use`, 409);

    const id = newId('gear');
    await env.DB.prepare(
      `INSERT INTO gear_items (id, category_id, gear_code, name, brand, model, color, size, condition, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, b.category_id, b.gear_code, b.name, b.brand ?? null, b.model ?? null, b.color ?? null, b.size ?? null,
      ['excellent', 'good', 'fair', 'poor'].includes(b.condition) ? b.condition : 'good', b.notes ?? null).run();
    await audit(env, request, actor, 'gear.create', id, b);
    return json({ success: true, id });
  },

  /** PUT /gear/:id — staff edit. */
  async update(request: Request, env: Env, id: string, actor: string): Promise<Response> {
    let b: any;
    try { b = await request.json(); } catch { return err('Invalid JSON'); }
    const existing = await env.DB.prepare('SELECT * FROM gear_items WHERE id = ?').bind(id).first<any>();
    if (!existing) return err('Gear item not found', 404);
    if (b.gear_code && b.gear_code !== existing.gear_code) {
      const dup = await env.DB.prepare('SELECT id FROM gear_items WHERE gear_code = ? AND id != ?').bind(b.gear_code, id).first();
      if (dup) return err(`Gear code ${b.gear_code} is already in use`, 409);
    }
    await env.DB.prepare(
      `UPDATE gear_items SET gear_code = ?, name = ?, brand = ?, model = ?, color = ?, size = ?, condition = ?, notes = ?, active = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(
      b.gear_code ?? existing.gear_code, b.name ?? existing.name, b.brand ?? existing.brand, b.model ?? existing.model,
      b.color ?? existing.color, b.size ?? existing.size,
      ['excellent', 'good', 'fair', 'poor'].includes(b.condition) ? b.condition : existing.condition,
      b.notes ?? existing.notes, b.active === undefined ? existing.active : (b.active ? 1 : 0), id,
    ).run();
    await audit(env, request, actor, 'gear.update', id, b);
    return json({ success: true });
  },

  /**
   * PUT /gear/:id/status — pull from / return to circulation.
   * Mirrors the vehicle OOS toggle: maintenance and retired need a reason.
   */
  async setStatus(request: Request, env: Env, id: string, actor: string): Promise<Response> {
    let b: { status?: string; reason?: string };
    try { b = await request.json(); } catch { return err('Invalid JSON'); }
    if (!['available', 'maintenance', 'retired'].includes(b.status ?? '')) {
      return err('status must be available, maintenance, or retired (checked_out is set by the checkout flow)');
    }
    const existing = await env.DB.prepare('SELECT status FROM gear_items WHERE id = ?').bind(id).first<any>();
    if (!existing) return err('Gear item not found', 404);
    if (existing.status === 'checked_out') return err('Item is currently checked out — process the return first', 409);
    if (b.status !== 'available' && !b.reason) return err('A reason is required when pulling gear from circulation');

    await env.DB.prepare(`UPDATE gear_items SET status = ?, oos_reason = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(b.status, b.status === 'available' ? null : b.reason, id).run();
    await audit(env, request, actor, 'gear.status', id, b);
    return json({ success: true });
  },

  /** GET /gear/maintenance — the open repair queue. */
  async maintenanceList(env: Env, url: URL): Promise<Response> {
    const status = url.searchParams.get('status');
    let sql = `
      SELECT gm.*, g.gear_code, g.name AS gear_name, g.brand, g.model, g.status AS gear_status
      FROM gear_maintenance gm JOIN gear_items g ON g.id = gm.gear_item_id`;
    const binds: unknown[] = [];
    if (status) { sql += ' WHERE gm.status = ?'; binds.push(status); }
    sql += ' ORDER BY gm.created_at DESC LIMIT 200';
    const rows = await env.DB.prepare(sql).bind(...binds).all();
    return json(rows.results ?? []);
  },

  /** POST /gear/:id/maintenance — staff log an issue directly. */
  async maintenanceCreate(request: Request, env: Env, gearId: string, actor: string): Promise<Response> {
    let b: any;
    try { b = await request.json(); } catch { return err('Invalid JSON'); }
    if (!b.issue) return err('issue is required');
    const gear = await env.DB.prepare('SELECT id, status FROM gear_items WHERE id = ?').bind(gearId).first<any>();
    if (!gear) return err('Gear item not found', 404);

    const id = newId('mnt');
    const severity = ['minor', 'major', 'unusable'].includes(b.severity) ? b.severity : 'minor';
    await env.DB.prepare(
      `INSERT INTO gear_maintenance (id, gear_item_id, reported_by, source, issue, severity) VALUES (?, ?, ?, 'staff', ?, ?)`,
    ).bind(id, gearId, actor, b.issue, severity).run();

    // Major/unusable damage pulls the item from circulation automatically (safeguard).
    if (severity !== 'minor' && gear.status === 'available') {
      await env.DB.prepare(`UPDATE gear_items SET status = 'maintenance', oos_reason = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(b.issue, gearId).run();
    }
    await audit(env, request, actor, 'gear.maintenance.create', id, b);
    return json({ success: true, id });
  },

  /** PUT /gear/maintenance/:id — progress / resolve an issue. */
  async maintenanceUpdate(request: Request, env: Env, id: string, actor: string): Promise<Response> {
    let b: { status?: string; resolution_notes?: string; return_to_service?: boolean };
    try { b = await request.json(); } catch { return err('Invalid JSON'); }
    const existing = await env.DB.prepare('SELECT * FROM gear_maintenance WHERE id = ?').bind(id).first<any>();
    if (!existing) return err('Maintenance record not found', 404);
    const status = ['open', 'in_progress', 'resolved'].includes(b.status ?? '') ? b.status! : existing.status;

    await env.DB.prepare(
      `UPDATE gear_maintenance SET status = ?, resolution_notes = ?, resolved_at = CASE WHEN ? = 'resolved' THEN datetime('now') ELSE resolved_at END
       WHERE id = ?`,
    ).bind(status, b.resolution_notes ?? existing.resolution_notes, status, id).run();

    // Optionally put the gear back in circulation once fixed.
    if (status === 'resolved' && b.return_to_service) {
      const open = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM gear_maintenance WHERE gear_item_id = ? AND status != 'resolved'`,
      ).bind(existing.gear_item_id).first<any>();
      if ((open?.n ?? 0) === 0) {
        await env.DB.prepare(
          `UPDATE gear_items SET status = 'available', oos_reason = NULL, updated_at = datetime('now') WHERE id = ? AND status = 'maintenance'`,
        ).bind(existing.gear_item_id).run();
      }
    }
    await audit(env, request, actor, 'gear.maintenance.update', id, b);
    return json({ success: true });
  },
};
