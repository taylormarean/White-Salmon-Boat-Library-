// "Tell someone when something breaks": alerts for each workspace (Gmail disconnected, out of credit,
// nothing has happened in days, AI failing), emailed to the job seeker's helpers (and admins for
// business-level problems) through a system sender that doesn't depend on anyone's Gmail.
// Also: first-week test mode, when outgoing email goes to her own inbox instead of employers.
import type { Env } from './env';
import { getConfig, getSetting, logActivity, setSetting, U } from './lib/db';
import { adminEmails, getUser } from './accounts';

export type AlertKind = 'gmail' | 'credit' | 'cap' | 'ai' | 'stalled' | 'global_cap' | 'send';

const BUSINESS_KINDS: AlertKind[] = ['ai', 'global_cap'];

export async function raiseAlert(env: Env, kind: AlertKind, message: string): Promise<void> {
  const open = await env.DB.prepare('SELECT 1 FROM alerts WHERE user_id = ? AND kind = ? AND resolved = 0').bind(U(env), kind).first();
  if (open) return;
  await env.DB.prepare('INSERT INTO alerts (user_id, kind, message) VALUES (?, ?, ?)').bind(U(env), kind, message.slice(0, 500)).run();
  await logActivity(env, 'alert', message);
}

export async function resolveAlerts(env: Env, kind: AlertKind): Promise<void> {
  await env.DB.prepare('UPDATE alerts SET resolved = 1 WHERE user_id = ? AND kind = ? AND resolved = 0').bind(U(env), kind).run();
}

export async function openAlerts(env: Env): Promise<{ id: number; kind: string; message: string; created_at: string }[]> {
  return (await env.DB.prepare('SELECT id, kind, message, created_at FROM alerts WHERE user_id = ? AND resolved = 0 ORDER BY id DESC').bind(U(env)).all<{ id: number; kind: string; message: string; created_at: string }>()).results;
}

/** Turn a thrown error from background work into the right alert. */
export async function alertFromError(env: Env, where: string, e: unknown): Promise<void> {
  const msg = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string })?.code;
  if (/Gmail needs to be reconnected|Gmail is not connected|invalid_grant/i.test(msg)) {
    await raiseAlert(env, 'gmail', 'Gmail is disconnected, so the app can’t send applications or notice replies. Sign out and sign in with Google again to fix it.');
  } else if (code === 'no_credit') {
    await raiseAlert(env, 'credit', 'Out of credit — the job search is paused until credit is added on the Billing page.');
  } else if (code === 'cap') {
    await raiseAlert(env, 'cap', 'This month’s spending limit was reached — the job search is paused until the 1st (or until the limit is raised).');
  } else if (code === 'global_cap') {
    await raiseAlert(env, 'global_cap', 'The business-wide monthly AI spending cap was reached; all AI work is paused. Raise it on the Admin page.');
  } else if (/ANTHROPIC_API_KEY|authentication|invalid x-api-key|credit balance|billing/i.test(msg)) {
    await raiseAlert(env, 'ai', `The Claude API is refusing requests (${msg.slice(0, 160)}). Check the API key and the credit balance at console.anthropic.com.`);
  } else {
    await logActivity(env, 'error', `${where}: ${msg}`);
  }
}

// ---------------------------------------------------------------- system email (Resend)

export function systemEmailConfigured(env: Env): boolean {
  return !!env.RESEND_API_KEY && !!env.ALERT_FROM_EMAIL;
}

export async function sendSystemEmail(env: Env, to: string[], subject: string, text: string, html?: string): Promise<boolean> {
  if (!systemEmailConfigured(env) || !to.length) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `Next Chapter <${env.ALERT_FROM_EMAIL}>`, to, subject, text, ...(html ? { html } : {}) }),
  });
  return res.ok;
}

export async function helperEmails(env: Env, ownerId: number): Promise<string[]> {
  return (await env.DB.prepare('SELECT helper_email FROM helpers WHERE owner_id = ?').bind(ownerId).all<{ helper_email: string }>()).results.map((r) => r.helper_email);
}

/** Email anything new to the people who should know. Runs from the hourly cron. */
export async function notifyAlerts(env: Env): Promise<number> {
  const { results } = await env.DB.prepare('SELECT * FROM alerts WHERE user_id = ? AND resolved = 0 AND notified = 0').bind(U(env)).all<{ id: number; kind: AlertKind; message: string }>();
  if (!results.length) return 0;
  const owner = await getUser(env, U(env));
  if (!owner) return 0;
  let sent = 0;
  for (const a of results) {
    const to = BUSINESS_KINDS.includes(a.kind)
      ? adminEmails(env)
      : [...new Set([owner.email, ...(await helperEmails(env, owner.id)), ...(owner.plan === 'free' ? adminEmails(env) : [])])];
    const ok = await sendSystemEmail(env, to, `Next Chapter needs attention: ${a.kind === 'gmail' ? 'Gmail is disconnected' : a.kind === 'credit' ? 'out of credit' : a.kind === 'stalled' ? 'nothing has happened lately' : 'a problem'}`,
      `${a.message}\n\nAccount: ${owner.name} <${owner.email}>\n\nOpen the app: ${env.APP_URL ?? (await getConfig<string>(env, 'app_url')) ?? ''}`);
    if (ok) {
      await env.DB.prepare('UPDATE alerts SET notified = 1 WHERE id = ?').bind(a.id).run();
      sent++;
    }
  }
  return sent;
}

// ---------------------------------------------------------------- first-week test mode

interface TestMode { until: string | null } // ISO date; null = off

/** Until when outgoing email goes to her own inbox instead of employers (null = test mode is off). */
export async function testModeUntil(env: Env): Promise<string | null> {
  const t = await getSetting<TestMode>(env, 'test_mode');
  let until = t ? t.until : null;
  if (!t) {
    // New accounts start in test mode for their first week.
    const u = await getUser(env, U(env));
    until = u ? new Date(new Date(u.created_at.replace(' ', 'T') + 'Z').getTime() + 7 * 86_400_000).toISOString() : null;
  }
  return until && new Date(until).getTime() > Date.now() ? until : null;
}

export async function setTestMode(env: Env, on: boolean, days = 7): Promise<string | null> {
  const until = on ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
  await setSetting(env, 'test_mode', { until } satisfies TestMode);
  return until;
}
