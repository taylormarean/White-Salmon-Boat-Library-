// HS256 JWT on Web Crypto (no dependencies).
import type { Env } from '../env';

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (str.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export interface JwtPayload {
  sub: number;        // the person signed in
  email: string;
  name: string;
  ws?: number;        // the workspace they're acting in (their own, or one they help with)
  purpose?: string;
  exp: number;
}

function secret(env: Env): string {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) throw new Error('JWT_SECRET is not configured');
  return env.JWT_SECRET;
}

export async function signJwt(env: Env, payload: Omit<JwtPayload, 'exp'>, ttlSeconds: number): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const full = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = b64url(enc.encode(JSON.stringify(full)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret(env)), enc.encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyJwt(env: Env, token: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(secret(env)), b64urlDecode(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return null; // malformed token
  }
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function currentUser(request: Request, env: Env): Promise<JwtPayload | null> {
  const h = request.headers.get('Authorization') ?? '';
  if (!h.startsWith('Bearer ')) return null;
  const payload = await verifyJwt(env, h.slice(7));
  if (!payload || payload.purpose) return null; // purpose-scoped tokens (oauth state, vote links) can't log in
  return payload;
}
