// Self-serve checkout — the heart of the system. Adapted from the Gorge rides
// tour state machine: the digital replacement for WSBL's paper checkout board.
//
// Lifecycle: member self checks in (waiver + safety acks enforced) -> gear items
// atomically flip to checked_out -> shed access code issued (and audited) ->
// member self-returns with a per-item condition report -> damage auto-opens a
// maintenance ticket and pulls the item from circulation.

import type { Env } from '../index';
import { json, err, newId, audit, getSetting, randomAccessCode, dailyAccessCode, todayPacific } from '../lib/util';
import { getRequestJwtPayload } from '../lib/auth';
import { notify } from '../lib/notify';

async function callerMember(request: Request, env: Env): Promise<{ member: any; username: string } | null> {
  const payload = await getRequestJwtPayload(request, env);
  if (!payload) return null;
  const member = await env.DB.prepare(
    `SELECT m.* FROM members m JOIN users u ON u.member_id = m.id WHERE u.username = ?`,
  ).bind(payload.sub).first<any>();
  if (!member) return null;
  return { member, username: payload.sub };
}

async function issueAccessCode(env: Env, checkoutId: string, memberId: string): Promise<{ code: string; mode: string }> {
  const mode = (await getSetting(env, 'door_code_mode')) === 'daily' ? 'daily' : 'per_checkout';
  const code = mode === 'daily'
    ? await dailyAccessCode(env.DOOR_CODE_SECRET ?? env.JWT_SECRET ?? 'change-me', todayPacific())
    : randomAccessCode();
  await env.DB.prepare('INSERT INTO access_code_log (checkout_id, member_id, code, mode) VALUES (?, ?, ?, ?)')
    .bind(checkoutId, memberId, code, mode).run();
  return { code, mode };
}

