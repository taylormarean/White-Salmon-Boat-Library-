// Usage billing: every Claude call is metered, charged at PRICE_MULTIPLIER × its cost from a prepaid
// balance, and — if the customer was referred — REFERRAL_SHARE of the profit is credited to the referrer.
// Spending caps: each account's own monthly cap, and a business-wide monthly cap on total AI cost.
import type { Env } from './env';
import { getConfig, logActivity, U } from './lib/db';
import { getUser, num } from './accounts';

/** USD per million tokens (= micro-dollars per token). Verify against https://www.anthropic.com/pricing. */
const PRICES: { prefix: string; input: number; output: number; cacheRead: number }[] = [
  { prefix: 'claude-opus-5-5', input: 4, output: 20, cacheRead: 0.2 },
  { prefix: 'claude-opus-5', input: 5, output: 25, cacheRead: 0.5 },
  { prefix: 'claude-opus-4', input: 5, output: 25, cacheRead: 0.5 },
  { prefix: 'claude-fable-5-2', input: 8, output: 40, cacheRead: 0.2 },
  { prefix: 'claude-fable-5', input: 10, output: 50, cacheRead: 1 },
  { prefix: 'claude-sonnet-5-5', input: 2, output: 10, cacheRead: 0.1 },
  { prefix: 'claude-sonnet-5', input: 2, output: 10, cacheRead: 0.2 },
  { prefix: 'claude-sonnet-4', input: 3, output: 15, cacheRead: 0.3 },
  { prefix: 'claude-haiku-5-5', input: 0.1, output: 0.5, cacheRead: 0.01 },
  { prefix: 'claude-haiku-4', input: 1, output: 5, cacheRead: 0.1 },
];
const UNKNOWN = { input: 5, output: 25, cacheRead: 0.5 }; // conservative default
const WEB_SEARCH_MICRO = 10_000; // $10 per 1,000 searches

export function priceFor(model: string) {
  return PRICES.find((p) => model.startsWith(p.prefix)) ?? UNKNOWN;
}

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number } | null;
  iterations?: { type: string; model?: string | null; input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }[] | null;
}

export interface Metered { model: string; input: number; output: number; cacheWrite: number; cacheRead: number; searches: number; costMicro: number }

/** Cost of one response. With server-side fallbacks, each model that ran is priced at its own rate. */
export function meter(model: string, u: UsageLike): Metered {
  const parts = u.iterations?.filter((i) => i.type === 'message' || i.type === 'fallback_message') ?? [];
  const rows = parts.length
    ? parts.map((i) => ({ model: i.model ?? model, input: i.input_tokens, output: i.output_tokens, cw: i.cache_creation_input_tokens ?? 0, cr: i.cache_read_input_tokens ?? 0 }))
    : [{ model, input: u.input_tokens, output: u.output_tokens, cw: u.cache_creation_input_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0 }];
  let cost = 0;
  for (const r of rows) {
    const p = priceFor(r.model);
    cost += r.input * p.input + r.output * p.output + r.cw * p.input * 1.25 + r.cr * p.cacheRead;
  }
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  cost += searches * WEB_SEARCH_MICRO;
  const sum = (k: 'input' | 'output' | 'cw' | 'cr') => rows.reduce((n, r) => n + r[k], 0);
  return { model: rows[rows.length - 1].model, input: sum('input'), output: sum('output'), cacheWrite: sum('cw'), cacheRead: sum('cr'), searches, costMicro: Math.ceil(cost) };
}

export function chargeFor(costMicro: number, env: Env): number {
  return Math.ceil(costMicro * num(env.PRICE_MULTIPLIER, 2));
}
export function referralCut(costMicro: number, chargeMicro: number, env: Env): number {
  return Math.floor(Math.max(0, chargeMicro - costMicro) * num(env.REFERRAL_SHARE, 0.5));
}

export class BillingError extends Error {
  constructor(public code: 'no_credit' | 'cap' | 'global_cap' | 'inactive', message: string) {
    super(message);
  }
}

const MONTH = "datetime('now','start of month')";

export async function monthSpend(env: Env, userId: number): Promise<{ cost: number; charge: number }> {
  const r = await env.DB.prepare(`SELECT COALESCE(SUM(cost_micro),0) AS cost, COALESCE(SUM(charge_micro),0) AS charge FROM usage_events WHERE user_id = ? AND created_at >= ${MONTH}`)
    .bind(userId).first<{ cost: number; charge: number }>();
  return { cost: r?.cost ?? 0, charge: r?.charge ?? 0 };
}

