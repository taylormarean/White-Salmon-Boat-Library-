// Members: public self-signup with waiver (the self-serve front door),
// self-service profile, and the staff roster (adapted from fleet-app drivers.ts).

import type { Env } from '../index';
import { json, err, newId, audit, getSetting } from '../lib/util';
import { hashPassword, getRequestJwtPayload } from '../lib/auth';
import { notify } from '../lib/notify';

interface JoinBody {
  name?: string;
  email?: string;
  password?: string;
  phone?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  experience_level?: string;
  waiver_signature?: string;   // typed full legal name
  waiver_accepted?: boolean;
}

/** POST /public/join — create member + login account in one step. Waiver is mandatory. */
export async function handleJoin(request: Request, env: Env): Promise<Response> {
  let b: JoinBody;
  try { b = await request.json(); } catch { return err('Invalid JSON'); }

  const name = (b.name ?? '').trim();
  const email = (b.email ?? '').trim().toLowerCase();
  const password = b.password ?? '';
  const signature = (b.waiver_signature ?? '').trim();
  const experience = ['beginner', 'intermediate', 'advanced'].includes(b.experience_level ?? '') ? b.experience_level! : 'beginner';

  if (!name) return err('Full name is required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('A valid email is required');
  if (password.length < 6) return err('Password must be at least 6 characters');
  if (!b.waiver_accepted) return err('You must accept the liability waiver to join');
  if (!signature) return err('Type your full legal name to sign the waiver');
  if (!b.emergency_contact_name || !b.emergency_contact_phone) return err('Emergency contact name and phone are required');

  const existingUser = await env.DB.prepare('SELECT username FROM users WHERE username = ?').bind(email).first();
  const existingMember = await env.DB.prepare('SELECT id FROM members WHERE email = ?').bind(email).first();
  if (existingUser || existingMember) return err('An account with this email already exists. Sign in instead.', 409);

  const memberId = newId('mem');
  const waiverVersion = parseInt((await getSetting(env, 'waiver_version')) ?? '1');
  const passwordHash = await hashPassword(password);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO members (id, name, email, phone, emergency_contact_name, emergency_contact_phone,
         experience_level, waiver_signed_at, waiver_version, waiver_signature, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, 'active')`,
    ).bind(memberId, name, email, b.phone ?? null, b.emergency_contact_name, b.emergency_contact_phone, experience, waiverVersion, signature),
    env.DB.prepare(
      `INSERT INTO users (username, password_hash, display_name, role, phone, member_id)
       VALUES (?, ?, ?, 'member', ?, ?)`,
    ).bind(email, passwordHash, name, b.phone ?? null, memberId),
  ]);

  const orientationInfo = (await getSetting(env, 'orientation_info')) ?? '';
  await notify(env, {
    category: 'welcome',
    recipient: email,
    member_id: memberId,
    subject: 'Welcome to the White Salmon Boat Library',
    body:
      `Hi ${name},\n\nYour membership is set up and your waiver is on file. ` +
      `You can now check out gear yourself at whitesalmonboatlibrary.org — sign in, pick your gear, ` +
      `and you'll get the shed access code.\n\n${orientationInfo}\n\n` +
      `Remember the library rules: zero tolerance for drugs and alcohol with library gear, always wear a PFD on the water, ` +
      `and if you're new to kayaking you must paddle with an experienced buddy.\n\nSee you on the river!`,
  });

  return json({ success: true, member_id: memberId });
}

/** GET /me/member — the caller's member record + active checkouts. */
export async function handleMe(request: Request, env: Env): Promise<Response> {
  const payload = await getRequestJwtPayload(request, env);
  if (!payload) return err('Unauthorized', 401);

  const member = await env.DB.prepare(
    `SELECT m.* FROM members m
     JOIN users u ON u.member_id = m.id
     WHERE u.username = ?`,
  ).bind(payload.sub).first();
  if (!member) return err('No member record linked to this account', 404);

  const checkouts = await env.DB.prepare(
    `SELECT c.*,
       (SELECT json_group_array(json_object(
          'gear_item_id', ci.gear_item_id, 'returned_at', ci.returned_at,
          'gear_code', g.gear_code, 'name', g.name, 'brand', g.brand, 'model', g.model, 'color', g.color, 'size', g.size))
        FROM checkout_items ci JOIN gear_items g ON g.id = ci.gear_item_id
        WHERE ci.checkout_id = c.id) AS items_json
     FROM checkouts c
     WHERE c.member_id = ? AND c.status = 'active'
     ORDER BY c.checked_out_at DESC`,
  ).bind((member as any).id).all();

  const rows = (checkouts.results ?? []).map((r: any) => ({ ...r, items: JSON.parse(r.items_json ?? '[]'), items_json: undefined }));
  return json({ member, active_checkouts: rows });
}

