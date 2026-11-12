// End-to-end: the real Worker bundle running in workerd (Miniflare), with Google's sign-in,
// userinfo, and Gmail endpoints faked by an outbound interceptor. Covers the whole
// "Sign in with Google → app sets itself up from Gmail → send an application" path.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { markdownToDocxBase64 } from '../src/lib/docx';
import { createHmac } from 'node:crypto';

const ORIGIN = 'https://nc.test';
const GMAIL = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';
const USERS: Record<string, { email: string; name: string; scope: string; refresh?: string }> = {
  'mom-full': { email: 'mom@gmail.com', name: 'Linda Example', scope: `openid email profile ${GMAIL}`, refresh: 'mom-refresh' },
  'mom-nogmail': { email: 'mom@gmail.com', name: 'Linda Example', scope: 'openid email profile' },
  'helper': { email: 'kid@example.com', name: 'Kid Example', scope: 'openid email profile' },
  'helper-overgranted': { email: 'kid@example.com', name: 'Kid Example', scope: `openid email profile ${GMAIL}`, refresh: 'kid-refresh' },
  'stranger': { email: 'stranger@example.com', name: 'Stranger Danger', scope: `openid email profile ${GMAIL}`, refresh: 'stranger-refresh' },
  'friend': { email: 'friend@example.com', name: 'Friend Ofmom', scope: `openid email profile ${GMAIL}`, refresh: 'friend-refresh' },
  'late': { email: 'late@example.com', name: 'Late Comer', scope: `openid email profile ${GMAIL}`, refresh: 'late-refresh' },
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
    if (p === '/messages' && q.includes('in:inbox')) return j({ messages: [{ id: 'me1', threadId: 't9' }] });
    if (p === '/messages/me1') {
      return j({ id: 'me1', threadId: 't9', internalDate: '1700000000000', payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Re: Your job search today — 3 new jobs to vote on' }, { name: 'From', value: 'Linda Example <mom@gmail.com>' }], body: { data: b64url('The cover letters are a bit long, please keep them shorter.\n\nOn Tue, Nov 10 Next Chapter wrote:\n> Good morning') } } });
    }
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
  if (url.host === 'jobs.closed.example') return new Response('Not found', { status: 404 });
  if (url.host === 'jobs.filled.example') return new Response('<h1>Sorry, this position has been filled.</h1>', { status: 200 });
  if (url.host === 'jobs.open.example') return new Response('<h1>Account Executive</h1><button>Apply now</button>', { status: 200 });
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
async function signIn(code: string, mode: 'owner' | 'helper' = 'owner', ref?: string): Promise<URL> {
  const start = await call(`/api/auth/google?mode=${mode}${ref ? `&ref=${ref}` : ''}`);
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
      ADMIN_EMAILS: 'kid@example.com',
      FREE_EMAILS: 'mom@gmail.com',
      MAX_USERS: '4',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
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
  it('anyone can sign up: a new paying account with its own empty workspace and a referral code', async () => {
    const loc = await signIn('stranger');
    expect(loc.hash).toMatch(/^#\/auth\?token=/);
    expect(loc.hash).toContain('new=1');
    const me = await (await call('/api/me', { token: tokenFrom(loc) })).json() as { user: { is_admin: boolean; referral_code: string }; workspace: { plan: string; balance_micro: number }; is_owner: boolean };
    expect(me.user.is_admin).toBe(false);
    expect(me.user.referral_code).toMatch(/^[A-Z2-9]{7}$/);
    expect(me.workspace).toMatchObject({ plan: 'paid', balance_micro: 0 });
    expect(me.is_owner).toBe(true);
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

  it('she invites a helper; the helper signs in with only their name and email and lands in her workspace', async () => {
    const momToken = tokenFrom(await signIn('mom-full'));
    const inv = await call('/api/helpers', { method: 'POST', token: momToken, body: JSON.stringify({ email: 'kid@example.com' }) });
    expect(inv.status).toBe(200);
    const loc = await signIn('helper', 'helper');
    const me = await (await call('/api/me', { token: tokenFrom(loc) })).json() as { is_owner: boolean; gmail: { email: string } };
    expect(me.is_owner).toBe(false);
    expect(me.gmail.email).toBe('mom@gmail.com');
  });

  it('a helper who signs in with the main button gets their own separate account — her Gmail stays hers', async () => {
    const own = tokenFrom(await signIn('helper-overgranted', 'owner'));
    const mine = await (await call('/api/me', { token: own })).json() as { is_owner: boolean; gmail: { email: string }; workspaces: { own: boolean }[] };
    expect(mine.is_owner).toBe(true);
    expect(mine.gmail.email).toBe('kid@example.com');
    expect(mine.workspaces.length).toBe(2); // their own + hers (as helper)
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
    // New accounts start in test mode: the first send goes to her own inbox, not the employer.
    let res = await call(`/api/applications/${app.id}/send`, { method: 'POST', token });
    expect(res.status).toBe(200);
    expect(sent.at(-1)!).toContain('To: mom@gmail.com');
    const subj = sent.at(-1)!.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)![1];
    expect(Buffer.from(subj, 'base64').toString('utf8')).toMatch(/^\[TEST — would go to jobs@hrpeds\.example\.org\]/);
    expect(((await (await call(`/api/applications/${app.id}`, { token })).json()) as { status: string }).status).toBe('ready');
    await call('/api/test-mode', { method: 'PUT', token, body: JSON.stringify({ on: false }) });
    res = await call(`/api/applications/${app.id}/send`, { method: 'POST', token });
    expect(res.status).toBe(200);
    const raw = sent.at(-1)!;
    expect(raw).toContain('To: jobs@hrpeds.example.org');
    expect(raw).toContain('From: Linda Example <mom@gmail.com>');
    expect(raw).toContain('filename="Linda_Example_Resume.pdf"');
    expect(raw).toContain('filename="Linda_Example_Cover_Letter.pdf"');
    const detail = await (await call(`/api/applications/${app.id}`, { token })).json() as { status: string; gmail_thread_id: string; rfc_message_id: string };
    expect(detail).toMatchObject({ status: 'submitted', gmail_thread_id: 'thr-out1', rfc_message_id: '<out1@mail.gmail.com>' });
  });

  it('the morning email lists jobs to vote on with one-tap buttons that open a confirm page', { timeout: 30_000 }, async () => {
    const token = tokenFrom(await signIn('mom-full'));
    const db = await mf.getD1Database('DB');
    for (const [title, company] of [['Account Executive', 'Acme SaaS'], ['SDR', 'Acme SaaS'], ['Customer Success Manager', 'Beta Cloud']]) {
      await db.prepare("INSERT INTO jobs (user_id, source, external_id, dedupe_key, title, company, work_mode, description, fit_score, fit_label, fit_summary, status) VALUES ((SELECT id FROM users WHERE email = 'mom@gmail.com'), 'test', ?, ?, ?, ?, 'remote', 'Sell software', 80, 'good', 'Good fit', 'new')")
        .bind(`${company}-${title}`, `${company}|${title}`, title, company).run();
    }
    const home = await (await call('/api/home', { token })).json() as { to_vote: { id: number; title: string }[] };
    expect(home.to_vote.map((j) => j.title)).toEqual(expect.arrayContaining(['Account Executive', 'SDR', 'Customer Success Manager']));

    const before = sent.length;
    const r = await (await call('/api/digest/send', { method: 'POST', token })).json() as { subject: string };
    expect(r.subject).toMatch(/to vote on/);
    const raw = sent.slice(before).join('');
    expect(raw).toContain('Content-Type: text/html');
    const html = Buffer.from(raw.split('Content-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString('utf8');
    expect(html).toContain('What I did for you');
    const cs = home.to_vote.find((j) => j.title === 'Customer Success Manager')!;
    const card = html.slice(html.indexOf('Customer Success Manager'));
    const upLink = card.match(/href="(https:\/\/nc\.test\/api\/q\?t=[^"]+)"/)![1].replace(/&amp;/g, '&');

    // Opening the link (or a mail scanner prefetching it) does NOT vote.
    const page = await call(new URL(upLink).pathname + new URL(upLink).search);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Customer Success Manager');
    expect((await db.prepare('SELECT vote FROM jobs WHERE id = ?').bind(cs.id).first<{ vote: number | null }>())!.vote).toBeNull();

    // Confirming does.
    const form = new URLSearchParams({ t: new URL(upLink).searchParams.get('t')!, reason: 'role', note: 'Love customer-facing work' });
    const done = await mf.dispatchFetch(`${ORIGIN}/api/q`, { method: 'POST', body: form, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } as never);
    expect(await done.text()).toContain('Thank you');
    const row = await db.prepare('SELECT vote, vote_reason, status FROM jobs WHERE id = ?').bind(cs.id).first<{ vote: number; vote_reason: string; status: string }>();
    expect(row).toMatchObject({ vote: 1, status: 'shortlisted' });
    expect(row!.vote_reason).toContain('Love customer-facing work');

    // A tampered link is refused.
    const bad = await call('/api/q?t=forged');
    expect(await bad.text()).toContain('expired');
  });

  it('👎 "this company" blocks the employer and clears its other jobs', async () => {
    const token = tokenFrom(await signIn('mom-full'));
    const home = await (await call('/api/home', { token })).json() as { to_vote: { id: number; title: string }[] };
    const ae = home.to_vote.find((j) => j.title === 'Account Executive')!;
    const r = await (await call(`/api/jobs/${ae.id}/vote`, { method: 'POST', token, body: JSON.stringify({ vote: -1, reason: 'company' }) })).json() as { blockedCompany: string };
    expect(r.blockedCompany).toBe('Acme SaaS');
    const prefs = await (await call('/api/prefs', { token })).json() as { exclude_companies: string[] };
    expect(prefs.exclude_companies).toContain('Acme SaaS');
    const after = await (await call('/api/home', { token })).json() as { to_vote: { title: string }[] };
    expect(after.to_vote.map((j) => j.title)).not.toContain('SDR'); // same company, gone too
  });

  it('feedback becomes lessons and settings changes, and it answers her', async () => {
    const token = tokenFrom(await signIn('mom-full'));
    const r = await (await call('/api/feedback', { method: 'POST', token, body: JSON.stringify({ sentiment: 'bad', about: 'job_search', text: 'Stop showing me jobs that are mostly cold calling' }) })).json() as { reply: string; changes: string[] };
    expect(r.reply.length).toBeGreaterThan(5);
    expect(r.changes.join(' ')).toContain('cold calling');
    const prefs = await (await call('/api/prefs', { token })).json() as { exclude_keywords: string[] };
    expect(prefs.exclude_keywords).toContain('cold calling');
    const l = await (await call('/api/lessons', { token })).json() as { lessons: { job_search: string[] } };
    expect(l.lessons.job_search.join(' ')).toContain('cold calling');
  });

  it('replying to the morning email is feedback too', async () => {
    const token = tokenFrom(await signIn('mom-full'));
    await call('/api/inbox/sync', { method: 'POST', token });
    const db = await mf.getD1Database('DB');
    const fb = await db.prepare("SELECT text, learned FROM feedback WHERE about = 'digest'").first<{ text: string; learned: number }>();
    expect(fb!.text).toBe('The cover letters are a bit long, please keep them shorter.');
    expect(fb!.learned).toBe(1);
  });

  it('a 👍 gets its application written on the next hourly run', { timeout: 30_000 }, async () => {
    const db = await mf.getD1Database('DB');
    const cs = await db.prepare("SELECT id FROM jobs WHERE title = 'Customer Success Manager'").first<{ id: number }>();
    expect(await db.prepare('SELECT 1 FROM applications WHERE job_id = ?').bind(cs!.id).first()).toBeNull();
    const worker = await mf.getWorker();
    await worker.scheduled({ cron: '0 * * * *' });
    // waitUntil work finishes shortly after
    for (let i = 0; i < 50 && !(await db.prepare('SELECT 1 FROM applications WHERE job_id = ?').bind(cs!.id).first()); i++) await new Promise((r) => setTimeout(r, 100));
    const app = await db.prepare("SELECT status FROM applications WHERE job_id = ?").bind(cs!.id).first<{ status: string }>();
    expect(app?.status).toBe('ready');
  });

  it('rejects forged or missing sessions', async () => {
    expect((await call('/api/me')).status).toBe(401);
    expect((await call('/api/me', { token: 'x.y.z' })).status).toBe(401);
    const loc = await call('/api/google/callback?code=mom-full&state=forged');
    expect(loc.headers.get('Location')).toContain('login?error=');
  });
});

describe('Accounts, billing, and referrals', () => {
  const pasted = (n: number) => JSON.stringify({ text: `Account Executive ${n}\nAcme SaaS is hiring an AE to sell our platform to small businesses. Apply at careers.acme.example.` });
  const db = () => mf.getD1Database('DB');
  const meOf = async (token: string) => (await (await call('/api/me', { token })).json()) as { user: { id: number; referral_code: string }; workspace: { id: number; balance_micro: number } };

  it('keeps every workspace private', async () => {
    const strangerToken = tokenFrom(await signIn('stranger'));
    const momJob = await (await db()).prepare("SELECT j.id FROM jobs j JOIN users u ON u.id = j.user_id WHERE u.email = 'mom@gmail.com' LIMIT 1").first<{ id: number }>();
    expect((await call(`/api/jobs/${momJob!.id}`, { token: strangerToken })).status).toBe(404);
    const list = await (await call('/api/jobs?status=all', { token: strangerToken })).json() as { jobs: unknown[] };
    expect(list.jobs).toHaveLength(0);
    const momId = (await (await db()).prepare("SELECT id FROM users WHERE email = 'mom@gmail.com'").first<{ id: number }>())!.id;
    expect((await call('/api/workspace', { method: 'POST', token: strangerToken, body: JSON.stringify({ id: momId }) })).status).toBe(403);
  });

  it('a paying account with no credit is stopped before any AI cost', async () => {
    const token = tokenFrom(await signIn('stranger'));
    const before = (await (await db()).prepare('SELECT COUNT(*) AS n FROM usage_events').first<{ n: number }>())!.n;
    const r = await call('/api/jobs', { method: 'POST', token, body: pasted(1) });
    expect(r.status).toBe(402);
    expect(((await r.json()) as { billing: string }).billing).toBe('no_credit');
    expect((await (await db()).prepare('SELECT COUNT(*) AS n FROM usage_events').first<{ n: number }>())!.n).toBe(before);
  });

  it('buying credit through Stripe adds it once (signed, idempotent webhook)', async () => {
    const token = tokenFrom(await signIn('stranger'));
    const me = await meOf(token);
    await (await db()).prepare("INSERT INTO credit_purchases (user_id, stripe_session_id, amount_micro, status) VALUES (?, 'cs_test_1', 10000000, 'pending')").bind(me.user.id).run();
    const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', metadata: { purpose: 'credit', user_id: String(me.user.id) }, payment_status: 'paid', payment_intent: 'pi_1', customer: 'cus_1' } } });
    const sign = (body: string, secret = 'whsec_test') => {
      const t = Math.floor(Date.now() / 1000);
      return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
    };
    const post = (sig: string) => mf.dispatchFetch(`${ORIGIN}/api/webhook/stripe`, { method: 'POST', body: payload, headers: { 'Stripe-Signature': sig } } as never);
    expect((await post(sign(payload, 'wrong'))).status).toBe(400);
    expect((await post(sign(payload))).status).toBe(200);
    expect((await post(sign(payload))).status).toBe(200); // Stripe retries
    expect((await meOf(token)).workspace.balance_micro).toBe(10_000_000);
  });

  it('customers pay 2× the AI cost; whoever referred them earns half the profit', async () => {
    const momToken = tokenFrom(await signIn('mom-full'));
    const momCode = (await meOf(momToken)).user.referral_code;
    const friendToken = tokenFrom(await signIn('friend', 'owner', momCode));
    const friend = await meOf(friendToken);
    const row = await (await db()).prepare("SELECT u.referred_by, m.email FROM users u JOIN users m ON m.id = u.referred_by WHERE u.id = ?").bind(friend.user.id).first<{ email: string }>();
    expect(row!.email).toBe('mom@gmail.com');

    // An admin adds $5 so the friend can use the app.
    const adminToken = tokenFrom(await signIn('helper', 'helper'));
    const adj = await call(`/api/admin/users/${friend.user.id}`, { method: 'PATCH', token: adminToken, body: JSON.stringify({ credit_usd: 5 }) });
    expect(adj.status).toBe(200);
    expect((await call(`/api/admin/users/${friend.user.id}`, { method: 'PATCH', token: friendToken, body: JSON.stringify({ credit_usd: 500 }) })).status).toBe(403);

    expect((await call('/api/jobs', { method: 'POST', token: friendToken, body: pasted(2) })).status).toBe(200);
    const ev = await (await db()).prepare('SELECT SUM(cost_micro) AS cost, SUM(charge_micro) AS charge FROM usage_events WHERE user_id = ?').bind(friend.user.id).first<{ cost: number; charge: number }>();
    expect(ev!.cost).toBeGreaterThan(0);
    expect(ev!.charge).toBe(ev!.cost * 2);
    expect((await meOf(friendToken)).workspace.balance_micro).toBe(5_000_000 - ev!.charge);
    const earned = await (await db()).prepare('SELECT SUM(amount_micro) AS n FROM referral_earnings WHERE referred_id = ?').bind(friend.user.id).first<{ n: number }>();
    expect(earned!.n).toBe(Math.floor((ev!.charge - ev!.cost) * 0.5));
    const refs = await (await call('/api/referrals', { token: momToken })).json() as { referrals: number; pending: number; link: string };
    expect(refs.referrals).toBe(1);
    expect(refs.pending).toBe(earned!.n);
    expect(refs.link).toContain(`?ref=${momCode}`);
  });

  it('organic sign-ups and the comped account produce no referral earnings; comped usage is free to her', async () => {
    const strangerId = (await (await db()).prepare("SELECT id FROM users WHERE email = 'stranger@example.com'").first<{ id: number }>())!.id;
    expect((await (await db()).prepare('SELECT COUNT(*) AS n FROM referral_earnings WHERE referred_id = ?').bind(strangerId).first<{ n: number }>())!.n).toBe(0);
    const mom = await (await db()).prepare("SELECT id, balance_micro FROM users WHERE email = 'mom@gmail.com'").first<{ id: number; balance_micro: number }>();
    const momUse = await (await db()).prepare('SELECT SUM(cost_micro) AS cost, SUM(charge_micro) AS charge FROM usage_events WHERE user_id = ?').bind(mom!.id).first<{ cost: number; charge: number }>();
    expect(momUse!.cost).toBeGreaterThan(0);
    expect(momUse!.charge).toBe(0);
    expect(mom!.balance_micro).toBe(0);
  });

  it('a comped account can’t lift the limit the business set for it', async () => {
    const momToken = tokenFrom(await signIn('mom-full'));
    expect((await call('/api/billing/cap', { method: 'PUT', token: momToken, body: JSON.stringify({ cap_usd: null }) })).status).toBe(403);
  });

  it('a monthly spending limit pauses AI work', async () => {
    const token = tokenFrom(await signIn('friend'));
    await call('/api/billing/cap', { method: 'PUT', token, body: JSON.stringify({ cap_usd: 0.000001 }) });
    const r = await call('/api/jobs', { method: 'POST', token, body: pasted(3) });
    expect(r.status).toBe(402);
    expect(((await r.json()) as { billing: string }).billing).toBe('cap');
    await call('/api/billing/cap', { method: 'PUT', token, body: JSON.stringify({ cap_usd: null }) });
  });

  it('the business-wide AI cap stops everyone, including comped accounts', async () => {
    const adminToken = tokenFrom(await signIn('helper', 'helper'));
    await call('/api/admin/global-cap', { method: 'PUT', token: adminToken, body: JSON.stringify({ usd: 0.000001 }) });
    const momToken = tokenFrom(await signIn('mom-full'));
    const r = await call('/api/jobs', { method: 'POST', token: momToken, body: pasted(4) });
    expect(r.status).toBe(402);
    expect(((await r.json()) as { billing: string }).billing).toBe('global_cap');
    await call('/api/admin/global-cap', { method: 'PUT', token: adminToken, body: JSON.stringify({ usd: null }) });
    expect((await call('/api/jobs', { method: 'POST', token: momToken, body: pasted(5) })).status).toBe(200);
  });

  it('admins see revenue, cost, profit and referral totals; customers can’t', async () => {
    const adminToken = tokenFrom(await signIn('helper', 'helper'));
    const o = await (await call('/api/admin/overview', { token: adminToken })).json() as { month: { usage_charged: number; ai_cost: number; referral_earned: number; profit: number }; users: number };
    expect(o.month.profit).toBe(o.month.usage_charged - o.month.ai_cost - o.month.referral_earned);
    expect(o.users).toBeGreaterThanOrEqual(4);
    expect((await call('/api/admin/overview', { token: tokenFrom(await signIn('stranger')) })).status).toBe(403);
  });

  it('past the beta cap, new sign-ups go on the waitlist', async () => {
    const loc = await signIn('late');
    expect(loc.hash).toBe('#/waitlist');
    expect(revoked).toContain('late-refresh');
  });
});

describe('Onboarding questions and career tools', () => {
  const db = () => mf.getD1Database('DB');
  let token = '';
  let appId = 0;
  let jobId = 0;
  beforeAll(async () => {
    token = tokenFrom(await signIn('mom-full'));
    const added = await (await call('/api/jobs', { method: 'POST', token, body: JSON.stringify({ url: 'https://jobs.open.example/ae', text: 'Account Executive\nBrightwave sells scheduling software to dental offices. We want a customer-obsessed AE. Email resumes to hiring@brightwave.example.' }) })).json() as { id: number };
    jobId = added.id;
    appId = ((await (await call(`/api/jobs/${jobId}/prepare`, { method: 'POST', token, body: '{}' })).json()) as { id: number }).id;
  }, 60_000);

  it('her questionnaire answers become her search settings', async () => {
    const r = await call('/api/profile-answers', { method: 'PUT', token, body: JSON.stringify({
      desired_roles: ['Account Executive', 'Customer Success Manager'], industries: ['SaaS', 'healthcare tech'], work_arrangement: ['remote'],
      location: 'White Salmon, WA', radius_miles: 25, base_min: 55000, ote_min: 90000, schedule: 'Full-time', dealbreakers: 'No cold calling all day',
      skills: ['Scheduling', 'Billing'], why_change: 'I was the customer for ten years', followups: [{ question: 'What did you do in 2024?', answer: 'Cared for my father.' }],
    }) });
    expect(r.status).toBe(200);
    const prefs = await (await call('/api/prefs', { token })).json() as { target_roles: string[]; want_remote: boolean; want_local: boolean; min_salary: number; radius_miles: number; wishes: string; industry_focus: string };
    expect(prefs.target_roles).toEqual(['Account Executive', 'Customer Success Manager']);
    expect(prefs).toMatchObject({ want_remote: true, want_local: false, min_salary: 55000, radius_miles: 25 });
    expect(prefs.wishes).toContain('No cold calling');
    expect(prefs.industry_focus).toContain('SaaS');
    const back = await (await call('/api/profile-answers', { token })).json() as { answers: { followups: unknown[] }; followup_questions: string[] };
    expect(back.answers.followups).toHaveLength(1);
    expect(Array.isArray(back.followup_questions)).toBe(true);
  });

  it('writes her career-change story and LinkedIn profile', async () => {
    const s = await (await call('/api/story/generate', { method: 'POST', token })).json() as { linkedin_headline: string; transferable_skills: unknown[] };
    expect(s.linkedin_headline.length).toBeGreaterThan(5);
    expect(s.transferable_skills.length).toBeGreaterThan(0);
    expect(((await (await call('/api/story', { token })).json()) as { generated_at: string }).generated_at).toBeTruthy();
  });

  it('interview prep sheet, then a thank-you note waiting for her OK', async () => {
    const iv = await (await call(`/api/applications/${appId}/interviews`, { method: 'POST', token, body: JSON.stringify({ kind: 'Phone screen', interviewers: 'Sam (recruiter)' }) })).json() as { id: number; prep_md: string };
    expect(iv.prep_md).toContain('# Interview prep');
    expect(iv.prep_md).toContain('Questions to ask them');
    const app = await (await call(`/api/applications/${appId}`, { token })).json() as { status: string };
    expect(app.status).toBe('interviewing');
    expect((await call(`/api/interviews/${iv.id}/done`, { method: 'POST', token, body: JSON.stringify({ notes: 'Loved hearing about their dental customers', emails: 'sam@brightwave.example' }) })).status).toBe(200);
    const ty = await (await db()).prepare("SELECT to_email, status FROM outbox WHERE kind = 'thank_you' AND application_id = ?").bind(appId).first<{ to_email: string; status: string }>();
    expect(ty).toMatchObject({ to_email: 'sam@brightwave.example', status: 'pending' });
  });

  it('a practice cold call with a scorecard at the end', async () => {
    const s = await (await call('/api/practice', { method: 'POST', token, body: JSON.stringify({ scenario: 'cold_call' }) })).json() as { id: number; messages: { role: string }[] };
    expect(s.messages[0].role).toBe('assistant');
    for (const text of ['Hi Dana, this is Linda from Brightwave — did I catch you at a bad time?', 'How do you handle appointment no-shows today?']) {
      const r = await (await call(`/api/practice/${s.id}/message`, { method: 'POST', token, body: JSON.stringify({ text }) })).json() as { reply: string };
      expect(r.reply.length).toBeGreaterThan(3);
    }
    const card = await (await call(`/api/practice/${s.id}/finish`, { method: 'POST', token })).json() as { overall: number; better_lines: unknown[] };
    expect(card.overall).toBeGreaterThanOrEqual(1);
    expect(card.better_lines.length).toBeGreaterThan(0);
  });

  it('finds people to reach out to, checks out the company, and knows if a posting closed', async () => {
    const o = await (await call(`/api/jobs/${jobId}/outreach`, { method: 'POST', token })).json() as { people: { linkedin_note: string }[] };
    expect(o.people[0].linkedin_note.length).toBeLessThanOrEqual(300);
    const rep = await (await call(`/api/jobs/${jobId}/research`, { method: 'POST', token })).json() as { verdict: string };
    expect(['good', 'mixed', 'caution']).toContain(rep.verdict);
    expect(((await (await call(`/api/jobs/${jobId}/check-open`, { method: 'POST', token })).json()) as { still_open: boolean }).still_open).toBe(true);
    const mom = (await (await db()).prepare("SELECT id FROM users WHERE email = 'mom@gmail.com'").first<{ id: number }>())!.id;
    for (const [host, expected] of [['jobs.closed.example', false], ['jobs.filled.example', false]] as const) {
      const r = await (await db()).prepare("INSERT INTO jobs (user_id, source, external_id, dedupe_key, url, title, company, description) VALUES (?, 'test', ?, ?, ?, 'SDR', 'X', 'x') RETURNING id").bind(mom, host, host, `https://${host}/job`).first<{ id: number }>();
      expect(((await (await call(`/api/jobs/${r!.id}/check-open`, { method: 'POST', token })).json()) as { still_open: boolean }).still_open).toBe(expected);
    }
  });

  it('reviews an offer and drafts a negotiation email that waits for her', async () => {
    const r = await call(`/api/applications/${appId}/offer`, { method: 'POST', token, body: JSON.stringify({ details: 'Base $60,000, OTE $95,000, 10% uncapped commission, health + 401k, start Dec 1.' }) });
    expect(r.status).toBe(200);
    const n = await (await db()).prepare("SELECT status FROM outbox WHERE kind = 'negotiation' AND application_id = ?").bind(appId).first<{ status: string }>();
    expect(n!.status).toBe('pending');
  });

  it('the browser helper works with its own key, and only on her account', async () => {
    const { key } = await (await call('/api/ext-key', { method: 'POST', token })).json() as { key: string };
    const ext = (path: string, init: RequestInit = {}) => mf.dispatchFetch(`${ORIGIN}${path}`, { ...init, headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' } } as never);
    expect((await mf.dispatchFetch(`${ORIGIN}/api/ext/profile`, { headers: { 'X-Api-Key': 'nc_wrong' } } as never)).status).toBe(401);
    const profile = await (await ext('/api/ext/profile')).json() as { first_name: string; email: string };
    expect(profile).toMatchObject({ first_name: 'Linda', email: 'mom@gmail.com' });
    // It lists applications that still need a form filled (this one already has an offer, so it's left out).
    const fresh = await (await call('/api/jobs', { method: 'POST', token, body: JSON.stringify({ text: 'Sales Development Representative\nCloudnest is hiring SDRs to book meetings with IT leaders. Apply on our careers site.' }) })).json() as { id: number };
    const freshApp = ((await (await call(`/api/jobs/${fresh.id}/prepare`, { method: 'POST', token, body: '{}' })).json()) as { id: number }).id;
    const apps = await (await ext('/api/ext/applications')).json() as { applications: { id: number }[] };
    expect(apps.applications.map((a) => a.id)).toContain(freshApp);
    expect(apps.applications.map((a) => a.id)).not.toContain(appId);
    const files = await (await ext(`/api/ext/applications/${appId}/files`)).json() as { resume: { mime: string; base64: string } };
    expect(files.resume.mime).toBe('application/pdf');
    expect(Buffer.from(files.resume.base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    const ans = await (await ext('/api/ext/answer', { method: 'POST', body: JSON.stringify({ application_id: appId, question: 'Why Brightwave?', max_chars: 120 }) })).json() as { answer: string };
    expect(ans.answer.length).toBeLessThanOrEqual(120);
    const strangerApp = await (await db()).prepare("SELECT a.id FROM applications a JOIN users u ON u.id = a.user_id WHERE u.email != 'mom@gmail.com' LIMIT 1").first<{ id: number }>();
    if (strangerApp) expect((await ext(`/api/ext/applications/${strangerApp.id}/files`)).status).not.toBe(200);
  });
});
