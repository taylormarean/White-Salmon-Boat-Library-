// End-to-end: the real Worker bundle running in workerd (Miniflare), with Google's sign-in,
// userinfo, and Gmail endpoints faked by an outbound interceptor. Covers the whole
// "Sign in with Google → app sets itself up from Gmail → send an application" path.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { markdownToDocxBase64 } from '../src/lib/docx';

const ORIGIN = 'https://nc.test';
const GMAIL = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';
const USERS: Record<string, { email: string; name: string; scope: string; refresh?: string }> = {
  'mom-full': { email: 'mom@gmail.com', name: 'Linda Example', scope: `openid email profile ${GMAIL}`, refresh: 'mom-refresh' },
  'mom-nogmail': { email: 'mom@gmail.com', name: 'Linda Example', scope: 'openid email profile' },
  'helper': { email: 'kid@example.com', name: 'Kid Example', scope: 'openid email profile' },
  'helper-overgranted': { email: 'kid@example.com', name: 'Kid Example', scope: `openid email profile ${GMAIL}`, refresh: 'kid-refresh' },
  'stranger': { email: 'stranger@example.com', name: 'Stranger', scope: `openid email profile ${GMAIL}`, refresh: 'stranger-refresh' },
};

const revoked: string[] = [];
const sent: string[] = [];
let resumeDocxB64url = '';

function b64url(s: string) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const j = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });

async function fakeInternet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const auth = req.headers.get('Authorization') ?? '';
  if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') {
    const form = new URLSearchParams(await req.text());
    if (form.get('grant_type') === 'refresh_token') return j({ access_token: `at-${form.get('refresh_token')}`, expires_in: 3600, scope: GMAIL });
    const u = USERS[form.get('code') ?? ''];
    if (!u) return j({ error: 'invalid_grant' }, 400);
    expect(form.get('redirect_uri')).toBe(`${ORIGIN}/api/google/callback`);
    return j({ access_token: `at-${form.get('code')}`, refresh_token: u.refresh, expires_in: 3600, scope: u.scope });
  }
  if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
    revoked.push(url.searchParams.get('token') ?? '');
    return new Response('');
  }
  if (url.host === 'openidconnect.googleapis.com') {
    const u = USERS[auth.replace('Bearer at-', '')];
    return u ? j({ email: u.email, email_verified: true, name: u.name }) : j({}, 401);
  }
  if (url.host === 'gmail.googleapis.com') {
    const p = url.pathname.replace('/gmail/v1/users/me', '');
    const q = url.searchParams.get('q') ?? '';
    if (p === '/messages' && q.includes('in:sent')) return j({ messages: [{ id: 'sent1', threadId: 't1' }] });
    if (p === '/messages' && q.includes('has:attachment')) return j({ messages: [{ id: 'att1', threadId: 't2' }] });
    if (p === '/messages') return j({});
    if (p === '/messages/sent1') {
      return j({ id: 'sent1', threadId: 't1', internalDate: '1700000000000', payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Catching up' }, { name: 'From', value: 'mom@gmail.com' }], body: { data: b64url('Hi Pam,\n\nIt was so good to see you at the market on Saturday. I have been thinking about getting back to work now that things have settled down, maybe something in an office again.\n\nThanks so much,\nLinda') } } });
    }
    if (p === '/messages/att1') {
      return j({ id: 'att1', threadId: 't2', internalDate: '1700000000000', payload: { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: 'My resume' }], parts: [{ mimeType: 'text/plain', body: { data: b64url('Attached.') } }, { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'Linda Resume 2023.docx', body: { attachmentId: 'A1', size: 5000 } }] } });
    }
    if (p === '/messages/att1/attachments/A1') return j({ data: resumeDocxB64url });
    if (p === '/messages/send') {
      sent.push(Buffer.from(((await req.json()) as { raw: string }).raw, 'base64url').toString('utf8'));
      return j({ id: 'out1', threadId: 'thr-out1' });
    }
    if (p === '/messages/out1') return j({ id: 'out1', threadId: 'thr-out1', payload: { headers: [{ name: 'Message-ID', value: '<out1@mail.gmail.com>' }] } });
    return j({ error: `unmocked gmail ${p}` }, 404);
  }
  return new Response('blocked in test', { status: 503 }); // job boards etc.
}