export const handleCheckouts = {
  /**
   * POST /checkouts/self — the digital checkout board row.
   * Enforces every safeguard the paper SOP relied on a human for:
   *   - membership active, waiver on file and current version
   *   - no overdue gear already out
   *   - item count and loan-length limits
   *   - all four safety acknowledgments; beginners must name a buddy
   *   - every requested item actually available (atomic — no double-checkout)
   */
  async selfCheckout(request: Request, env: Env): Promise<Response> {
    const caller = await callerMember(request, env);
    if (!caller) return err('Sign in with your member account first', 401);
    const m = caller.member;

    let b: {
      gear_item_ids?: string[]; due_at?: string;
      ack_sober?: boolean; ack_pfd?: boolean; ack_experience?: boolean; ack_condition?: boolean;
      buddy_name?: string; planned_river_section?: string;
    };
    try { b = await request.json(); } catch { return err('Invalid JSON'); }

    // --- Membership safeguards ---
    if (m.status !== 'active') {
      return err(m.status === 'suspended'
        ? `Your membership is suspended${m.suspension_reason ? `: ${m.suspension_reason}` : ''}. Contact the library.`
        : 'Your membership is not active. Contact the library.', 403);
    }
    if (!m.waiver_signed_at) return err('We need a signed waiver on file before you can check out gear.', 403);
    const currentWaiver = parseInt((await getSetting(env, 'waiver_version')) ?? '1');
    if ((m.waiver_version ?? 0) < currentWaiver) {
      return err('Our liability waiver has been updated — please re-sign it before checking out gear.', 403);
    }

    const overdue = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM checkouts WHERE member_id = ? AND status = 'active' AND due_at < datetime('now')`,
    ).bind(m.id).first<any>();
    if ((overdue?.n ?? 0) > 0) {
      return err('You have overdue gear. Return it (or ask the library for an extension) before checking out more.', 409);
    }

    // --- Safety acknowledgments (the SOP, enforced) ---
    if (!b.ack_sober || !b.ack_pfd || !b.ack_experience || !b.ack_condition) {
      return err('All safety acknowledgments are required.');
    }
    if (m.experience_level === 'beginner' && !(b.buddy_name ?? '').trim()) {
      return err('Library policy: paddlers new to the sport must go with an experienced buddy. Enter the name of who you are paddling with.');
    }

    // --- Item + loan-length limits ---
    const ids = [...new Set(b.gear_item_ids ?? [])];
    if (ids.length === 0) return err('Pick at least one piece of gear.');
    const maxItems = parseInt((await getSetting(env, 'max_items_per_checkout')) ?? '6');
    if (ids.length > maxItems) return err(`You can check out at most ${maxItems} items at a time.`);

    const maxLoanDays = parseInt((await getSetting(env, 'max_loan_days')) ?? '7');
    const due = new Date(b.due_at ?? '');
    if (isNaN(due.getTime())) return err('A return date is required.');
    const now = new Date();
    if (due.getTime() < now.getTime()) return err('The return date must be in the future.');
    if (due.getTime() > now.getTime() + maxLoanDays * 86_400_000 + 60_000) {
      return err(`Loans are limited to ${maxLoanDays} days. Pick an earlier return date.`);
    }

    // --- Availability check + atomic claim (mirrors the tour-claim guard) ---
    const placeholders = ids.map(() => '?').join(',');
    const items = await env.DB.prepare(
      `SELECT id, gear_code, name, brand, model, status, active FROM gear_items WHERE id IN (${placeholders})`,
    ).bind(...ids).all<any>();
    const found = items.results ?? [];
    if (found.length !== ids.length) return err('One or more selected items no longer exist.');
    const unavailable = found.filter((g: any) => g.status !== 'available' || !g.active);
    if (unavailable.length > 0) {
      return err(`Not available: ${unavailable.map((g: any) => `${g.gear_code} (${g.status})`).join(', ')}. Refresh and pick again.`, 409);
    }

    const checkoutId = newId('co');
    const dueIso = due.toISOString();

    // Atomic flip: UPDATE ... WHERE status='available' — a concurrent checkout
    // of the same item changes 0 rows and we roll back the whole thing.
    const claim = await env.DB.prepare(
      `UPDATE gear_items SET status = 'checked_out', updated_at = datetime('now')
       WHERE id IN (${placeholders}) AND status = 'available' AND active = 1`,
    ).bind(...ids).run();
    if ((claim.meta?.changes ?? 0) !== ids.length) {
      // Someone beat us to at least one item — release whatever we grabbed.
      await env.DB.prepare(
        `UPDATE gear_items SET status = 'available' WHERE id IN (${placeholders}) AND status = 'checked_out'
         AND id NOT IN (SELECT gear_item_id FROM checkout_items WHERE returned_at IS NULL)`,
      ).bind(...ids).run();
      return err('Someone just checked out one of those items. Refresh and pick again.', 409);
    }

    const stmts = [
      env.DB.prepare(
        `INSERT INTO checkouts (id, member_id, status, due_at, ack_sober, ack_pfd, ack_experience, ack_condition, buddy_name, planned_river_section)
         VALUES (?, ?, 'active', ?, 1, 1, 1, 1, ?, ?)`,
      ).bind(checkoutId, m.id, dueIso, (b.buddy_name ?? '').trim() || null, (b.planned_river_section ?? '').trim() || null),
      ...ids.map((gid) =>
        env.DB.prepare('INSERT INTO checkout_items (checkout_id, gear_item_id) VALUES (?, ?)').bind(checkoutId, gid),
      ),
    ];
    await env.DB.batch(stmts);

    const { code, mode } = await issueAccessCode(env, checkoutId, m.id);
    await env.DB.prepare('UPDATE checkouts SET access_code = ? WHERE id = ?').bind(code, checkoutId).run();

    const gearList = found.map((g: any) => `- ${g.gear_code}: ${[g.brand, g.model, g.name].filter(Boolean).join(' ')}`).join('\n');
    await notify(env, {
      category: 'checkout_confirmation',
      recipient: m.email,
      member_id: m.id,
      checkout_id: checkoutId,
      subject: `Your gear is reserved — shed code ${code}`,
      body:
        `Hi ${m.name},\n\nYour checkout is confirmed. Shed access code: ${code}\n\n` +
        `Gear:\n${gearList}\n\nDue back: ${due.toDateString()}\n\n` +
        `On your way out, initial the physical board if it's still up, close the shed, and scramble the lock. ` +
        `When you bring the gear back, mark it returned in the app and note any damage — honest damage reports keep the library running.\n\n` +
        `River rules: PFD on the water, zero tolerance for drugs/alcohol with library gear, beginners paddle with a buddy.`,
    });

    return json({
      success: true,
      checkout_id: checkoutId,
      access_code: code,
      code_mode: mode,
      due_at: dueIso,
      items: found.map((g: any) => ({ id: g.id, gear_code: g.gear_code, name: g.name, brand: g.brand, model: g.model })),
    });
  },

  /**
   * POST /checkouts/:id/return — member self-return with per-item condition report.
   * Body: { items: [{ gear_item_id, condition: 'ok'|'damaged', damage_notes? }], return_notes? }
   * Damaged items go straight to the maintenance queue and out of circulation.
   */
  async selfReturn(request: Request, env: Env, checkoutId: string): Promise<Response> {
    const caller = await callerMember(request, env);
    if (!caller) return err('Sign in with your member account first', 401);

    const checkout = await env.DB.prepare('SELECT * FROM checkouts WHERE id = ?').bind(checkoutId).first<any>();
    if (!checkout) return err('Checkout not found', 404);
    if (checkout.member_id !== caller.member.id) return err('This checkout belongs to a different member.', 403);
    if (checkout.status !== 'active') return err('This checkout is already closed.', 409);

    let b: { items?: { gear_item_id: string; condition?: string; damage_notes?: string }[]; return_notes?: string };
    try { b = await request.json(); } catch { return err('Invalid JSON'); }

    const outstanding = await env.DB.prepare(
      `SELECT ci.gear_item_id, g.gear_code, g.name FROM checkout_items ci JOIN gear_items g ON g.id = ci.gear_item_id
       WHERE ci.checkout_id = ? AND ci.returned_at IS NULL`,
    ).bind(checkoutId).all<any>();
    const outstandingIds = new Set((outstanding.results ?? []).map((r: any) => r.gear_item_id));

    const reported = (b.items ?? []).filter((i) => outstandingIds.has(i.gear_item_id));
    if (reported.length === 0) return err('Select which items you are returning.');

    for (const item of reported) {
      const damaged = item.condition === 'damaged';
      if (damaged && !(item.damage_notes ?? '').trim()) {
        return err('Describe the damage for each damaged item — honest reports are part of the library agreement.');
      }
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE checkout_items SET returned_at = datetime('now'), condition_on_return = ?, damage_notes = ? WHERE checkout_id = ? AND gear_item_id = ?`,
        ).bind(damaged ? 'damaged' : 'ok', damaged ? item.damage_notes : null, checkoutId, item.gear_item_id),
        env.DB.prepare(
          `UPDATE gear_items SET status = ?, oos_reason = ?, updated_at = datetime('now') WHERE id = ?`,
        ).bind(damaged ? 'maintenance' : 'available', damaged ? `Damage reported on return: ${item.damage_notes}` : null, item.gear_item_id),
      ]);
      if (damaged) {
        await env.DB.prepare(
          `INSERT INTO gear_maintenance (id, gear_item_id, reported_by, source, issue, severity) VALUES (?, ?, ?, 'return', ?, 'major')`,
        ).bind(newId('mnt'), item.gear_item_id, caller.member.id, item.damage_notes).run();
      }
    }

    // Close the checkout once every item is back.
    const stillOut = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM checkout_items WHERE checkout_id = ? AND returned_at IS NULL`,
    ).bind(checkoutId).first<any>();
    const complete = (stillOut?.n ?? 0) === 0;
    if (complete) {
      await env.DB.prepare(
        `UPDATE checkouts SET status = 'returned', returned_at = datetime('now'), return_notes = ? WHERE id = ?`,
      ).bind((b.return_notes ?? '').trim() || null, checkoutId).run();
    } else if ((b.return_notes ?? '').trim()) {
      await env.DB.prepare('UPDATE checkouts SET return_notes = ? WHERE id = ?').bind(b.return_notes!.trim(), checkoutId).run();
    }

    return json({ success: true, complete, items_returned: reported.length });
  },

  /** GET /checkouts — staff list. ?status=active|returned|overdue */
  async list(env: Env, url: URL): Promise<Response> {
    const status = url.searchParams.get('status');
    let where = '1=1';
    if (status === 'active') where = `c.status = 'active'`;
    else if (status === 'returned') where = `c.status = 'returned'`;
    else if (status === 'overdue') where = `c.status = 'active' AND c.due_at < datetime('now')`;

    const rows = await env.DB.prepare(
      `SELECT c.*, m.name AS member_name, m.email AS member_email, m.phone AS member_phone, m.experience_level,
        (SELECT json_group_array(json_object('gear_item_id', ci.gear_item_id, 'gear_code', g.gear_code, 'name', g.name,
           'returned_at', ci.returned_at, 'condition_on_return', ci.condition_on_return, 'damage_notes', ci.damage_notes))
         FROM checkout_items ci JOIN gear_items g ON g.id = ci.gear_item_id WHERE ci.checkout_id = c.id) AS items_json
       FROM checkouts c JOIN members m ON m.id = c.member_id
       WHERE ${where}
       ORDER BY c.checked_out_at DESC LIMIT 300`,
    ).all<any>();
    const out = (rows.results ?? []).map((r: any) => ({ ...r, items: JSON.parse(r.items_json ?? '[]'), items_json: undefined }));
    return json(out);
  },

  /** PUT /checkouts/:id/extend — staff extend a due date. */
  async extend(request: Request, env: Env, checkoutId: string, actor: string): Promise<Response> {
    let b: { due_at?: string };
    try { b = await request.json(); } catch { return err('Invalid JSON'); }
    const due = new Date(b.due_at ?? '');
    if (isNaN(due.getTime())) return err('A valid new due date is required');
    const checkout = await env.DB.prepare(`SELECT id, status FROM checkouts WHERE id = ?`).bind(checkoutId).first<any>();
    if (!checkout) return err('Checkout not found', 404);
    if (checkout.status !== 'active') return err('Only active checkouts can be extended', 409);

    await env.DB.prepare(`UPDATE checkouts SET due_at = ?, extended_by = ? WHERE id = ?`)
      .bind(due.toISOString(), actor, checkoutId).run();
    // Re-arm reminders for the new due date (fleet-app dedupe contract: delete = eligible again).
    await env.DB.prepare(`DELETE FROM reminder_log WHERE checkout_id = ?`).bind(checkoutId).run();
    await audit(env, request, actor, 'checkout.extend', checkoutId, b);
    return json({ success: true });
  },

  /** POST /checkouts/:id/force-return — staff close out a checkout (lost gear, no-show return). */
  async forceReturn(request: Request, env: Env, checkoutId: string, actor: string): Promise<Response> {
    let b: { notes?: string; mark_items?: string };
    try { b = await request.json(); } catch { b = {}; }
    const checkout = await env.DB.prepare('SELECT * FROM checkouts WHERE id = ?').bind(checkoutId).first<any>();
    if (!checkout) return err('Checkout not found', 404);
    if (checkout.status !== 'active') return err('Checkout is already closed', 409);

    const markAs = b.mark_items === 'maintenance' ? 'maintenance' : 'available';
    const outstanding = await env.DB.prepare(
      `SELECT gear_item_id FROM checkout_items WHERE checkout_id = ? AND returned_at IS NULL`,
    ).bind(checkoutId).all<any>();

    for (const row of outstanding.results ?? []) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE checkout_items SET returned_at = datetime('now'), condition_on_return = 'ok' WHERE checkout_id = ? AND gear_item_id = ?`)
          .bind(checkoutId, row.gear_item_id),
        env.DB.prepare(`UPDATE gear_items SET status = ?, oos_reason = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(markAs, markAs === 'maintenance' ? `Staff force-return: ${b.notes ?? 'inspection needed'}` : null, row.gear_item_id),
      ]);
    }
    await env.DB.prepare(
      `UPDATE checkouts SET status = 'returned', returned_at = datetime('now'), force_returned_by = ?, return_notes = ? WHERE id = ?`,
    ).bind(actor, b.notes ?? null, checkoutId).run();
    await audit(env, request, actor, 'checkout.force_return', checkoutId, b);
    return json({ success: true });
  },

  /** GET /checkouts/access-codes — staff view of the code issuance audit trail. */
  async accessCodeLog(env: Env): Promise<Response> {
    const rows = await env.DB.prepare(
      `SELECT a.*, m.name AS member_name FROM access_code_log a LEFT JOIN members m ON m.id = a.member_id
       ORDER BY a.issued_at DESC LIMIT 200`,
    ).all();
    return json(rows.results ?? []);
  },

  /** GET /checkouts/door-code/today — staff: today's daily code (for programming the lock). */
  async todayDoorCode(env: Env): Promise<Response> {
    const code = await dailyAccessCode(env.DOOR_CODE_SECRET ?? env.JWT_SECRET ?? 'change-me', todayPacific());
    const mode = (await getSetting(env, 'door_code_mode')) === 'daily' ? 'daily' : 'per_checkout';
    return json({ date: todayPacific(), code, mode });
  },
};
