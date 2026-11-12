// Gmail: OAuth connect, send as her (with attachments, threaded), and read replies.
import type { Env } from '../env';
import { getSetting, setSetting } from './db';
import { decrypt, encrypt } from './crypto';
import { buildMime, toBase64Url, type Attachment } from './mime';
import { b64urlDecode } from './auth';
import { htmlToText } from './text';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface StoredTokens { refresh: string; email: string; connected_at: string } // refresh is encrypted

export function gmailConfigured(env: Env): boolean {
  return !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;
}

function redirectUri(env: Env): string {
  return `${env.API_URL.replace(/\/$/, '')}/api/google/callback`;
}

export function authUrl(env: Env, state: string): string {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(env: Env, params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, ...params }),
  });
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`Google sign-in failed: ${data.error_description ?? data.error ?? res.status}`);
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in ?? 3600 };
}

export async function completeOAuth(env: Env, code: string): Promise<string> {
  const t = await tokenRequest(env, { code, grant_type: 'authorization_code', redirect_uri: redirectUri(env) });
  if (!t.refresh_token) throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
  const profile = (await (await fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${t.access_token}` } })).json()) as { emailAddress?: string };
  const stored: StoredTokens = { refresh: await encrypt(env, t.refresh_token), email: profile.emailAddress ?? '', connected_at: new Date().toISOString() };
  await setSetting(env, 'google', stored);
  cachedToken = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
  return stored.email;
}

export async function gmailStatus(env: Env): Promise<{ configured: boolean; connected: boolean; email: string | null }> {
  const g = await getSetting<StoredTokens>(env, 'google');
  return { configured: gmailConfigured(env), connected: !!g, email: g?.email ?? null };
}

export async function disconnectGmail(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE key = 'google'").run();
  cachedToken = null;
}

let cachedToken: { token: string; exp: number } | null = null;

async function accessToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now()) return cachedToken.token;
  const g = await getSetting<StoredTokens>(env, 'google');
  if (!g) throw new Error('Gmail is not connected.');
  const t = await tokenRequest(env, { refresh_token: await decrypt(env, g.refresh), grant_type: 'refresh_token' });
  cachedToken = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
  return t.access_token;
}

async function gmail<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken(env)}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
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

interface GmailPart { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: { name: string; value: string }[] }
interface GmailMessage { id: string; threadId: string; internalDate?: string; snippet?: string; labelIds?: string[]; payload?: GmailPart }

function header(m: GmailMessage, name: string): string | null {
  return m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function decodePart(data?: string): string {
  return data ? new TextDecoder().decode(b64urlDecode(data)) : '';
}

function bodyText(part: GmailPart | undefined): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain') return decodePart(part.body?.data);
  if (part.parts?.length) {
    const plain = part.parts.map((p) => (p.mimeType === 'text/plain' || p.mimeType?.startsWith('multipart/') ? bodyText(p) : '')).join('\n').trim();
    if (plain) return plain;
    const html = part.parts.find((p) => p.mimeType === 'text/html');
    if (html) return htmlToText(decodePart(html.body?.data));
  }
  if (part.mimeType === 'text/html') return htmlToText(decodePart(part.body?.data));
  return '';
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
  };
}

export async function connectedEmail(env: Env): Promise<string | null> {
  return (await getSetting<StoredTokens>(env, 'google'))?.email ?? null;
}