let mf: Miniflare;

async function call(pathname: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  return mf.dispatchFetch(`${ORIGIN}${pathname}`, { ...init, headers, redirect: 'manual' } as never);
}

/** Click "Sign in with Google", then come back from Google with `code`. Returns where the app sends the browser. */
async function signIn(code: string, mode: 'owner' | 'helper' = 'owner'): Promise<URL> {
  const start = await call(`/api/auth/google?mode=${mode}`);
  expect(start.status).toBe(302);
  const google = new URL(start.headers.get('Location')!);
  expect(google.host).toBe('accounts.google.com');
  const back = await call(`/api/google/callback?code=${code}&state=${google.searchParams.get('state')}`);
  expect(back.status).toBe(302);
  return new URL(back.headers.get('Location')!);
}
function tokenFrom(loc: URL): string {
  return new URLSearchParams(loc.hash.split('?')[1]).get('token')!;
}

beforeAll(async () => {
  const out = path.resolve(__dirname, '../.test-bundle');
  execFileSync('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', out], { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' });
  resumeDocxB64url = (await markdownToDocxBase64('# Linda Example\nWhite Salmon, WA · (509) 555-0100\n\n## Experience\n### Office Manager — Gorge Family Dental · 2014–2024\n- Ran the front desk, scheduling, and billing for six providers\n- Trained nine new staff members over the years', 'resume'))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  mf = new Miniflare(convertV4MiniflareOptions({
    workers: [{
    name: 'next-chapter',
    modules: true,
    scriptPath: path.join(out, 'index.js'),
    compatibilityDate: '2025-09-01',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'test-db' },
    bindings: {
      ALLOWED_EMAILS: 'mom@gmail.com, kid@example.com',
      GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'secret',
      JWT_SECRET: 'test-jwt-secret-0123456789abcdef',
      TOKEN_ENC_KEY: 'test-enc-key-0123456789abcdef',
      MOCK_AI: '1',
      TIMEZONE: 'America/Los_Angeles',
    },
    outboundService: fakeInternet,
    }],
  } as never));
  const db = await mf.getD1Database('DB');
  const schema = readFileSync(path.resolve(__dirname, '../schema.sql'), 'utf8').replace(/--.*$/gm, '');
  for (const stmt of schema.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(stmt).run();
}, 120_000);

afterAll(async () => { await mf?.dispose(); });

describe('Sign in with Google', () => {
  it('turns away people who are not on the list, and gives their token back', async () => {
    const loc = await signIn('stranger');
    expect(loc.hash).toMatch(/^#\/login\?error=/);
    expect(decodeURIComponent(loc.hash)).toContain('stranger@example.com');
    expect(revoked).toContain('stranger-refresh');
  });

  it('signs her in even if she unticks the Gmail boxes, and says Gmail is missing', async () => {
    const loc = await signIn('mom-nogmail');
    expect(loc.hash).toContain('gmail=missing');
    const me = await (await call('/api/me', { token: tokenFrom(loc) })).json() as { is_owner: boolean; gmail: { connected: boolean } };
    expect(me.is_owner).toBe(true);
    expect(me.gmail.connected).toBe(false);
  });

  it('one sign-in connects her Gmail and fills her name and email', async () => {
    const loc = await signIn('mom-full');
    expect(loc.origin).toBe(ORIGIN);
    expect(loc.hash).toMatch(/^#\/auth\?token=/);
    expect(loc.hash).not.toContain('gmail=missing');
    const token = tokenFrom(loc);
    const me = await (await call('/api/me', { token })).json() as { is_owner: boolean; gmail: { connected: boolean; email: string }; onboarding: { done: boolean } };
    expect(me).toMatchObject({ is_owner: true, gmail: { connected: true, email: 'mom@gmail.com' }, onboarding: { done: false } });
    const prefs = await (await call('/api/prefs', { token })).json() as { name: string; email: string };
    expect(prefs).toMatchObject({ name: 'Linda Example', email: 'mom@gmail.com' });
  });

  it('then sets itself up from her Gmail: emails, old resume, voice, settings, first search', { timeout: 60_000 }, async () => {
    const token = tokenFrom(await signIn('mom-full'));
    const step = async (s: string) => (await (await call(`/api/onboard/${s}`, { method: 'POST', token })).json()) as { done: boolean; steps: Record<string, { ok: boolean; note: string }> };
    expect((await step('emails')).steps.emails).toMatchObject({ ok: true, note: 'Read 1 emails you’ve written' });
    expect((await step('documents')).steps.documents.note).toMatch(/Found 1 resume/);
    expect((await step('learn')).steps.learn.ok).toBe(true);
    const final = await step('search');
    expect(final.steps.search.ok).toBe(true);
    expect(final.done).toBe(true);

    const docs = await (await call('/api/documents', { token })).json() as { kind: string; title: string }[];
    expect(docs.map((d) => d.kind).sort()).toEqual(['email', 'resume']);
    const resume = docs.find((d) => d.kind === 'resume')!;
    expect(resume.title).toContain('Linda Resume 2023');
    const prefs = await (await call('/api/prefs', { token })).json() as { home_location: string; target_roles: string[]; phone: string };
    expect(prefs.home_location).toBe('White Salmon, WA');
    expect(prefs.target_roles.length).toBeGreaterThan(0);
  });

  it('helpers sign in with only their name and email — her Gmail stays connected', async () => {
    const loc = await signIn('helper', 'helper');
    const me = await (await call('/api/me', { token: tokenFrom(loc) })).json() as { is_owner: boolean; gmail: { email: string } };
    expect(me.is_owner).toBe(false);
    expect(me.gmail.email).toBe('mom@gmail.com');
  });

  it('a helper who clicks her button anyway has the Gmail access handed back', async () => {
    await signIn('helper-overgranted', 'owner');
    expect(revoked).toContain('kid-refresh');
    const token = tokenFrom(await signIn('helper', 'helper'));
    const me = await (await call('/api/me', { token })).json() as { gmail: { email: string } };
    expect(me.gmail.email).toBe('mom@gmail.com');
  });

  it('a helper cannot swap in their own Gmail from Settings', async () => {
    const token = tokenFrom(await signIn('helper', 'helper'));
    const { url } = await (await call('/api/google/start', { token })).json() as { url: string };
    const back = await call(`/api/google/callback?code=helper-overgranted&state=${new URL(url).searchParams.get('state')}`);
    expect(back.headers.get('Location')).toContain('gmail=error');
  });

  it('sends an application from her Gmail with the resume and cover letter attached', { timeout: 30_000 }, async () => {
    const token = tokenFrom(await signIn('mom-full'));
    const added = await (await call('/api/jobs', { method: 'POST', token, body: JSON.stringify({ text: 'Office Manager\nHood River Pediatrics needs an office manager for scheduling and billing. Send your resume to jobs@hrpeds.example.org.' }) })).json() as { id: number };
    const app = await (await call(`/api/jobs/${added.id}/prepare`, { method: 'POST', token, body: '{}' })).json() as { id: number };
    const res = await call(`/api/applications/${app.id}/send`, { method: 'POST', token });
    expect(res.status).toBe(200);
    const raw = sent.at(-1)!;
    expect(raw).toContain('To: jobs@hrpeds.example.org');
    expect(raw).toContain('From: Linda Example <mom@gmail.com>');
    expect(raw).toContain('filename="Linda_Example_Resume.docx"');
    expect(raw).toContain('filename="Linda_Example_Cover_Letter.docx"');
    const detail = await (await call(`/api/applications/${app.id}`, { token })).json() as { status: string; gmail_thread_id: string; rfc_message_id: string };
    expect(detail).toMatchObject({ status: 'submitted', gmail_thread_id: 'thr-out1', rfc_message_id: '<out1@mail.gmail.com>' });
  });

  it('rejects forged or missing sessions', async () => {
    expect((await call('/api/me')).status).toBe(401);
    expect((await call('/api/me', { token: 'x.y.z' })).status).toBe(401);
    const loc = await call('/api/google/callback?code=mom-full&state=forged');
    expect(loc.headers.get('Location')).toContain('login?error=');
  });
});
