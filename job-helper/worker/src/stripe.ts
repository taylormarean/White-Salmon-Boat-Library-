// Stripe: prepaid credit (Checkout), refunds, and referral payouts (Connect Express + transfers).
// Raw REST calls — no SDK needed in a Worker.
import type { Env } from './env';
import { logActivity } from './lib/db';
import { getUser, num, type UserRow } from './accounts';

export const CREDIT_PACKS_USD = [10, 25, 50, 100];

export function stripeConfigured(env: Env): boolean {
  return !!env.STRIPE_SECRET_KEY;
}

function form(params: Record<string, string | number | undefined>, prefix = ''): string[] {
  return Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(prefix ? `${prefix}[${k}]` : k)}=${encodeURIComponent(String(v))}`);
}

export async function stripe<T = Record<string, unknown>>(env: Env, method: 'GET' | 'POST', path: string, body?: string[], idempotencyKey?: string): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw new Error('Payments aren’t set up yet (STRIPE_SECRET_KEY).');
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body?.join('&'),
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe: ${data.error?.message ?? res.status}`);
  return data;
}

/** A Checkout page for buying credit. The webhook adds the credit once Stripe confirms payment. */
export async function creditCheckout(env: Env, user: UserRow, amountUsd: number, origin: string): Promise<string> {
  if (!CREDIT_PACKS_USD.includes(amountUsd)) throw new Error('Pick one of the credit amounts.');
  const session = await stripe<{ id: string; url: string }>(env, 'POST', '/checkout/sessions', [
    ...form({ mode: 'payment', success_url: `${origin}/#/billing?paid=1`, cancel_url: `${origin}/#/billing`, client_reference_id: String(user.id) }),
    ...(user.stripe_customer_id ? form({ customer: user.stripe_customer_id }) : form({ customer_email: user.email, customer_creation: 'always' })),
    ...form({ 'line_items[0][quantity]': 1, 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': amountUsd * 100,
      'line_items[0][price_data][product_data][name]': `Next Chapter credit — $${amountUsd}` }),
    ...form({ user_id: user.id, purpose: 'credit' }, 'metadata'),
    ...form({ user_id: user.id }, 'payment_intent_data[metadata]'),
  ]);
  await env.DB.prepare("INSERT INTO credit_purchases (user_id, stripe_session_id, amount_micro, status) VALUES (?, ?, ?, 'pending')").bind(user.id, session.id, amountUsd * 1_000_000).run();
  return session.url;
}

// ---------------------------------------------------------------- webhook

async function verify(env: Env, payload: string, header: string): Promise<boolean> {
  if (!env.STRIPE_WEBHOOK_SECRET) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const t = parts.t;
  const sig = parts.v1;
  if (!t || !sig || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  const payload = await request.text();
  if (!(await verify(env, payload, request.headers.get('Stripe-Signature') ?? ''))) return new Response('bad signature', { status: 400 });
  const event = JSON.parse(payload) as { id: string; type: string; data: { object: any } };
  const o = event.data.object;

  if (event.type === 'checkout.session.completed' && o.metadata?.purpose === 'credit' && o.payment_status === 'paid') {
    // Idempotent: only a pending purchase flips to paid (Stripe may deliver an event more than once).
    const row = await env.DB.prepare("UPDATE credit_purchases SET status = 'paid', stripe_payment_intent = ? WHERE stripe_session_id = ? AND status = 'pending' RETURNING user_id, amount_micro")
      .bind(o.payment_intent ?? null, o.id).first<{ user_id: number; amount_micro: number }>();
    if (row) {
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET balance_micro = balance_micro + ?, stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?').bind(row.amount_micro, o.customer ?? null, row.user_id),
      ]);
      await logActivity({ ...env, uid: row.user_id }, 'billing', `Added $${(row.amount_micro / 1e6).toFixed(2)} of credit`);
    }
  }

  if (event.type === 'charge.refunded' && o.payment_intent) {
    const p = await env.DB.prepare("SELECT id, user_id, amount_micro FROM credit_purchases WHERE stripe_payment_intent = ? AND status = 'paid'").bind(o.payment_intent).first<{ id: number; user_id: number; amount_micro: number }>();
    if (p) {
      const refunded = Math.min(p.amount_micro, Math.round((o.amount_refunded ?? 0) * 10_000));
      await env.DB.batch([
        env.DB.prepare("UPDATE credit_purchases SET status = 'refunded' WHERE id = ?").bind(p.id),
        env.DB.prepare('UPDATE users SET balance_micro = balance_micro - ? WHERE id = ?').bind(refunded, p.user_id),
      ]);
      await logActivity({ ...env, uid: p.user_id }, 'billing', `Refund of $${(refunded / 1e6).toFixed(2)} — credit reduced`);
    }
  }

  if (event.type === 'account.updated' && o.id) {
    await env.DB.prepare('UPDATE users SET connect_ready = ? WHERE connect_account_id = ?').bind(o.payouts_enabled && o.details_submitted ? 1 : 0, o.id).run();
  }

  if (event.type === 'transfer.reversed' && o.id) {
    await env.DB.prepare("UPDATE payouts SET status = 'failed', error = 'Transfer reversed' WHERE stripe_transfer_id = ?").bind(o.id).run();
    await env.DB.prepare('UPDATE referral_earnings SET payout_id = NULL WHERE payout_id IN (SELECT id FROM payouts WHERE stripe_transfer_id = ?)').bind(o.id).run();
  }
  return new Response('ok');
}

// ---------------------------------------------------------------- referral payouts (Connect)

