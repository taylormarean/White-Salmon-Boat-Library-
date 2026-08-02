// Stripe donations — checkout session creation + signed webhook.
// "Prepared" integration: everything works the moment STRIPE_SECRET_KEY and
// STRIPE_WEBHOOK_SECRET are set via wrangler secrets; until then the public
// endpoint degrades gracefully with a clear message.

import type { Env } from '../index';
import { json, err, newId, getSetting } from '../lib/util';

const MIN_CENTS = 100;        // $1
const MAX_CENTS = 1_000_000;  // $10k — anything bigger deserves a phone call

/** POST /public/donate — create a Stripe Checkout session, return its URL. */
export async function handleDonate(request: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) {
    return err('Online donations are not live yet — bring cash to orientation or email us!', 503);
  }

  let b: { amount_cents?: number; email?: string };
  try { b = await request.json(); } catch { return err('Invalid JSON'); }

  const cents = Math.floor(Number(b.amount_cents));
  if (!Number.isFinite(cents) || cents < MIN_CENTS || cents > MAX_CENTS) {
    return err(`Donation must be between $${MIN_CENTS / 100} and $${MAX_CENTS / 100}`);
  }

  // Basic per-IP rate limit — checkout sessions aren't free to spam.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rateKey = `donate:${ip}`;
  const count = parseInt((await env.KV.get(rateKey)) ?? '0');
  if (count >= 10) return err('Too many donation attempts — try again in an hour.', 429);
  await env.KV.put(rateKey, String(count + 1), { expirationTtl: 3600 });

  const donationId = newId('don');
  const appName = (await getSetting(env, 'app_name')) ?? 'White Salmon Boat Library';
  const siteUrl = env.SITE_URL ?? env.FRONTEND_URL ?? 'https://whitesalmonboatlibrary.org';

  const params = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(cents),
    'line_items[0][price_data][product_data][name]': `${appName} donation`,
    'line_items[0][price_data][product_data][description]': 'Keeps donated boats maintained and free to borrow.',
    success_url: `${siteUrl}/?donated=1`,
    cancel_url: `${siteUrl}/#support`,
    'metadata[donation_id]': donationId,
    submit_type: 'donate',
  });
  if (b.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) params.set('customer_email', b.email);

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Stripe session create failed:', res.status, detail.slice(0, 300));
    return err('Could not start checkout — try again shortly.', 502);
  }

  const session = (await res.json()) as { id: string; url: string };
  await env.DB.prepare(
    `INSERT INTO donations (id, stripe_session_id, amount_cents, currency, email, status) VALUES (?, ?, ?, 'usd', ?, 'pending')`,
  ).bind(donationId, session.id, cents, b.email ?? null).run();

  return json({ url: session.url });
}

/**
 * POST /webhook/stripe — Stripe event webhook.
 * Verifies the Stripe-Signature header (HMAC-SHA256 of "timestamp.payload"
 * with the webhook signing secret) before trusting anything in the body.
 */
export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) return err('Webhook not configured', 503);

  const payload = await request.text();
  const sigHeader = request.headers.get('Stripe-Signature') ?? '';
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=') as [string, string]));
  const timestamp = parts['t'];
  const signature = parts['v1'];
  if (!timestamp || !signature) return err('Missing signature', 400);

  // Reject stale events (replay protection, 5 min tolerance like stripe-node)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return err('Timestamp outside tolerance', 400);

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  // Constant-time comparison
  if (expected.length !== signature.length) return err('Invalid signature', 400);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (diff !== 0) return err('Invalid signature', 400);

  let event: any;
  try { event = JSON.parse(payload); } catch { return err('Invalid payload', 400); }

  if (event.type === 'checkout.session.completed') {
    const session = event.data?.object ?? {};
    const donationId = session.metadata?.donation_id;
    if (donationId) {
      await env.DB.prepare(
        `UPDATE donations SET status = 'completed', email = COALESCE(email, ?), completed_at = datetime('now') WHERE id = ? AND status = 'pending'`,
      ).bind(session.customer_details?.email ?? null, donationId).run();
    }
  } else if (event.type === 'checkout.session.expired') {
    const donationId = event.data?.object?.metadata?.donation_id;
    if (donationId) {
      await env.DB.prepare(`UPDATE donations SET status = 'expired' WHERE id = ? AND status = 'pending'`).bind(donationId).run();
    }
  }

  return json({ received: true });
}

/** GET /donations — staff view of donation records. */
export async function handleDonationsList(env: Env): Promise<Response> {
  const rows = await env.DB.prepare('SELECT * FROM donations ORDER BY created_at DESC LIMIT 200').all();
  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS total_cents FROM donations WHERE status = 'completed'`,
  ).first();
  return json({ donations: rows.results ?? [], totals });
}
