// AES-GCM for secrets at rest (the Gmail refresh token). Key derived from TOKEN_ENC_KEY.
import type { Env } from '../env';
import { b64url, b64urlDecode } from './auth';

async function key(env: Env): Promise<CryptoKey> {
  if (!env.TOKEN_ENC_KEY || env.TOKEN_ENC_KEY.length < 16) throw new Error('TOKEN_ENC_KEY is not configured');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.TOKEN_ENC_KEY));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(env: Env, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(plaintext));
  return `${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function decrypt(env: Env, blob: string): Promise<string> {
  const [iv, ct] = blob.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(iv) }, await key(env), b64urlDecode(ct));
  return new TextDecoder().decode(pt);
}
