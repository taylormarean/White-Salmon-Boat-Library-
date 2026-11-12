// Accounts: sign-up, roles (admin / comped), referral codes, helpers who can act in someone's workspace.
import type { Env } from './env';
import { logActivity } from './lib/db';

export interface UserRow {
  id: number;
  email: string;
  name: string;
  plan: 'paid' | 'free';
  is_admin: number;
  status: 'active' | 'waitlist' | 'suspended';
  referral_code: string;
  referred_by: number | null;
  balance_micro: number;
  monthly_cap_micro: number | null;
  stripe_customer_id: string | null;
  connect_account_id: string | null;
  connect_ready: number;
  api_key_hash: string | null;
  phone: string | null;
  sms_opt_in: number;
  created_at: string;
  last_login_at: string | null;
}

function list(v?: string): string[] {
  return (v ?? '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}
export function adminEmails(env: Env): string[] {
  // v1 installs listed "mom first, then helpers" in ALLOWED_EMAILS — the helpers become admins.
  return [...list(env.ADMIN_EMAILS), ...list(env.ALLOWED_EMAILS).slice(1)];
}
export function freeEmails(env: Env): string[] {
  return [...list(env.FREE_EMAILS), ...list(env.ALLOWED_EMAILS).slice(0, 1)];
}
export function signupOpen(env: Env): boolean {
  return env.OPEN_SIGNUP !== '0';
}
export function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : fallback;
}

export async function getUser(env: Env, id: number): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}
export async function getUserByEmail(env: Env, email: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email.toLowerCase()).first<UserRow>();
}
export async function getUserByReferral(env: Env, code: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM users WHERE referral_code = ?').bind(code.trim().toUpperCase()).first<UserRow>();
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
function randomCode(n = 7): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export type SignInResult =
  | { ok: true; user: UserRow; created: boolean }
  | { ok: false; reason: 'closed' | 'suspended'; message: string };

/**
 * Find or create the account for a Google sign-in. New accounts: comped if listed in FREE_EMAILS,
 * admin if in ADMIN_EMAILS, waitlisted past the beta cap, credited to whoever referred them (one level).
 */
export async function signIn(env: Env, email: string, name: string, referralCode?: string | null): Promise<SignInResult> {
  email = email.toLowerCase();
  const isAdmin = adminEmails(env).includes(email);
  const isFree = freeEmails(env).includes(email);
  let user = await getUserByEmail(env, email);
  let created = false;

  if (!user) {
    if (!signupOpen(env) && !isAdmin && !isFree && !(await isHelperAnywhere(env, email))) {
      return { ok: false, reason: 'closed', message: 'Sign-ups are invite-only right now.' };
    }
    const count = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").first<{ n: number }>())?.n ?? 0;
    const status = isAdmin || isFree || count < num(env.MAX_USERS, 100) ? 'active' : 'waitlist';
    let referrer: UserRow | null = referralCode ? await getUserByReferral(env, referralCode) : null;
    if (referrer && referrer.email === email) referrer = null;
    const credit = isFree ? 0 : Math.round(num(env.SIGNUP_CREDIT_USD, 0) * 1_000_000);
    for (let attempt = 0; attempt < 5 && !user; attempt++) {
      try {
        user = await env.DB.prepare(
          `INSERT INTO users (email, name, plan, is_admin, status, referral_code, referred_by, balance_micro, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) RETURNING *`,
        ).bind(email, name || email.split('@')[0], isFree ? 'free' : 'paid', isAdmin ? 1 : 0, status, randomCode(), referrer?.id ?? null, credit).first<UserRow>();
      } catch (e) {
        if (!/UNIQUE.*referral_code/i.test(String(e))) throw e; // retry only on a code collision
      }
    }
    if (credit) {
      await env.DB.prepare("INSERT INTO credit_purchases (user_id, amount_micro, status, note) VALUES (?, ?, 'adjustment', 'Welcome credit')").bind(user!.id, credit).run();
    }
    created = true;
    await logActivity({ ...env, uid: user!.id }, 'signup', `New account${referrer ? ` referred by ${referrer.email}` : ''}${status === 'waitlist' ? ' (waitlist)' : ''}`);
  } else {
    // Roles follow the configured lists; comping can also be set from the admin dashboard.
    await env.DB.prepare(
      `UPDATE users SET name = CASE WHEN ? != '' THEN ? ELSE name END, is_admin = ?, plan = CASE WHEN ? THEN 'free' ELSE plan END,
         status = CASE WHEN status = 'waitlist' AND (? OR ?) THEN 'active' ELSE status END, last_login_at = datetime('now') WHERE id = ?`,
    ).bind(name, name, isAdmin ? 1 : 0, isFree ? 1 : 0, isAdmin ? 1 : 0, isFree ? 1 : 0, user.id).run();
    user = (await getUser(env, user.id))!;
  }
  if (user!.status === 'suspended') return { ok: false, reason: 'suspended', message: 'This account is paused. Please contact support.' };
  return { ok: true, user: user!, created };
}

async function isHelperAnywhere(env: Env, email: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 FROM helpers WHERE helper_email = ?').bind(email).first());
}

/** Workspaces this person may act in: their own, plus any job seeker who invited them as a helper. */
export async function workspacesFor(env: Env, user: UserRow): Promise<{ id: number; name: string; email: string; own: boolean }[]> {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, u.email FROM helpers h JOIN users u ON u.id = h.owner_id WHERE h.helper_email = ? AND u.status != 'suspended' ORDER BY u.name`,
  ).bind(user.email).all<{ id: number; name: string; email: string }>();
  return [{ id: user.id, name: user.name, email: user.email, own: true }, ...results.map((r) => ({ ...r, own: false }))];
}

export async function canActIn(env: Env, user: UserRow, workspaceId: number): Promise<boolean> {
  if (workspaceId === user.id) return true;
  return !!(await env.DB.prepare('SELECT 1 FROM helpers WHERE owner_id = ? AND helper_email = ?').bind(workspaceId, user.email).first());
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A fresh browser-helper key (shown once; only its hash is stored). */
export async function newApiKey(env: Env, userId: number): Promise<string> {
  const raw = `nc_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  await env.DB.prepare('UPDATE users SET api_key_hash = ? WHERE id = ?').bind(await sha256Hex(raw), userId).run();
  return raw;
}

export async function userByApiKey(env: Env, key: string): Promise<UserRow | null> {
  if (!key.startsWith('nc_')) return null;
  return env.DB.prepare("SELECT * FROM users WHERE api_key_hash = ? AND status = 'active'").bind(await sha256Hex(key)).first<UserRow>();
}
