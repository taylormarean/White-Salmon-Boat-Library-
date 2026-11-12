// Account-level routes: billing (credit, caps, usage), referrals (link, earnings, cash payouts),
// helpers (family who can act in a workspace), test mode, and the browser-helper key.
import type { Env } from './env';
import { body, error, json, type Route } from './lib/http';
import { getConfig, U } from './lib/db';
import { newApiKey, num, type UserRow } from './accounts';
import { monthSpend, usd } from './billing';
import { connectDashboardLink, connectOnboardingLink, CREDIT_PACKS_USD, creditCheckout, earningsSummary, refreshConnectStatus, stripeConfigured } from './stripe';
import { sendSystemEmail, setTestMode, systemEmailConfigured, testModeUntil } from './alerts';

export function businessRoutes(env: Env, user: UserRow, owner: UserRow, origin: string): Route[] {
  const isOwner = user.id === owner.id;
  const appUrl = async () => (env.APP_URL ?? (await getConfig<string>(env, 'app_url')) ?? origin).replace(/\/$/, '');

  return [
    // ---- billing for this workspace
    ['GET', '/api/billing', async () => {
      const month = await monthSpend(env, owner.id);
      const usage = (await env.DB.prepare(
        `SELECT purpose, COUNT(*) AS calls, SUM(charge_micro) AS charge, SUM(cost_micro) AS cost FROM usage_events
         WHERE user_id = ? AND created_at >= datetime('now','-30 days') GROUP BY purpose ORDER BY charge DESC`,
      ).bind(U(env)).all()).results;
      const purchases = (await env.DB.prepare('SELECT amount_micro, status, note, created_at FROM credit_purchases WHERE user_id = ? AND status != ? ORDER BY id DESC LIMIT 20').bind(U(env), 'pending').all()).results;
      return json({
        plan: owner.plan,
        balance_micro: owner.balance_micro,
        month,
        monthly_cap_micro: owner.monthly_cap_micro,
        multiplier: num(env.PRICE_MULTIPLIER, 2),
        packs: CREDIT_PACKS_USD,
        payments: stripeConfigured(env),
        usage,
        purchases,
      });
    }],
    ['POST', '/api/billing/checkout', async (req) => {
      const b = await body<{ amount?: number }>(req);
      return json({ url: await creditCheckout(env, owner, Number(b.amount), origin) });
    }],
    ['PUT', '/api/billing/cap', async (req) => {
      if (!isOwner && !user.is_admin) return error('Only the account owner can change the spending limit.', 403);
      // On a comped account the business pays, so only an admin may change its limit.
      if (owner.plan === 'free' && !user.is_admin) return error('Your account is on the house — its monthly limit is set by Next Chapter.', 403);
      const b = await body<{ cap_usd?: number | null }>(req);
      const cap = b.cap_usd === null || b.cap_usd === undefined || Number(b.cap_usd) <= 0 ? null : Math.round(Number(b.cap_usd) * 1_000_000);
      await env.DB.prepare('UPDATE users SET monthly_cap_micro = ? WHERE id = ?').bind(cap, owner.id).run();
      return json({ ok: true, monthly_cap: cap === null ? null : usd(cap) });
    }],

    // ---- referrals: your link, earnings, cash payouts (always the signed-in person's own)
    ['GET', '/api/referrals', async () => {
      const summary = await earningsSummary(env, user.id);
      const people = (await env.DB.prepare(
        `SELECT u.name, u.created_at, u.status,
           COALESCE((SELECT SUM(amount_micro) FROM referral_earnings e WHERE e.referrer_id = ? AND e.referred_id = u.id), 0) AS earned
         FROM users u WHERE u.referred_by = ? ORDER BY u.created_at DESC LIMIT 200`,
      ).bind(user.id, user.id).all<{ name: string; created_at: string; status: string; earned: number }>()).results
        .map((p) => ({ name: p.name.split(' ')[0] || 'Someone', joined: p.created_at, status: p.status, earned_micro: p.earned }));
      const payouts = (await env.DB.prepare('SELECT amount_micro, status, error, created_at FROM payouts WHERE user_id = ? ORDER BY id DESC LIMIT 24').bind(user.id).all()).results;
      return json({
        code: user.referral_code,
        link: `${await appUrl()}/?ref=${user.referral_code}`,
        share: num(env.REFERRAL_SHARE, 0.5),
        multiplier: num(env.PRICE_MULTIPLIER, 2),
        ...summary,
        people,
        payouts,
        payouts_enabled: stripeConfigured(env),
        connect: { started: !!user.connect_account_id, ready: !!user.connect_ready },
        min_payout_usd: num(env.PAYOUT_MIN_USD, 25),
        hold_days: num(env.PAYOUT_HOLD_DAYS, 30),
      });
    }],
    ['POST', '/api/referrals/connect', async () => json({ url: await connectOnboardingLink(env, user, await appUrl()) })],
    ['POST', '/api/referrals/connect/refresh', async () => json({ ready: await refreshConnectStatus(env, user) })],
    ['GET', '/api/referrals/dashboard', async () => json({ url: await connectDashboardLink(env, user) })],

    // ---- helpers: people who can act in this workspace
    ['GET', '/api/helpers', async () => json((await env.DB.prepare('SELECT helper_email, created_at FROM helpers WHERE owner_id = ? ORDER BY created_at').bind(owner.id).all()).results)],
    ['POST', '/api/helpers', async (req) => {
      if (!isOwner) return error('Only the account owner can invite helpers.', 403);
      const b = await body<{ email?: string }>(req);
      const email = (b.email ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email === owner.email) return error('Enter a valid email address (not your own).');
      await env.DB.prepare('INSERT OR IGNORE INTO helpers (owner_id, helper_email) VALUES (?, ?)').bind(owner.id, email).run();
      const link = `${await appUrl()}/`;
      const emailed = await sendSystemEmail(env, [email], `${owner.name} invited you to help with their job search`,
        `${owner.name} added you as a helper on Next Chapter, the job search app they use.\n\nSign in with your Google account (${email}) at ${link} using "Sign in as a helper" — you'll be able to see their matches, drafts, and applications and help out. Your own email is never touched.`);
      return json({ ok: true, emailed, note: emailed ? 'Invitation sent.' : systemEmailConfigured(env) ? 'Saved, but the invitation email failed — send them the link yourself.' : 'Saved. Send them the app link and ask them to sign in as a helper.' });
    }],
    ['DELETE', '/api/helpers/:email', async (_r, p) => {
      if (!isOwner) return error('Only the account owner can remove helpers.', 403);
      await env.DB.prepare('DELETE FROM helpers WHERE owner_id = ? AND helper_email = ?').bind(owner.id, p.email.toLowerCase()).run();
      return json({ ok: true });
    }],

    // ---- first-week test mode
    ['GET', '/api/test-mode', async () => json({ until: await testModeUntil(env) })],
    ['PUT', '/api/test-mode', async (req) => {
      const b = await body<{ on?: boolean; days?: number }>(req);
      return json({ until: await setTestMode(env, !!b.on, Math.min(30, Math.max(1, Number(b.days) || 7))) });
    }],

    // ---- browser helper key (shown once)
    ['POST', '/api/ext-key', async () => {
      if (!isOwner) return error('Only the account owner can create a browser-helper key.', 403);
      return json({ key: await newApiKey(env, owner.id) });
    }],
  ];
}
