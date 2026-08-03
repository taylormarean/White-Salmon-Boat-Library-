// Admin: user CRUD, settings, audit log viewer — same patterns as fleet-app's
// admin.ts (audit every mutation) minus impersonation.

import type { Env } from '../index';
import { json, err, audit, getSetting, setSetting } from '../lib/util';
import { hashPassword } from '../lib/auth';

const ROLES = ['admin', 'librarian', 'volunteer', 'member', 'disabled'];

// Runtime-togglable settings an admin may edit from the UI. Anything else 400s.
const EDITABLE_SETTINGS = [
  'app_name', 'standard_loan_days', 'max_loan_days', 'max_items_per_checkout', 'door_code_mode',
  'notifications_paused', 'notifications_pause_reason', 'orientation_info',
  'waiver_version', 'library_address', 'staff_digest_email',
];

export const handleAdmin = {
  /** GET /admin/users */
  async listUsers(env: Env): Promise<Response> {
    const rows = await env.DB.prepare(
      `SELECT u.username, u.display_name, u.role, u.phone, u.member_id, u.last_login_at, u.created_at, m.name AS member_name
       FROM users u LEFT JOIN members m ON m.id = u.member_id ORDER BY u.created_at DESC`,
    ).all();
    return json(rows.results ?? []);
  },

  /** POST /admin/users — create a staff/volunteer account. */
  async createUser(request: Request, env: Env, actor: string): Promise<Response> {
    let b: any;
    try { b = await request.json(); } catch { return err('Invalid JSON'); }
    const username = (b.username ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(username)) return err('username must be an email address');
    if (!b.display_name) return err('display_name is required');
    if ((b.password ?? '').length < 6) return err('password must be at least 6 characters');
    const role = ROLES.includes(b.role) ? b.role : 'volunteer';

    const dup = await env.DB.prepare('SELECT username FROM users WHERE username = ?').bind(username).first();
    if (dup) return err('A user with this email already exists', 409);

    const hash = await hashPassword(b.password);
    await env.DB.prepare(
      `INSERT INTO users (username, password_hash, display_name, role, phone, member_id) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(username, hash, b.display_name, role, b.phone ?? null, b.member_id ?? null).run();
    await audit(env, request, actor, 'user.create', username, { role });
    return json({ success: true });
  },

  /** PUT /admin/users/:username — role/name/phone changes + password reset. */
  async updateUser(request: Request, env: Env, username: string, actor: string): Promise<Response> {
    let b: any;
    try { b = await request.json(); } catch { return err('Invalid JSON'); }
    const existing = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<any>();
    if (!existing) return err('User not found', 404);

    // Guard: an admin cannot demote or disable themselves (lockout protection).
    if (username === actor && b.role && b.role !== 'admin') {
      return err('You cannot change your own admin role', 409);
    }
    const role = ROLES.includes(b.role) ? b.role : existing.role;
    await env.DB.prepare(
      `UPDATE users SET display_name = ?, role = ?, phone = ?, member_id = ?, updated_at = datetime('now') WHERE username = ?`,
    ).bind(b.display_name ?? existing.display_name, role, b.phone ?? existing.phone,
      b.member_id !== undefined ? b.member_id : existing.member_id, username).run();

    if (b.new_password) {
      if (b.new_password.length < 6) return err('password must be at least 6 characters');
      const hash = await hashPassword(b.new_password);
      await env.DB.prepare('UPDATE users SET password_hash = ? WHERE username = ?').bind(hash, username).run();
      await audit(env, request, actor, 'user.password_reset', username);
    }
    await audit(env, request, actor, 'user.update', username, { role });
    return json({ success: true });
  },

  /** GET /admin/audit — the audit log viewer. */
  async auditLog(env: Env, url: URL): Promise<Response> {
    const limit = Math.min(500, parseInt(url.searchParams.get('limit') ?? '100'));
    const rows = await env.DB.prepare('SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT ?').bind(limit).all();
    return json(rows.results ?? []);
  },

  /** GET /settings (staff read) */
  async getSettings(env: Env): Promise<Response> {
    const rows = await env.DB.prepare('SELECT key, value FROM settings').all<any>();
    const out: Record<string, string> = {};
    for (const r of rows.results ?? []) out[r.key] = r.value;
    return json(out);
  },

  /** PUT /admin/settings — admin update (whitelisted keys only). */
  async updateSettings(request: Request, env: Env, actor: string): Promise<Response> {
    let b: Record<string, unknown>;
    try { b = await request.json(); } catch { return err('Invalid JSON'); }
    const updates: Record<string, string> = {};
    for (const [k, v] of Object.entries(b)) {
      if (!EDITABLE_SETTINGS.includes(k)) return err(`Setting "${k}" is not editable`);
      updates[k] = String(v);
    }
    if (updates.door_code_mode && !['per_checkout', 'daily'].includes(updates.door_code_mode)) {
      return err('door_code_mode must be per_checkout or daily');
    }
    for (const [k, v] of Object.entries(updates)) await setSetting(env, k, v);
    await audit(env, request, actor, 'settings.update', null as any, updates);
    return json({ success: true });
  },

  /** GET /notifications/log — staff view of the outbound log. */
  async notificationLog(env: Env, url: URL): Promise<Response> {
    const limit = Math.min(500, parseInt(url.searchParams.get('limit') ?? '100'));
    const rows = await env.DB.prepare('SELECT * FROM notification_log ORDER BY sent_at DESC LIMIT ?').bind(limit).all();
    return json(rows.results ?? []);
  },
};

/** GET /public/info — app name, orientation info, waiver text bits for the join page. */
export async function handlePublicInfo(env: Env): Promise<Response> {
  const [appName, orientation, address, waiverVersion] = await Promise.all([
    getSetting(env, 'app_name'), getSetting(env, 'orientation_info'),
    getSetting(env, 'library_address'), getSetting(env, 'waiver_version'),
  ]);
  return json({
    app_name: appName ?? 'White Salmon Boat Library',
    orientation_info: orientation ?? '',
    library_address: address ?? '',
    waiver_version: parseInt(waiverVersion ?? '1'),
  });
}
