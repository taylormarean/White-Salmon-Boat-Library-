// Shared helpers: JSON responses, id generation, access-code generation, settings.

import type { Env } from '../index';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export function newId(prefix: string): string {
  const rand = crypto.getRandomValues(new Uint8Array(6));
  const s = [...rand].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
  return `${prefix}_${Date.now().toString(36)}${s}`;
}

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value).run();
}

/** Random 6-digit access code for per-checkout mode. */
export function randomAccessCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

/**
 * Deterministic daily door code: HMAC-SHA256(secret, YYYY-MM-DD) -> 6 digits.
 * Lets staff program the smart lock ahead of time (the same derivation runs in
 * the admin Settings page) while members only ever see today's code after a
 * valid self check-in.
 */
export async function dailyAccessCode(secret: string, dateYmd: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`door:${dateYmd}`));
  const bytes = new Uint8Array(sig);
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, '0');
}

/** Today's date in Pacific time as YYYY-MM-DD (the shed lives in Husum, WA). */
export function todayPacific(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

/** Audit-log helper — same pattern as fleet-app's audit(). */
export async function audit(env: Env, request: Request | null, actor: string, action: string, target?: string, meta?: unknown): Promise<void> {
  const ip = request?.headers.get('CF-Connecting-IP') ?? null;
  await env.DB.prepare('INSERT INTO admin_audit_log (actor, action, target, meta, ip) VALUES (?, ?, ?, ?, ?)')
    .bind(actor, action, target ?? null, meta ? JSON.stringify(meta) : null, ip)
    .run()
    .catch(() => {});
}