/** Staff roster + member management. */
export const handleMembers = {
  /** GET /members — staff list with waiver / orientation / checkout status. */
  async list(env: Env): Promise<Response> {
    const rows = await env.DB.prepare(
      `SELECT m.*,
        (SELECT COUNT(*) FROM checkouts c WHERE c.member_id = m.id AND c.status = 'active') AS active_checkouts,
        (SELECT COUNT(*) FROM checkouts c WHERE c.member_id = m.id AND c.status = 'active' AND c.due_at < datetime('now')) AS overdue_checkouts,
        (SELECT COUNT(*) FROM checkouts c WHERE c.member_id = m.id) AS lifetime_checkouts
       FROM members m
       ORDER BY m.created_at DESC`,
    ).all();
    return json(rows.results ?? []);
  },

  /** GET /members/:id — detail with checkout history + incidents. */
  async detail(env: Env, id: string): Promise<Response> {
    const member = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(id).first();
    if (!member) return err('Member not found', 404);
    const checkouts = await env.DB.prepare(
      `SELECT c.*,
         (SELECT json_group_array(g.gear_code) FROM checkout_items ci JOIN gear_items g ON g.id = ci.gear_item_id WHERE ci.checkout_id = c.id) AS gear_codes
       FROM checkouts c WHERE c.member_id = ? ORDER BY c.checked_out_at DESC LIMIT 50`,
    ).bind(id).all();
    const incidents = await env.DB.prepare('SELECT * FROM incidents WHERE member_id = ? ORDER BY created_at DESC').bind(id).all();
    return json({ member, checkouts: checkouts.results ?? [], incidents: incidents.results ?? [] });
  },

  /** PUT /members/:id — staff edit (experience, notes, orientation, contact). */
  async update(request: Request, env: Env, id: string, actor: string): Promise<Response> {
    let b: any;
    try { b = await request.json(); } catch { return err('Invalid JSON'); }
    const existing = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(id).first<any>();
    if (!existing) return err('Member not found', 404);

    const experience = ['beginner', 'intermediate', 'advanced'].includes(b.experience_level) ? b.experience_level : existing.experience_level;
    const orientationCompleted =
      b.orientation_completed === true ? (existing.orientation_completed_at ?? new Date().toISOString()) :
      b.orientation_completed === false ? null : existing.orientation_completed_at;

    await env.DB.prepare(
      `UPDATE members SET name = ?, phone = ?, emergency_contact_name = ?, emergency_contact_phone = ?,
         experience_level = ?, orientation_completed_at = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(
      b.name ?? existing.name, b.phone ?? existing.phone,
      b.emergency_contact_name ?? existing.emergency_contact_name, b.emergency_contact_phone ?? existing.emergency_contact_phone,
      experience, orientationCompleted, b.notes ?? existing.notes, id,
    ).run();
    await audit(env, request, actor, 'member.update', id, b);
    return json({ success: true });
  },

  /** PUT /members/:id/status — suspend / reinstate / terminate. */
  async setStatus(request: Request, env: Env, id: string, actor: string): Promise<Response> {
    let b: { status?: string; reason?: string };
    try { b = await request.json(); } catch { return err('Invalid JSON'); }
    if (!['active', 'suspended', 'terminated'].includes(b.status ?? '')) return err('status must be active, suspended, or terminated');

    const member = await env.DB.prepare('SELECT email, name FROM members WHERE id = ?').bind(id).first<any>();
    if (!member) return err('Member not found', 404);

    await env.DB.prepare(
      `UPDATE members SET status = ?, suspension_reason = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(b.status, b.status === 'active' ? null : (b.reason ?? null), id).run();

    // Membership termination also disables the login (WSBL policy: violations end membership).
    if (b.status === 'terminated') {
      await env.DB.prepare(`UPDATE users SET role = 'disabled', updated_at = datetime('now') WHERE member_id = ?`).bind(id).run();
    }
    await audit(env, request, actor, `member.${b.status}`, id, { reason: b.reason });
    return json({ success: true });
  },
};