export async function globalMonthCost(env: Env): Promise<number> {
  return (await env.DB.prepare(`SELECT COALESCE(SUM(cost_micro),0) AS n FROM usage_events WHERE created_at >= ${MONTH}`).first<{ n: number }>())?.n ?? 0;
}

/** Throws BillingError if this account may not spend on AI right now. Call before every Claude request. */
export async function guardSpend(env: Env, opts: { free?: boolean } = {}): Promise<void> {
  if (env.uid == null) return; // system-level calls (none today) aren't billed
  if (opts.free) {
    // Business-paid calls (support chat) only respect the business-wide cap.
    const cap = await getConfig<number>(env, 'global_cap_usd');
    if (cap && (await globalMonthCost(env)) >= cap * 1_000_000) throw new BillingError('global_cap', 'Support chat is resting for the moment — please email support instead.');
    return;
  }
  const user = await getUser(env, U(env));
  if (!user || user.status !== 'active') throw new BillingError('inactive', 'This account isn’t active yet.');
  const globalCap = await getConfig<number>(env, 'global_cap_usd');
  if (globalCap && (await globalMonthCost(env)) >= globalCap * 1_000_000) {
    throw new BillingError('global_cap', 'The app has reached its spending limit for this month — it will pick back up soon.');
  }
  const month = await monthSpend(env, user.id);
  if (user.plan === 'free') {
    if (user.monthly_cap_micro != null && month.cost >= user.monthly_cap_micro) throw new BillingError('cap', 'You’ve reached this month’s AI limit. It resets on the 1st.');
    return;
  }
  if (user.balance_micro <= 0) throw new BillingError('no_credit', 'You’re out of credit — add some in Billing to keep going.');
  if (user.monthly_cap_micro != null && month.charge >= user.monthly_cap_micro) throw new BillingError('cap', 'You’ve reached the monthly spending limit you set. Raise it in Billing, or it resets on the 1st.');
}

/** Record one Claude response: usage event, balance debit, referral earning. */
export async function recordUsage(env: Env, purpose: string, model: string, usage: UsageLike, opts: { free?: boolean } = {}): Promise<Metered & { chargeMicro: number }> {
  return bill(env, purpose, meter(model, usage), opts);
}

/** A paid non-AI call (e.g. a Google for Jobs search), billed like AI usage: cost × multiplier, referral share. */
export async function recordCost(env: Env, purpose: string, service: string, costMicro: number, searches = 1): Promise<Metered & { chargeMicro: number }> {
  return bill(env, purpose, { model: service, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, searches, costMicro: Math.ceil(costMicro) }, {});
}

async function bill(env: Env, purpose: string, m: Metered, opts: { free?: boolean }): Promise<Metered & { chargeMicro: number }> {
  if (env.uid == null) return { ...m, chargeMicro: 0 };
  const user = await getUser(env, U(env));
  const charge = user && user.plan === 'paid' && !opts.free ? chargeFor(m.costMicro, env) : 0;
  const ev = await env.DB.prepare(
    `INSERT INTO usage_events (user_id, purpose, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, web_searches, cost_micro, charge_micro)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(U(env), purpose, m.model, m.input, m.output, m.cacheWrite, m.cacheRead, m.searches, m.costMicro, charge).run();
  const stmts: D1PreparedStatement[] = [];
  if (m.model !== 'serpapi') stmts.push(env.DB.prepare("UPDATE alerts SET resolved = 1 WHERE user_id = ? AND kind = 'ai' AND resolved = 0").bind(U(env)));
  if (charge) stmts.push(env.DB.prepare('UPDATE users SET balance_micro = balance_micro - ? WHERE id = ?').bind(charge, U(env)));
  const cut = user?.referred_by && charge ? referralCut(m.costMicro, charge, env) : 0;
  if (cut) {
    stmts.push(env.DB.prepare('INSERT INTO referral_earnings (referrer_id, referred_id, usage_event_id, amount_micro) VALUES (?, ?, ?, ?)')
      .bind(user!.referred_by, U(env), ev.meta.last_row_id, cut));
  }
  if (stmts.length) await env.DB.batch(stmts);
  if (user && user.plan === 'paid' && user.balance_micro - charge <= 0 && user.balance_micro > 0) {
    await logActivity(env, 'billing', 'Credit ran out — AI work is paused until more is added');
  }
  return { ...m, chargeMicro: charge };
}

export function usd(micro: number): string {
  const v = micro / 1_000_000;
  return `$${v.toFixed(Math.abs(v) < 1 && v !== 0 ? 3 : 2)}`;
}
