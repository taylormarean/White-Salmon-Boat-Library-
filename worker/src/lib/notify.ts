// Central notification dispatch — the same funnel contract as the Gorge rides
// platform's notify(): kill switch -> missing contact -> transport, and every
// outcome lands in notification_log. Email-only for v1 (Resend).

import type { Env } from '../index';
import { getSetting } from './util';

export interface NotifyArgs {
  category: string;             // due_soon | overdue | welcome | orientation | staff_digest | manual
  recipient: string;            // email address
  member_id?: string | null;
  checkout_id?: string | null;
  subject: string;
  body: string;                 // plain text
  initiated_by?: string;        // 'system' (cron) or a staff username
}

async function log(env: Env, args: NotifyArgs, status: string, error?: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO notification_log (category, channel, recipient, member_id, checkout_id, subject, status, error, initiated_by)
     VALUES (?, 'email', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(args.category, args.recipient, args.member_id ?? null, args.checkout_id ?? null, args.subject, status, error ?? null, args.initiated_by ?? 'system')
    .run()
    .catch(() => {});
}

/** Send an email through the funnel. Never throws — failures are logged. */
export async function notify(env: Env, args: NotifyArgs): Promise<{ status: string }> {
  // 1. Kill switch — suppresses every send (fleet-app dispatch order rule #1)
  const paused = await getSetting(env, 'notifications_paused');
  if (paused === '1') {
    await log(env, args, 'suppressed_kill');
    return { status: 'suppressed_kill' };
  }

  // 2. Missing contact
  if (!args.recipient || !args.recipient.includes('@')) {
    await log(env, args, 'suppressed_no_contact');
    return { status: 'suppressed_no_contact' };
  }

  // 3. Transport (Resend). No API key configured = logged failure, not a throw.
  if (!env.RESEND_API_KEY) {
    await log(env, args, 'failed', 'RESEND_API_KEY not configured');
    return { status: 'failed' };
  }

  const appName = (await getSetting(env, 'app_name')) ?? 'White Salmon Boat Library';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${appName} <${env.FROM_EMAIL ?? 'noreply@whitesalmonboatlibrary.org'}>`,
        to: [args.recipient],
        subject: args.subject,
        text: args.body,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      await log(env, args, 'failed', `HTTP ${res.status} ${detail.slice(0, 200)}`);
      return { status: 'failed' };
    }
    await log(env, args, 'sent');
    return { status: 'sent' };
  } catch (e) {
    await log(env, args, 'failed', String(e).slice(0, 200));
    return { status: 'failed' };
  }
}
