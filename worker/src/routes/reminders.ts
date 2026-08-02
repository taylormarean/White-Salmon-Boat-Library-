// Overdue-gear reminder cron — the tour-reminder engine, adapted.
// Three waves per checkout: due_soon (≤24h before due), overdue_1 (past due),
// overdue_7 (7+ days past due, also alerts staff). Dedupe via reminder_log:
// any non-failed row counts as handled (fleet-app invariant #3).

import type { Env } from '../index';
import { notify } from '../lib/notify';
import { getSetting } from '../lib/util';

interface DueRow {
  id: string; member_id: string; due_at: string;
  member_name: string; member_email: string;
  gear_list: string;
}

async function alreadyHandled(env: Env, checkoutId: string, type: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM reminder_log WHERE checkout_id = ? AND reminder_type = ? AND channel = 'email' AND status != 'failed'`,
  ).bind(checkoutId, type).first();
  return !!row;
}

async function markHandled(env: Env, checkoutId: string, type: string, status: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO reminder_log (checkout_id, reminder_type, channel, status) VALUES (?, ?, 'email', ?)
     ON CONFLICT (checkout_id, reminder_type, channel) DO UPDATE SET status = excluded.status, sent_at = datetime('now')`,
  ).bind(checkoutId, type, status).run();
}

async function activeCheckouts(env: Env, where: string): Promise<DueRow[]> {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.member_id, c.due_at, m.name AS member_name, m.email AS member_email,
      (SELECT group_concat(g.gear_code || ' ' || COALESCE(g.brand,'') || ' ' || COALESCE(g.model, g.name), ', ')
       FROM checkout_items ci JOIN gear_items g ON g.id = ci.gear_item_id
       WHERE ci.checkout_id = c.id AND ci.returned_at IS NULL) AS gear_list
     FROM checkouts c JOIN members m ON m.id = c.member_id
     WHERE c.status = 'active' AND ${where}`,
  ).all<any>();
  return (rows.results ?? []) as DueRow[];
}

export async function sendGearReminders(env: Env): Promise<void> {
  const appName = (await getSetting(env, 'app_name')) ?? 'White Salmon Boat Library';

  // Wave 1 — due within 24h
  for (const c of await activeCheckouts(env, `c.due_at > datetime('now') AND c.due_at <= datetime('now', '+1 day')`)) {
    if (await alreadyHandled(env, c.id, 'due_soon')) continue;
    const res = await notify(env, {
      category: 'due_soon', recipient: c.member_email, member_id: c.member_id, checkout_id: c.id,
      subject: `Gear due back tomorrow — ${appName}`,
      body: `Hi ${c.member_name},\n\nFriendly reminder: your library gear is due back by ${new Date(c.due_at).toDateString()}.\n\nOut with you: ${c.gear_list}\n\nBring it back to the shed, then mark it returned in the app (and note any dings — honest damage reports keep the library running). Need more time? Reply to this email and a librarian can extend your loan.`,
    });
    await markHandled(env, c.id, 'due_soon', res.status === 'failed' ? 'failed' : 'sent');
  }

  // Wave 2 — past due
  for (const c of await activeCheckouts(env, `c.due_at < datetime('now')`)) {
    if (await alreadyHandled(env, c.id, 'overdue_1')) continue;
    const res = await notify(env, {
      category: 'overdue', recipient: c.member_email, member_id: c.member_id, checkout_id: c.id,
      subject: `Your library gear is overdue — ${appName}`,
      body: `Hi ${c.member_name},\n\nYour gear was due back ${new Date(c.due_at).toDateString()} and hasn't been marked returned:\n\n${c.gear_list}\n\nOther members are waiting on this gear — please return it to the shed and mark it returned in the app as soon as you can. If it's already back, just mark it returned. If something came up, reply and we'll work it out.\n\nNote: you won't be able to check out more gear until this is resolved.`,
    });
    await markHandled(env, c.id, 'overdue_1', res.status === 'failed' ? 'failed' : 'sent');
  }

  // Wave 3 — 7+ days past due: member escalation + staff digest
  const week = await activeCheckouts(env, `c.due_at < datetime('now', '-7 days')`);
  for (const c of week) {
    if (await alreadyHandled(env, c.id, 'overdue_7')) continue;
    const res = await notify(env, {
      category: 'overdue', recipient: c.member_email, member_id: c.member_id, checkout_id: c.id,
      subject: `Action required: gear a week overdue — ${appName}`,
      body: `Hi ${c.member_name},\n\nYour library gear is now more than a week overdue:\n\n${c.gear_list}\n\nA librarian has been notified. Please return the gear immediately or get in touch — unreturned gear can lead to suspension of library privileges (it's donated equipment the whole community shares).`,
    });
    await markHandled(env, c.id, 'overdue_7', res.status === 'failed' ? 'failed' : 'sent');

    const staffEmail = (await getSetting(env, 'staff_digest_email')) ?? '';
    if (staffEmail) {
      await notify(env, {
        category: 'staff_digest', recipient: staffEmail, member_id: c.member_id, checkout_id: c.id,
        subject: `WSBL: ${c.member_name} is 7+ days overdue`,
        body: `${c.member_name} (${c.member_email}) has gear 7+ days overdue (due ${new Date(c.due_at).toDateString()}):\n\n${c.gear_list}\n\nCheckout ${c.id}. Consider a call, an extension, or a force-return in the dashboard.`,
        initiated_by: 'system',
      });
    }
  }
}
