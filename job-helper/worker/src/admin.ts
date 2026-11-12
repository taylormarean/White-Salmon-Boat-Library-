// The business owner's view: customers, revenue, AI cost, profit, referral payouts, and the
// business-wide AI spending cap. Plus the periodic jobs: monthly payouts and weekly summaries.
import type { Env } from './env';
import { body, error, json, type Route } from './lib/http';
import { getConfig, logActivity, setConfig } from './lib/db';
import { getUser, num, type UserRow } from './accounts';
import { globalMonthCost, usd } from './billing';
import { runPayouts } from './stripe';
import { sendWeeklySummaries } from './insights';

export function adminRoutes(env: Env, user: UserRow): Route[] {
  const guard = () => (user.is_admin ? null : error('Admins only', 403));
  const sum = async (sql: string, ...args: unknown[]) => ((await env.DB.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0);

  return [
    ['GET', '/api/admin/overview', async () => {
      const g = guard(); if (g) return g;
      const periods = { month: "datetime('now','start of month')", all: "'1970-01-01'" };
      const out: Record<string, Record<string, number>> = {};
      for (const [k, since] of Object.entries(periods)) {
        const cost = await sum(`SELECT COALESCE(SUM(cost_micro),0) AS n FROM usage_events WHERE created_at >= ${since}`);
        const comped = await sum(`SELECT COALESCE(SUM(e.cost_micro),0) AS n FROM usage_events e JOIN users u ON u.id = e.user_id WHERE u.plan = 'free' AND e.created_at >= ${since}`);
        const charged = await sum(`SELECT COALESCE(SUM(charge_micro),0) AS n FROM usage_events WHERE created_at >= ${since}`);
        const referral = await sum(`SELECT COALESCE(SUM(amount_micro),0) AS n FROM referral_earnings WHERE created_at >= ${since}`);
        const sales = await sum(`SELECT COALESCE(SUM(amount_micro),0) AS n FROM credit_purchases WHERE status = 'paid' AND created_at >= ${since}`);
        const paidOut = await sum(`SELECT COALESCE(SUM(amount_micro),0) AS n FROM payouts WHERE status = 'paid' AND created_at >= ${since}`);
        out[k] = { credit_sold: sales, usage_charged: charged, ai_cost: cost, ai_cost_comped: comped, referral_earned: referral, referral_paid: paidOut, profit: charged - cost - referral };
      }
      const users = await sum("SELECT COUNT(*) AS n FROM users WHERE status = 'active'");
      const waitlist = await sum("SELECT COUNT(*) AS n FROM users WHERE status = 'waitlist'");
      // Prepaid credit customers still hold (a liability): paying accounts only.
      const outstanding = await sum("SELECT COALESCE(SUM(balance_micro),0) AS n FROM users WHERE balance_micro > 0 AND plan = 'paid' AND status != 'suspended'");
      const owed = await sum('SELECT COALESCE(SUM(amount_micro),0) AS n FROM referral_earnings WHERE payout_id IS NULL');
      return json({
        ...out,
        users, waitlist, max_users: num(env.MAX_USERS, 100),
        prepaid_outstanding: outstanding, referral_owed: owed,
        global_cap_usd: await getConfig<number>(env, 'global_cap_usd'),
        global_month_cost: await globalMonthCost(env),
        multiplier: num(env.PRICE_MULTIPLIER, 2), referral_share: num(env.REFERRAL_SHARE, 0.5),
      });
    }],
    ['GET', '/api/admin/users', async () => {
      const g = guard(); if (g) return g;
      const { results } = await env.DB.prepare(
        `SELECT u.id, u.email, u.name, u.plan, u.status, u.is_admin, u.balance_micro, u.monthly_cap_micro, u.created_at, u.last_login_at, u.connect_ready,
           r.email AS referred_by_email,
           (SELECT COUNT(*) FROM users x WHERE x.referred_by = u.id) AS referrals,
           COALESCE((SELECT SUM(cost_micro) FROM usage_events e WHERE e.user_id = u.id AND e.created_at >= datetime('now','start of month')), 0) AS month_cost,
           COALESCE((SELECT SUM(charge_micro) FROM usage_events e WHERE e.user_id = u.id AND e.created_at >= datetime('now','start of month')), 0) AS month_charge,
           COALESCE((SELECT SUM(amount_micro) FROM referral_earnings e WHERE e.referrer_id = u.id AND e.payout_id IS NULL), 0) AS earnings_unpaid
         FROM users u LEFT JOIN users r ON r.id = u.referred_by ORDER BY u.created_at DESC LIMIT 500`,
      ).all();
      return json(results);
    }],
    ['PATCH', '/api/admin/users/:id', async (req, p) => {
      const g = guard(); if (g) return g;
      const target = await getUser(env, Number(p.id));
      if (!target) return error('Not found', 404);
      const b = await body<{ plan?: string; status?: string; credit_usd?: number; monthly_cap_usd?: number | null; note?: string }>(req);
      if (b.plan && ['paid', 'free'].includes(b.plan)) await env.DB.prepare('UPDATE users SET plan = ? WHERE id = ?').bind(b.plan, target.id).run();
      if (b.status && ['active', 'waitlist', 'suspended'].includes(b.status)) await env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(b.status, target.id).run();
      if (b.monthly_cap_usd !== undefined) {
        const cap = b.monthly_cap_usd === null || Number(b.monthly_cap_usd) <= 0 ? null : Math.round(Number(b.monthly_cap_usd) * 1e6);
        await env.DB.prepare('UPDATE users SET monthly_cap_micro = ? WHERE id = ?').bind(cap, target.id).run();
      }
      if (b.credit_usd && Number.isFinite(Number(b.credit_usd))) {
        const amt = Math.round(Number(b.credit_usd) * 1e6);
        await env.DB.batch([
          env.DB.prepare('UPDATE users SET balance_micro = balance_micro + ? WHERE id = ?').bind(amt, target.id),
          env.DB.prepare("INSERT INTO credit_purchases (user_id, amount_micro, status, note) VALUES (?, ?, 'adjustment', ?)").bind(target.id, amt, (b.note ?? `Adjusted by ${user.email}`).slice(0, 200)),
        ]);
      }
      await logActivity({ ...env, uid: target.id }, 'admin', `${user.email} changed: ${JSON.stringify(b).slice(0, 200)}`);
      return json(await getUser(env, target.id));
    }],
    ['PUT', '/api/admin/global-cap', async (req) => {
      const g = guard(); if (g) return g;
      const b = await body<{ usd?: number | null }>(req);
      const v = b.usd === null || b.usd === undefined || Number(b.usd) <= 0 ? null : Number(b.usd);
      await setConfig(env, 'global_cap_usd', v);
      return json({ global_cap_usd: v, month_cost: usd(await globalMonthCost(env)) });
    }],
    ['POST', '/api/admin/payouts/run', async () => {
      const g = guard(); if (g) return g;
      return json(await runPayouts(env));
    }],
  ];
}

/** Daily-ish housekeeping from the cron: monthly referral payouts, Monday weekly summaries. */
export async function runMonthly(env: Env): Promise<void> {
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  if (now.getUTCDate() === 1 && (await getConfig<string>(env, 'last_payout_month')) !== month) {
    await setConfig(env, 'last_payout_month', month);
    const r = await runPayouts(env);
    await logActivity(env, 'payout', `Monthly payouts: ${r.paid} paid, ${r.failed} failed`);
  }
  const week = `${now.getUTCFullYear()}-${Math.floor((now.getTime() / 86_400_000 + 3) / 7)}`;
  if (now.getUTCDay() === 1 && now.getUTCHours() >= 15 && (await getConfig<string>(env, 'last_weekly')) !== week) {
    await setConfig(env, 'last_weekly', week);
    await sendWeeklySummaries(env);
  }
}