/** Start (or resume) Stripe's identity/bank onboarding so referral earnings can be paid in cash. */
export async function connectOnboardingLink(env: Env, user: UserRow, origin: string): Promise<string> {
  let acct = user.connect_account_id;
  if (!acct) {
    const a = await stripe<{ id: string }>(env, 'POST', '/accounts', [
      ...form({ type: 'express', email: user.email, country: 'US', business_type: 'individual' }),
      ...form({ 'capabilities[transfers][requested]': 'true' }),
      ...form({ user_id: user.id }, 'metadata'),
    ], `acct-${user.id}`);
    acct = a.id;
    await env.DB.prepare('UPDATE users SET connect_account_id = ? WHERE id = ?').bind(acct, user.id).run();
  }
  const link = await stripe<{ url: string }>(env, 'POST', '/account_links', form({
    account: acct, type: 'account_onboarding', refresh_url: `${origin}/#/referrals?connect=retry`, return_url: `${origin}/#/referrals?connect=done`,
  }));
  return link.url;
}

export async function connectDashboardLink(env: Env, user: UserRow): Promise<string> {
  if (!user.connect_account_id) throw new Error('Set up payouts first.');
  return (await stripe<{ url: string }>(env, 'POST', `/accounts/${user.connect_account_id}/login_links`)).url;
}

export async function refreshConnectStatus(env: Env, user: UserRow): Promise<boolean> {
  if (!user.connect_account_id) return false;
  const a = await stripe<{ payouts_enabled: boolean; details_submitted: boolean }>(env, 'GET', `/accounts/${user.connect_account_id}`);
  const ready = a.payouts_enabled && a.details_submitted;
  await env.DB.prepare('UPDATE users SET connect_ready = ? WHERE id = ?').bind(ready ? 1 : 0, user.id).run();
  return ready;
}

export interface EarningsSummary { pending: number; available: number; paid: number; referrals: number }

/** Earnings older than the hold period (covers refunds/chargebacks) are available for payout. */
export async function earningsSummary(env: Env, userId: number): Promise<EarningsSummary> {
  const hold = Math.round(num(env.PAYOUT_HOLD_DAYS, 30));
  const r = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN payout_id IS NULL AND created_at > datetime('now', ?) THEN amount_micro END), 0) AS pending,
       COALESCE(SUM(CASE WHEN payout_id IS NULL AND created_at <= datetime('now', ?) THEN amount_micro END), 0) AS available,
       COALESCE(SUM(CASE WHEN payout_id IS NOT NULL THEN amount_micro END), 0) AS paid
     FROM referral_earnings WHERE referrer_id = ?`,
  ).bind(`-${hold} days`, `-${hold} days`, userId).first<{ pending: number; available: number; paid: number }>();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE referred_by = ? AND status = 'active'").bind(userId).first<{ n: number }>();
  return { pending: r?.pending ?? 0, available: r?.available ?? 0, paid: r?.paid ?? 0, referrals: n?.n ?? 0 };
}

/** Monthly: pay every referrer whose available earnings clear the minimum and whose payout account is ready. */
export async function runPayouts(env: Env): Promise<{ paid: number; failed: number }> {
  if (!stripeConfigured(env)) return { paid: 0, failed: 0 };
  const hold = Math.round(num(env.PAYOUT_HOLD_DAYS, 30));
  const min = Math.round(num(env.PAYOUT_MIN_USD, 25) * 1_000_000);
  const { results } = await env.DB.prepare(
    `SELECT e.referrer_id AS uid, SUM(e.amount_micro) AS amount FROM referral_earnings e JOIN users u ON u.id = e.referrer_id
     WHERE e.payout_id IS NULL AND e.created_at <= datetime('now', ?) AND u.connect_ready = 1 AND u.status = 'active'
     GROUP BY e.referrer_id HAVING SUM(e.amount_micro) >= ?`,
  ).bind(`-${hold} days`, min).all<{ uid: number; amount: number }>();
  let paid = 0;
  let failed = 0;
  for (const r of results) {
    const user = await getUser(env, r.uid);
    if (!user?.connect_account_id) continue;
    const cents = Math.floor(r.amount / 10_000);
    const payout = await env.DB.prepare("INSERT INTO payouts (user_id, amount_micro, status) VALUES (?, ?, 'pending') RETURNING id").bind(r.uid, cents * 10_000).first<{ id: number }>();
    // Claim exactly the earnings this payout covers before money moves.
    await env.DB.prepare(`UPDATE referral_earnings SET payout_id = ? WHERE referrer_id = ? AND payout_id IS NULL AND created_at <= datetime('now', ?)`).bind(payout!.id, r.uid, `-${hold} days`).run();
    try {
      const t = await stripe<{ id: string }>(env, 'POST', '/transfers', [
        ...form({ amount: cents, currency: 'usd', destination: user.connect_account_id, description: 'Next Chapter referral earnings' }),
        ...form({ payout_id: payout!.id, user_id: r.uid }, 'metadata'),
      ], `payout-${payout!.id}`);
      await env.DB.prepare("UPDATE payouts SET status = 'paid', stripe_transfer_id = ? WHERE id = ?").bind(t.id, payout!.id).run();
      await logActivity({ ...env, uid: r.uid }, 'payout', `Paid $${(cents / 100).toFixed(2)} in referral earnings`);
      paid++;
    } catch (e) {
      // Release the earnings so they're retried next month.
      await env.DB.prepare("UPDATE payouts SET status = 'failed', error = ? WHERE id = ?").bind(String(e instanceof Error ? e.message : e).slice(0, 300), payout!.id).run();
      await env.DB.prepare('UPDATE referral_earnings SET payout_id = NULL WHERE payout_id = ?').bind(payout!.id).run();
      failed++;
    }
  }
  return { paid, failed };
}
