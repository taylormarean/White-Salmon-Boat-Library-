// JWT + password auth utilities using Web Crypto API (no dependencies)
// Same implementation as the Gorge rides fleet platform (worker/src/lib/auth.ts).

import type { Env } from '../index';

// --- Password hashing (PBKDF2-SHA256) ---

const PBKDF2_ITERATIONS = 100_000;

async function deriveKey(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

/** Hash a password. Returns "salt:hash" (both hex). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveKey(password, salt);
  return `${toHex(salt.buffer)}:${toHex(hash)}`;
}

/** Verify password against a "salt:hash" string. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = fromHex(saltHex);
  const derived = await deriveKey(password, salt);
  return toHex(derived) === hashHex;
}

// --- JWT (HMAC-SHA256, no library) ---

function base64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export interface JWTPayload {
  sub: string;   // username (lowercase email)
  name: string;  // display name
  role?: string; // admin, librarian, volunteer, member, disabled
  iat: number;
  exp: number;
}

const JWT_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

export async function signJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>, secret: string, expiresInSeconds?: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = { ...payload, iat: now, exp: now + (expiresInSeconds ?? JWT_EXPIRY_SECONDS) };
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64url(enc.encode(JSON.stringify(fullPayload)));
  const key = await getSigningKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${base64url(sig)}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const enc = new TextEncoder();
  const key = await getSigningKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, base64urlDecode(sig), enc.encode(`${header}.${body}`));
  if (!valid) return null;
  const payload: JWTPayload = JSON.parse(new TextDecoder().decode(base64urlDecode(body)));
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function jwtSecret(env: Env): string {
  return env.JWT_SECRET ?? 'fallback-change-me';
}

// --- Auth route handlers ---

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { username?: string; password?: string };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const username = (body.username ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!username || !password) return json({ error: 'Email and password required' }, 400);

  // Rate-limit by username AND IP (same scheme as fleet-app)
  const clientIP = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rateKeyUser = `login_fail:${username}`;
  const rateKeyIP = `login_fail_ip:${clientIP}`;
  const [failCountUser, failCountIP] = await Promise.all([
    env.KV.get(rateKeyUser).then((v) => parseInt(v ?? '0')),
    env.KV.get(rateKeyIP).then((v) => parseInt(v ?? '0')),
  ]);
  if (failCountUser >= 5 || failCountIP >= 15) {
    return json({ error: 'Too many failed attempts. Try again in 15 minutes.' }, 429);
  }

  const user = await env.DB.prepare('SELECT username, password_hash, display_name, role, member_id FROM users WHERE username = ?')
    .bind(username)
    .first<{ username: string; password_hash: string; display_name: string; role: string; member_id: string | null }>();

  // Timing-attack mitigation: always run PBKDF2 even if user doesn't exist
  const dummyHash = 'deadbeefdeadbeefdeadbeefdeadbeef:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  const passwordValid = await verifyPassword(password, user?.password_hash ?? dummyHash);

  if (!user || !passwordValid) {
    await Promise.all([
      env.KV.put(rateKeyUser, String(failCountUser + 1), { expirationTtl: 900 }),
      env.KV.put(rateKeyIP, String(failCountIP + 1), { expirationTtl: 900 }),
    ]);
    return json({ error: 'Invalid email or password' }, 401);
  }

  await Promise.all([env.KV.delete(rateKeyUser), env.KV.delete(rateKeyIP)]);

  const role = user.role ?? 'member';
  if (role === 'disabled') return json({ error: 'This account is disabled.' }, 403);

  env.DB.prepare('UPDATE users SET last_login_at = datetime("now") WHERE username = ?').bind(user.username).run().catch(() => {});

  const token = await signJWT({ sub: user.username, name: user.display_name, role }, jwtSecret(env));
  return json({ token, user: { username: user.username, name: user.display_name, role, member_id: user.member_id } });
}

export async function handleVerify(request: Request, env: Env): Promise<Response> {
  const payload = await getRequestJwtPayload(request, env);
  if (!payload) return json({ error: 'Invalid or expired token' }, 401);
  // Always re-fetch role from DB so demotions take effect before token expiry
  const row = await env.DB.prepare('SELECT role, member_id FROM users WHERE username = ?').bind(payload.sub)
    .first<{ role: string; member_id: string | null }>();
  const role = row?.role ?? payload.role ?? 'member';
  if (role === 'disabled') return json({ error: 'This account is disabled.' }, 403);
  return json({ user: { username: payload.sub, name: payload.name, role, member_id: row?.member_id ?? null } });
}

export async function handleChangePassword(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const payload = await getRequestJwtPayload(request, env);
  if (!payload) return json({ error: 'Unauthorized' }, 401);

  let body: { current_password?: string; new_password?: string };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const current = body.current_password ?? '';
  const next = body.new_password ?? '';
  if (!current || !next) return json({ error: 'Current and new password are required' }, 400);
  if (next.length < 6) return json({ error: 'New password must be at least 6 characters' }, 400);
  if (current === next) return json({ error: 'New password must differ from current password' }, 400);

  const user = await env.DB.prepare('SELECT username, password_hash FROM users WHERE username = ?')
    .bind(payload.sub).first<{ username: string; password_hash: string }>();
  if (!user) return json({ error: 'Account not found' }, 404);

  const ok = await verifyPassword(current, user.password_hash);
  if (!ok) return json({ error: 'Current password is incorrect' }, 401);

  const newHash = await hashPassword(next);
  await env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE username = ?')
    .bind(newHash, user.username).run();
  return json({ success: true });
}

/** Check JWT auth for protected routes. */
export async function checkJWTAuth(request: Request, env: Env): Promise<boolean> {
  return (await getRequestJwtPayload(request, env)) !== null;
}

/** Extract the JWT payload (or null) from a request. */
export async function getRequestJwtPayload(request: Request, env: Env): Promise<JWTPayload | null> {
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/, '');
  if (!token) return null;
  return verifyJWT(token, jwtSecret(env));
}

/** True if the caller's role (re-checked from DB) is in `roles`. */
export async function hasRoleRequest(request: Request, env: Env, roles: string[]): Promise<boolean> {
  const payload = await getRequestJwtPayload(request, env);
  if (!payload?.sub) return false;
  const row = await env.DB.prepare('SELECT role FROM users WHERE username = ?').bind(payload.sub).first<{ role: string }>();
  return !!row?.role && roles.includes(row.role);
}

/** True if the caller is an admin (re-checked from DB). */
export async function isAdminRequest(request: Request, env: Env): Promise<boolean> {
  return hasRoleRequest(request, env, ['admin']);
}
