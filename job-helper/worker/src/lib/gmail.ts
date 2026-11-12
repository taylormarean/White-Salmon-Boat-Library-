// Google: "Sign in with Google" (which also connects her Gmail), sending as her
// (with attachments, threaded), reading replies, and pulling old resumes out of her mail.
import type { Env } from '../env';
import { getSetting, setSetting } from './db';
import { decrypt, encrypt } from './crypto';
import { buildMime, toBase64Url, type Attachment } from './mime';
import { b64urlDecode } from './auth';
import { htmlToText } from './text';

const IDENTITY = ['openid', 'email', 'profile'];
const GMAIL = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'];
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * owner  — the job seeker: identity + Gmail in one consent screen.
 * helper — family member helping out: identity only (their Gmail is never touched).
 * connect — owner re-connecting Gmail from Settings (e.g. she unticked a box the first time).
 */
export type AuthMode = 'owner' | 'helper' | 'connect';

interface StoredTokens { refresh: string; email: string; connected_at: string } // refresh is encrypted

export function googleConfigured(env: Env): boolean {
  return !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;
}

/** Lower-cased allowlist. The first address is the job seeker; the rest are helpers. */
export function allowedEmails(env: Env): string[] {
  return (env.ALLOWED_EMAILS ?? '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}
export function ownerEmail(env: Env): string | null {
  return allowedEmails(env)[0] ?? null;
}

export function redirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/google/callback`;
}

export function authUrl(env: Env, origin: string, state: string, mode: AuthMode): string {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: (mode === 'helper' ? IDENTITY : [...IDENTITY, ...GMAIL]).join(' '),
    access_type: mode === 'helper' ? 'online' : 'offline',
    prompt: mode === 'helper' ? 'select_account' : 'consent select_account',
    include_granted_scopes: 'true',
    state,
  });
  const owner = ownerEmail(env);
  if (mode !== 'helper' && owner) p.set('login_hint', owner);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

interface TokenResponse { access_token: string; refresh_token?: string; expires_in: number; scope: string }

async function tokenRequest(env: Env, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, ...params }),
  });
  const data = (await res.json()) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`Google sign-in failed: ${data.error_description ?? data.error ?? res.status}`);
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in ?? 3600, scope: data.scope ?? '' };
}

export interface GoogleLogin {
  email: string;
  name: string;
  verified: boolean;
  gmailGranted: boolean;
  tokens: TokenResponse;
}

export async function exchangeCode(env: Env, origin: string, code: string): Promise<GoogleLogin> {
  const tokens = await tokenRequest(env, { code, grant_type: 'authorization_code', redirect_uri: redirectUri(origin) });
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const info = (await res.json()) as { email?: string; email_verified?: boolean; name?: string; given_name?: string };
  if (!res.ok || !info.email) throw new Error('Google didn’t share an email address.');
  const granted = tokens.scope.split(' ');
  return {
    email: info.email.toLowerCase(),
    name: info.name ?? info.given_name ?? '',
    verified: info.email_verified !== false,
    gmailGranted: GMAIL.every((s) => granted.includes(s)),
    tokens,
  };
}

/** Save the owner's Gmail access (refresh token encrypted at rest). */
export async function storeGmail(env: Env, login: GoogleLogin): Promise<boolean> {
  if (!login.gmailGranted || !login.tokens.refresh_token) return false;
  await setSetting(env, 'google', { refresh: await encrypt(env, login.tokens.refresh_token), email: login.email, connected_at: new Date().toISOString() } satisfies StoredTokens);
  cachedToken = { token: login.tokens.access_token, exp: Date.now() + (login.tokens.expires_in - 60) * 1000 };
  return true;
}

/** Give back a token we don't want (e.g. a helper who clicked the owner button). */
export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
}

export async function gmailStatus(env: Env): Promise<{ configured: boolean; connected: boolean; email: string | null }> {
  const g = await getSetting<StoredTokens>(env, 'google');
  return { configured: googleConfigured(env), connected: !!g, email: g?.email ?? null };
}

export async function disconnectGmail(env: Env): Promise<void> {
  const g = await getSetting<StoredTokens>(env, 'google');
  if (g) await revokeToken(await decrypt(env, g.refresh)).catch(() => {});
  await env.DB.prepare("DELETE FROM settings WHERE key = 'google'").run();
  cachedToken = null;
}

let cachedToken: { token: string; exp: number } | null = null;

async function accessToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now()) return cachedToken.token;
  const g = await getSetting<StoredTokens>(env, 'google');
  if (!g) throw new Error('Gmail is not connected.');
  try {
    const t = await tokenRequest(env, { refresh_token: await decrypt(env, g.refresh), grant_type: 'refresh_token' });
    cachedToken = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
    return t.access_token;
  } catch (e) {
    console.error('Gmail token refresh failed', e); // details for `wrangler tail`; she gets plain words
    throw new Error('Gmail needs to be reconnected — sign out, then sign in with Google again.');
  }
}

async function gmailRaw(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken(env)}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

async function gmail<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  return (await gmailRaw(env, path, init)).json() as Promise<T>;
}

export interface SendInput {
  fromName: string;
  to: string;
  subject: string;
  text: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  attachments?: Attachment[];
}

/** Sends from her Gmail. Returns Gmail ids and the RFC Message-ID (for threading follow-ups). */
export async function sendEmail(env: Env, m: SendInput): Promise<{ id: string; threadId: string; messageId: string | null }> {
  const g = await getSetting<StoredTokens>(env, 'google');
  if (!g) throw new Error('Gmail is not connected.');
  const from = m.fromName ? `${m.fromName.replace(/[<>"]/g, '')} <${g.email}>` : g.email;
  const raw = toBase64Url(buildMime({ from, to: m.to, subject: m.subject, text: m.text, inReplyTo: m.inReplyTo, attachments: m.attachments }));
  const sent = await gmail<{ id: string; threadId: string }>(env, '/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw, ...(m.threadId ? { threadId: m.threadId } : {}) }),
  });
  const meta = await gmail<GmailMessage>(env, `/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`).catch(() => null);
  return { id: sent.id, threadId: sent.threadId, messageId: meta ? header(meta, 'Message-ID') : null };
}

interface GmailPart { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[]; headers?: { name: string; value: string }[] }
interface GmailMessage { id: string; threadId: string; internalDate?: string; snippet?: string; labelIds?: string[]; payload?: GmailPart }

function header(m: GmailMessage, name: string): string | null {
  return m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function decodePart(data?: string): string {
  return data ? new TextDecoder().decode(b64urlDecode(data)) : '';
}

function bodyText(part: GmailPart | undefined): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && !part.filename) return decodePart(part.body?.data);
  if (part.parts?.length) {
    const plain = part.parts.map((p) => (p.mimeType === 'text/plain' || p.mimeType?.startsWith('multipart/') ? bodyText(p) : '')).join('\n').trim();
    if (plain) return plain;
    const html = part.parts.find((p) => p.mimeType === 'text/html');
    if (html) return htmlToText(decodePart(html.body?.data));
  }
  if (part.mimeType === 'text/html') return htmlToText(decodePart(part.body?.data));
  return '';
}

function attachmentsOf(part: GmailPart | undefined, out: { filename: string; attachmentId: string; mimeType: string }[] = []) {
  if (!part) return out;
  if (part.filename && part.body?.attachmentId) out.push({ filename: part.filename, attachmentId: part.body.attachmentId, mimeType: part.mimeType ?? '' });
  for (const p of part.parts ?? []) attachmentsOf(p, out);
  return out;
}

export interface InboxMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  messageId: string | null;
  attachments: { filename: string; attachmentId: string; mimeType: string }[];
}

export async function listMessages(env: Env, q: string, max = 40): Promise<{ id: string; threadId: string }[]> {
  const data = await gmail<{ messages?: { id: string; threadId: string }[] }>(env, `/messages?q=${encodeURIComponent(q)}&maxResults=${max}`);
  return data.messages ?? [];
}

export async function getMessage(env: Env, id: string): Promise<InboxMessage> {
  const m = await gmail<GmailMessage>(env, `/messages/${id}?format=full`);
  return {
    id: m.id,
    threadId: m.threadId,
    from: header(m, 'From') ?? '',
    to: header(m, 'To') ?? '',
    subject: header(m, 'Subject') ?? '',
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : '',
    body: bodyText(m.payload).slice(0, 20000),
    messageId: header(m, 'Message-ID'),
    attachments: attachmentsOf(m.payload),
  };
}

export async function getAttachment(env: Env, messageId: string, attachmentId: string): Promise<Uint8Array> {
  const a = await gmail<{ data: string }>(env, `/messages/${messageId}/attachments/${attachmentId}`);
  return b64urlDecode(a.data);
}

export async function connectedEmail(env: Env): Promise<string | null> {
  return (await getSetting<StoredTokens>(env, 'google'))?.email ?? null;
}
