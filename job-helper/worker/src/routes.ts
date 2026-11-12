import type { Env } from './env';
import { body, dispatch, error, HttpError, json, type Route } from './lib/http';
import { signJwt, verifyJwt, type JwtPayload } from './lib/auth';
import { addEvent, getPrefs, getSetting, getVoice, logActivity, setSetting, type AppRow, type JobRow, type OutboxRow } from './lib/db';
import { mergePrefs, type Prefs } from './lib/prefs';
import { aiConfigured, aiJSON } from './lib/ai';
import { EXTRACT_JOB_INSTRUCTIONS, EXTRACT_JOB_SCHEMA, type ExtractJobResult } from './lib/prompts';
import {
  allowedEmails, authUrl, disconnectGmail, exchangeCode, gmailStatus, googleConfigured, ownerEmail, revokeToken, storeGmail, type AuthMode,
} from './lib/gmail';
import { docFilename, DOCX_MIME, markdownToDocxBase64 } from './lib/docx';
import { extractApplicationEmail, htmlToText } from './lib/text';
import {
  afterContact, extractPdfText, getOnboarding, importGmailDocuments, importSentEmails, ingestJobs, learnVoice, ONBOARD_STEPS, prepareApplication,
  processFollowUps, queueApplication, runOnboardStep, runSearch, scoreJob, sendOutboxItem, syncInbox, type OnboardStep,
} from './pipeline';

const DOC_KINDS = ['resume', 'cover_letter', 'email', 'writing_sample', 'reference', 'other'];
const APP_STATUSES = ['drafting', 'ready', 'submitted', 'following_up', 'interviewing', 'offer', 'won', 'rejected', 'closed', 'withdrawn'];

function int(v: string): number {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) throw new HttpError(400, 'Bad id');
  return n;
}

function str(v: unknown, max = 100_000): string | undefined {
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

/** When she edits an AI draft, remember the change — that's how the app learns her voice over time. */
async function rememberEdit(env: Env, kind: string, before: string | null, after: string | undefined): Promise<void> {
  if (!before || after === undefined || before === after) return;
  if (Math.abs(before.length - after.length) < 15 && before.replace(/\s+/g, ' ') === after.replace(/\s+/g, ' ')) return;
  await env.DB.prepare('INSERT INTO voice_examples (kind, before_text, after_text) VALUES (?, ?, ?)').bind(kind, before.slice(0, 20000), after.slice(0, 20000)).run();
  await env.DB.prepare('DELETE FROM voice_examples WHERE id NOT IN (SELECT id FROM voice_examples ORDER BY id DESC LIMIT 40)').run();
}

async function loadApp(env: Env, id: number) {
  const app = await env.DB.prepare('SELECT * FROM applications WHERE id = ?').bind(id).first<AppRow>();
  if (!app) throw new HttpError(404, 'Application not found');
  return app;
}

// ---------------------------------------------------------------- public routes

const DAY = 60 * 60 * 24;

function frontUrl(env: Env, request: Request): string {
  return (env.FRONTEND_URL || new URL(request.url).origin).replace(/\/$/, '');
}

async function upsertUser(env: Env, email: string, name: string): Promise<{ id: number; email: string; name: string }> {
  const row = await env.DB.prepare(
    `INSERT INTO users (email, name, last_login_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(email) DO UPDATE SET name = CASE WHEN excluded.name != '' THEN excluded.name ELSE users.name END, last_login_at = datetime('now')
     RETURNING id, email, name`,
  ).bind(email, name || email.split('@')[0]).first<{ id: number; email: string; name: string }>();
  return row!;
}

/** First time she signs in, use her Google name and address as her application contact details. */
async function fillPrefsFromGoogle(env: Env, name: string, email: string): Promise<void> {
  const prefs = await getPrefs(env);
  if (prefs.name && prefs.email) return;
  await setSetting(env, 'prefs', { ...prefs, name: prefs.name || name, email: prefs.email || email });
}

export async function publicRoutes(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path === '/api/health') return json({ ok: true });

  if (path === '/api/auth/config' && request.method === 'GET') {
    return json({ google: googleConfigured(env), dev_login: env.DEV_LOGIN === '1', ready: allowedEmails(env).length > 0 || env.DEV_LOGIN === '1' });
  }

  // "Sign in with Google" — a plain link; the browser is redirected to Google's consent screen.
  if (path === '/api/auth/google' && request.method === 'GET') {
    const front = frontUrl(env, request);
    if (!googleConfigured(env)) return Response.redirect(`${front}/#/login?error=${encodeURIComponent('Google sign-in isn’t set up yet (run npm run setup).')}`, 302);
    const mode: AuthMode = new URL(request.url).searchParams.get('mode') === 'helper' ? 'helper' : 'owner';
    const state = await signJwt(env, { sub: 0, email: '', name: '', purpose: `login_${mode}` }, 600);
    return Response.redirect(authUrl(env, new URL(request.url).origin, state, mode), 302);
  }

  // Local development only: sign in by email without Google.
  if (path === '/api/auth/dev' && request.method === 'POST' && env.DEV_LOGIN === '1') {
    const b = await body<{ email?: string }>(request);
    const email = (b.email ?? '').trim().toLowerCase();
    const allowed = allowedEmails(env);
    if (!email || (allowed.length && !allowed.includes(email))) return error('Not on the guest list', 403);
    const u = await upsertUser(env, email, email.split('@')[0]);
    return json({ token: await signJwt(env, { sub: u.id, email: u.email, name: u.name }, 30 * DAY) });
  }

  if (path === '/api/google/callback' && request.method === 'GET') {
    const url = new URL(request.url);
    const front = frontUrl(env, request);
    const go = (hash: string) => Response.redirect(`${front}/#/${hash}`, 302);
    const state = await verifyJwt(env, url.searchParams.get('state') ?? '');
    const purpose = state?.purpose ?? '';
    const isConnect = purpose === 'connect';
    const fail = (msg: string) => go(isConnect ? `settings?gmail=error&reason=${encodeURIComponent(msg)}` : `login?error=${encodeURIComponent(msg)}`);
    if (!state || !['login_owner', 'login_helper', 'connect'].includes(purpose)) return fail('That sign-in link expired. Please try again.');
    if (url.searchParams.get('error')) return fail(url.searchParams.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : `Google said: ${url.searchParams.get('error')}`);

    try {
      const login = await exchangeCode(env, url.origin, url.searchParams.get('code') ?? '');
      const giveBack = () => revokeToken(login.tokens.refresh_token ?? login.tokens.access_token);
      const allowed = allowedEmails(env);
      if (!allowed.length) {
        await giveBack();
        return fail('The app isn’t finished setting up (no ALLOWED_EMAILS). Ask whoever installed it to run npm run setup.');
      }
      if (!login.verified || !allowed.includes(login.email)) {
        await giveBack();
        await logActivity(env, 'login_failed', login.email);
        return fail(`${login.email} isn’t on this app’s list of people who can sign in.`);
      }
      const isOwner = login.email === ownerEmail(env);

      if (isConnect) {
        if (!isOwner) {
          await giveBack();
          return fail(`Please connect ${ownerEmail(env)}’s Gmail — that’s the address applications are sent from.`);
        }
        if (!(await storeGmail(env, login))) return fail('Google didn’t give permission to send and read email. Please try again and leave both boxes ticked.');
        await logActivity(env, 'gmail', `Connected Gmail ${login.email}`);
        return go('settings?gmail=connected');
      }

      const user = await upsertUser(env, login.email, login.name);
      let gmailOk = true;
      if (isOwner) {
        gmailOk = (await storeGmail(env, login)) || (await gmailStatus(env)).connected;
        await fillPrefsFromGoogle(env, login.name, login.email);
        if (gmailOk) await logActivity(env, 'gmail', `Signed in and connected Gmail ${login.email}`);
      } else if (login.tokens.refresh_token || login.gmailGranted) {
        await giveBack(); // a helper's own mailbox is never used
      }
      await setSetting(env, 'app_url', front);
      const token = await signJwt(env, { sub: user.id, email: user.email, name: user.name }, 30 * DAY);
      return go(`auth?token=${encodeURIComponent(token)}${gmailOk ? '' : '&gmail=missing'}`);
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'Sign-in failed');
    }
  }
  return null;
}

// ---------------------------------------------------------------- authenticated routes

export async function privateRoutes(request: Request, env: Env, path: string, user: JwtPayload): Promise<Response | null> {
  const routes: Route[] = [
    ['GET', '/api/me', async () => json({
      user: { id: user.sub, email: user.email, name: user.name },
      is_owner: user.email === ownerEmail(env),
      owner_email: ownerEmail(env),
      gmail: await gmailStatus(env),
      onboarding: await getOnboarding(env),
    })],
    ['POST', '/api/onboard/:step', async (_r, p) => {
      if (!(ONBOARD_STEPS as readonly string[]).includes(p.step)) return error('Unknown step', 404);
      return json(await runOnboardStep(env, p.step as OnboardStep));
    }],
    ['POST', '/api/onboard-skip', async () => {
      await setSetting(env, 'onboarding', { ...(await getOnboarding(env)), done: true });
      return json({ ok: true });
    }],

    // ---- overview
    ['GET', '/api/home', async () => {
      const q = (sql: string) => env.DB.prepare(sql).all().then((r) => r.results);
      const [counts, waiting, ready, matches, replies, upcoming, lastSearch] = await Promise.all([
        q('SELECT status, COUNT(*) AS n FROM applications GROUP BY status'),
        q(`SELECT o.*, j.title, j.company FROM outbox o LEFT JOIN applications a ON a.id = o.application_id LEFT JOIN jobs j ON j.id = a.job_id
           WHERE o.status IN ('pending','failed') ORDER BY o.id DESC LIMIT 20`),
        q(`SELECT a.id, a.apply_method, a.ai_notes, a.updated_at, j.title, j.company, j.fit_score, j.location, j.work_mode FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.status = 'ready' ORDER BY j.fit_score DESC LIMIT 20`),
        q(`SELECT id, title, company, location, work_mode, salary, fit_score, fit_label, fit_summary, found_at FROM jobs WHERE status = 'new' AND fit_score >= 70 ORDER BY fit_score DESC, found_at DESC LIMIT 8`),
        q(`SELECT e.*, j.title, j.company FROM app_events e JOIN applications a ON a.id = e.application_id JOIN jobs j ON j.id = a.job_id WHERE e.type IN ('reply','status') ORDER BY e.id DESC LIMIT 8`),
        q(`SELECT a.id, a.status, a.last_contact_at, a.submitted_at, a.follow_up_count, j.title, j.company FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.status IN ('submitted','following_up','interviewing','offer') ORDER BY a.updated_at DESC LIMIT 20`),
        getSetting(env, 'last_search'),
      ]);
      return json({ counts, waiting, ready, matches, replies, active: upcoming, last_search: lastSearch, prefs: await getPrefs(env) });
    }],
    ['GET', '/api/status', async () => {
      const voice = await getVoice(env);
      const docs = await env.DB.prepare('SELECT COUNT(*) AS n FROM documents').first<{ n: number }>();
      return json({
        ai: aiConfigured(env), mock_ai: env.MOCK_AI === '1', model: env.AI_MODEL || 'claude-opus-5-5',
        gmail: await gmailStatus(env),
        sources: { adzuna: !!env.ADZUNA_APP_ID && !!env.ADZUNA_APP_KEY, usajobs: !!env.USAJOBS_API_KEY && !!env.USAJOBS_EMAIL },
        documents: docs?.n ?? 0, voice_learned_at: voice.learned_at, has_career_record: !!voice.career_record,
        last_search: await getSetting(env, 'last_search'),
      });
    }],
    ['GET', '/api/activity', async () => json((await env.DB.prepare('SELECT * FROM activity_log WHERE kind != ? ORDER BY id DESC LIMIT 100').bind('login_failed').all()).results)],

    // ---- preferences
    ['GET', '/api/prefs', async () => json(await getPrefs(env))],
    ['PUT', '/api/prefs', async (req) => {
      const b = await body<Partial<Prefs>>(req);
      const merged = mergePrefs({ ...(await getPrefs(env)), ...b, sources: { ...(await getPrefs(env)).sources, ...(b.sources ?? {}) }, autopilot: { ...(await getPrefs(env)).autopilot, ...(b.autopilot ?? {}) } });
      merged.autopilot.follow_up_days = merged.autopilot.follow_up_days.map(Number).filter((n) => n > 0 && n < 90).slice(0, 4);
      merged.radius_miles = Math.max(1, Math.min(200, Number(merged.radius_miles) || 30));
      await setSetting(env, 'prefs', merged);
      return json(merged);
    }],

    // ---- documents + voice
    ['GET', '/api/documents', async () => json((await env.DB.prepare('SELECT id, kind, title, filename, use_for_voice, created_at, length(content) AS chars, substr(content, 1, 300) AS preview FROM documents ORDER BY created_at DESC').all()).results)],
    ['GET', '/api/documents/:id', async (_r, p) => {
      const d = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(int(p.id)).first();
      return d ? json(d) : error('Not found', 404);
    }],
    ['POST', '/api/documents', async (req) => {
      const b = await body<{ kind?: string; title?: string; content?: string; filename?: string; pdf_base64?: string; use_for_voice?: boolean }>(req);
      const kind = DOC_KINDS.includes(b.kind ?? '') ? b.kind! : 'other';
      let content = str(b.content, 200_000) ?? '';
      if (b.pdf_base64) {
        if (b.pdf_base64.length > 14_000_000) return error('That PDF is too big (10 MB max).');
        content = await extractPdfText(env, b.pdf_base64);
      }
      content = content.trim();
      if (!content) return error('The document is empty.');
      const res = await env.DB.prepare('INSERT INTO documents (kind, title, content, filename, use_for_voice) VALUES (?, ?, ?, ?, ?)')
        .bind(kind, (str(b.title, 200) || b.filename || 'Untitled').trim(), content, str(b.filename, 200) ?? null, b.use_for_voice === false ? 0 : 1).run();
      return json({ id: res.meta.last_row_id, chars: content.length });
    }],
    ['PATCH', '/api/documents/:id', async (req, p) => {
      const b = await body<{ title?: string; kind?: string; content?: string; use_for_voice?: boolean }>(req);
      await env.DB.prepare('UPDATE documents SET title = COALESCE(?, title), kind = COALESCE(?, kind), content = COALESCE(?, content), use_for_voice = COALESCE(?, use_for_voice) WHERE id = ?')
        .bind(str(b.title, 200) ?? null, DOC_KINDS.includes(b.kind ?? '') ? b.kind : null, str(b.content, 200_000) ?? null, b.use_for_voice === undefined ? null : b.use_for_voice ? 1 : 0, int(p.id)).run();
      return json({ ok: true });
    }],
    ['DELETE', '/api/documents/:id', async (_r, p) => {
      await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(int(p.id)).run();
      return json({ ok: true });
    }],
    ['GET', '/api/voice', async () => {
      const examples = await env.DB.prepare('SELECT COUNT(*) AS n FROM voice_examples').first<{ n: number }>();
      return json({ ...(await getVoice(env)), edits_learned: examples?.n ?? 0 });
    }],
    ['PUT', '/api/voice', async (req) => {
      const b = await body<{ voice_guide?: string; career_record?: string }>(req);
      const v = await getVoice(env);
      await setSetting(env, 'voice', { ...v, voice_guide: str(b.voice_guide) ?? v.voice_guide, career_record: str(b.career_record) ?? v.career_record });
      return json({ ok: true });
    }],
    ['POST', '/api/voice/learn', async () => json(await learnVoice(env))],
    ['POST', '/api/voice/import-gmail', async () => {
      const emails = await importSentEmails(env);
      const documents = await importGmailDocuments(env);
      return json({ imported: emails + documents, emails, documents });
    }],

    // ---- jobs
    ['GET', '/api/jobs', async (req) => {
      const u = new URL(req.url);
      const status = u.searchParams.get('status') ?? 'new';
      const min = parseInt(u.searchParams.get('min') ?? '0', 10) || 0;
      const mode = u.searchParams.get('mode') ?? '';
      const q = (u.searchParams.get('q') ?? '').trim();
      const where = ['1=1'];
      const args: unknown[] = [];
      if (status !== 'all') { where.push('j.status = ?'); args.push(status); }
      if (min) { where.push('COALESCE(j.fit_score, 0) >= ?'); args.push(min); }
      if (mode === 'remote') where.push("j.work_mode = 'remote'");
      if (mode === 'local') where.push("j.work_mode IN ('onsite','hybrid')");
      if (q) { where.push('(j.title LIKE ? OR j.company LIKE ? OR j.location LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
      const { results } = await env.DB.prepare(
        `SELECT j.id, j.source, j.title, j.company, j.location, j.work_mode, j.salary, j.posted_at, j.found_at, j.fit_score, j.fit_label, j.fit_summary, j.status, j.url,
           (SELECT a.id FROM applications a WHERE a.job_id = j.id ORDER BY a.id DESC LIMIT 1) AS application_id
         FROM jobs j WHERE ${where.join(' AND ')} ORDER BY j.fit_score IS NULL, j.fit_score DESC, j.found_at DESC LIMIT 200`,
      ).bind(...args).all();
      const totals = (await env.DB.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all()).results;
      return json({ jobs: results, totals });
    }],
    ['GET', '/api/jobs/:id', async (_r, p) => {
      const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(int(p.id)).first<JobRow>();
      if (!job) return error('Not found', 404);
      const app = await env.DB.prepare('SELECT id, status FROM applications WHERE job_id = ? ORDER BY id DESC LIMIT 1').bind(job.id).first();
      return json({ ...job, fit: job.fit_json ? JSON.parse(job.fit_json) : null, application: app });
    }],
    ['POST', '/api/jobs', async (req) => {
      const b = await body<{ text?: string; url?: string }>(req);
      const text = htmlToText(str(b.text, 60_000) ?? '');
      if (text.length < 80) return error('Paste the full job posting text (title, duties, requirements).');
      const x = await aiJSON<ExtractJobResult>(env, {
        instructions: EXTRACT_JOB_INSTRUCTIONS,
        user: `${b.url ? `Link: ${b.url}\n\n` : ''}<pasted>\n${text}\n</pasted>`,
        schema: EXTRACT_JOB_SCHEMA,
        effort: 'low',
        maxTokens: 16000,
        mock: () => ({ title: text.split('\n')[0].slice(0, 80), company: 'Pasted Company', location: '', work_mode: 'unknown', salary: '', description: text, apply_url: b.url ?? '', application_email: extractApplicationEmail(text) ?? '' }),
      });
      const before = await env.DB.prepare('SELECT MAX(id) AS m FROM jobs').first<{ m: number | null }>();
      await ingestJobs(env, [{
        source: 'manual', external_id: `${b.url || ''}:${Date.now()}`, url: b.url || x.apply_url || null, apply_url: x.apply_url || null,
        title: x.title || 'Untitled job', company: x.company || 'Unknown employer', location: x.location || null, work_mode: x.work_mode,
        salary: x.salary || null, description: x.description || text, application_email: x.application_email || null,
      }]);
      // Manually added jobs skip the keyword screen — she picked it herself.
      const job = await env.DB.prepare('SELECT id FROM jobs WHERE id > ? ORDER BY id DESC LIMIT 1').bind(before?.m ?? 0).first<{ id: number }>();
      if (!job) return error('That job is already in your list.', 409);
      await env.DB.prepare("UPDATE jobs SET status = 'shortlisted', fit_summary = NULL WHERE id = ?").bind(job.id).run();
      await scoreJob(env, job.id);
      return json({ id: job.id });
    }],
    ['POST', '/api/jobs/:id/score', async (_r, p) => json(await scoreJob(env, int(p.id)))],
    ['PATCH', '/api/jobs/:id', async (req, p) => {
      const b = await body<{ status?: string }>(req);
      if (!['new', 'shortlisted', 'dismissed'].includes(b.status ?? '')) return error('Bad status');
      await env.DB.prepare('UPDATE jobs SET status = ? WHERE id = ?').bind(b.status, int(p.id)).run();
      return json({ ok: true });
    }],
    ['POST', '/api/search', async () => json(await runSearch(env))],
    ['POST', '/api/jobs/:id/prepare', async (req, p) => {
      const b = await body<{ feedback?: string }>(req).catch(() => ({} as { feedback?: string }));
      const app = await prepareApplication(env, int(p.id), { feedback: str(b.feedback, 2000), by: 'her' });
      return json({ id: app.id });
    }],

    // ---- applications
    ['GET', '/api/applications', async () => json((await env.DB.prepare(
      `SELECT a.id, a.status, a.apply_method, a.submitted_at, a.last_contact_at, a.follow_up_count, a.closed_reason, a.updated_at, a.created_at,
         j.id AS job_id, j.title, j.company, j.location, j.work_mode, j.fit_score,
         (SELECT summary FROM app_events e WHERE e.application_id = a.id ORDER BY e.id DESC LIMIT 1) AS last_event,
         (SELECT COUNT(*) FROM outbox o WHERE o.application_id = a.id AND o.status = 'pending') AS waiting
       FROM applications a JOIN jobs j ON j.id = a.job_id ORDER BY a.updated_at DESC`,
    ).all()).results)],
    ['GET', '/api/applications/:id', async (_r, p) => {
      const app = await loadApp(env, int(p.id));
      const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(app.job_id).first<JobRow>();
      const events = (await env.DB.prepare('SELECT * FROM app_events WHERE application_id = ? ORDER BY id DESC').bind(app.id).all()).results;
      const outbox = (await env.DB.prepare('SELECT * FROM outbox WHERE application_id = ? ORDER BY id DESC').bind(app.id).all()).results;
      return json({ ...app, form_answers: app.form_answers ? JSON.parse(app.form_answers) : [], job: job && { ...job, fit: job.fit_json ? JSON.parse(job.fit_json) : null }, events, outbox });
    }],
    ['PATCH', '/api/applications/:id', async (req, p) => {
      const app = await loadApp(env, int(p.id));
      const b = await body<Partial<AppRow> & { form_answers?: unknown }>(req);
      await rememberEdit(env, 'resume', app.resume_md, str(b.resume_md));
      await rememberEdit(env, 'cover_letter', app.cover_letter_md, str(b.cover_letter_md));
      await rememberEdit(env, 'email', app.email_body, str(b.email_body));
      if (b.status && !APP_STATUSES.includes(b.status)) return error('Bad status');
      if (b.apply_method && !['email', 'web', 'in_person'].includes(b.apply_method)) return error('Bad apply method');
      await env.DB.prepare(
        `UPDATE applications SET resume_md = COALESCE(?, resume_md), cover_letter_md = COALESCE(?, cover_letter_md), email_subject = COALESCE(?, email_subject),
           email_body = COALESCE(?, email_body), contact_email = COALESCE(?, contact_email), apply_method = COALESCE(?, apply_method), notes = COALESCE(?, notes),
           form_answers = COALESCE(?, form_answers), status = COALESCE(?, status),
           closed_reason = CASE WHEN ? IN ('withdrawn','closed','rejected') THEN COALESCE(?, closed_reason) ELSE closed_reason END,
           updated_at = datetime('now') WHERE id = ?`,
      ).bind(
        str(b.resume_md) ?? null, str(b.cover_letter_md) ?? null, str(b.email_subject, 300) ?? null, str(b.email_body) ?? null,
        b.contact_email === undefined ? null : (str(b.contact_email, 200) ?? '').trim() || null, b.apply_method ?? null, str(b.notes, 10000) ?? null,
        b.form_answers === undefined ? null : JSON.stringify(b.form_answers), b.status ?? null, b.status ?? '', str(b.closed_reason, 500) ?? null, app.id,
      ).run();
      if (b.status && b.status !== app.status) {
        await addEvent(env, app.id, 'status', `Status → ${b.status.replace('_', ' ')} (changed by hand)`);
        if (['won', 'rejected', 'closed', 'withdrawn'].includes(b.status)) {
          await env.DB.prepare("UPDATE outbox SET status = 'cancelled' WHERE application_id = ? AND status IN ('pending','approved')").bind(app.id).run();
        }
        if (b.status === 'interviewing') {
          await env.DB.prepare("UPDATE applications SET follow_up_count = 0, last_contact_at = datetime('now') WHERE id = ?").bind(app.id).run();
        }
      }
      return json({ ok: true });
    }],
    ['POST', '/api/applications/:id/redraft', async (req, p) => {
      const app = await loadApp(env, int(p.id));
      const b = await body<{ feedback?: string }>(req);
      await prepareApplication(env, app.job_id, { feedback: str(b.feedback, 2000) || undefined, by: 'her' });
      return json({ ok: true });
    }],
    ['POST', '/api/applications/:id/send', async (_r, p) => {
      const id = await queueApplication(env, int(p.id), 'her');
      return json(await sendOutboxItem(env, id));
    }],
    ['POST', '/api/applications/:id/mark-submitted', async (req, p) => {
      const app = await loadApp(env, int(p.id));
      const b = await body<{ how?: string }>(req).catch(() => ({} as { how?: string }));
      await afterContact(env, app, 'application', null);
      if (b.how) await addEvent(env, app.id, 'note', b.how.slice(0, 500));
      return json({ ok: true });
    }],
    ['POST', '/api/applications/:id/note', async (req, p) => {
      const app = await loadApp(env, int(p.id));
      const b = await body<{ text?: string }>(req);
      if (!b.text?.trim()) return error('Empty note');
      await addEvent(env, app.id, 'note', b.text.trim().slice(0, 2000));
      await env.DB.prepare("UPDATE applications SET updated_at = datetime('now') WHERE id = ?").bind(app.id).run();
      return json({ ok: true });
    }],
    ['GET', '/api/applications/:id/docx/:which', async (_r, p) => {
      const app = await loadApp(env, int(p.id));
      const prefs = await getPrefs(env);
      const isResume = p.which === 'resume';
      const md = isResume ? app.resume_md : app.cover_letter_md;
      if (!md) return error('Nothing to download yet', 404);
      const bytes = Uint8Array.from(atob(await markdownToDocxBase64(md, isResume ? 'resume' : 'letter')), (c) => c.charCodeAt(0));
      return new Response(bytes, {
        headers: { 'Content-Type': DOCX_MIME, 'Content-Disposition': `attachment; filename="${docFilename(prefs.name, isResume ? 'Resume' : 'Cover_Letter')}"` },
      });
    }],

    // ---- outbox (everything waiting to be sent)
    ['GET', '/api/outbox', async () => json((await env.DB.prepare(
      `SELECT o.*, j.title, j.company FROM outbox o LEFT JOIN applications a ON a.id = o.application_id LEFT JOIN jobs j ON j.id = a.job_id ORDER BY o.id DESC LIMIT 100`,
    ).all()).results)],
    ['PATCH', '/api/outbox/:id', async (req, p) => {
      const row = await env.DB.prepare('SELECT * FROM outbox WHERE id = ?').bind(int(p.id)).first<OutboxRow>();
      if (!row) return error('Not found', 404);
      if (row.status === 'sent') return error('Already sent');
      const b = await body<{ to_email?: string; subject?: string; body?: string }>(req);
      await rememberEdit(env, 'email', row.body, str(b.body));
      await env.DB.prepare("UPDATE outbox SET to_email = COALESCE(?, to_email), subject = COALESCE(?, subject), body = COALESCE(?, body), status = CASE WHEN status = 'failed' THEN 'pending' ELSE status END WHERE id = ?")
        .bind(b.to_email === undefined ? null : b.to_email.trim() || null, str(b.subject, 300) ?? null, str(b.body) ?? null, row.id).run();
      if (row.application_id && b.to_email?.trim()) {
        await env.DB.prepare('UPDATE applications SET contact_email = COALESCE(contact_email, ?) WHERE id = ?').bind(b.to_email.trim(), row.application_id).run();
      }
      return json({ ok: true });
    }],
    ['POST', '/api/outbox/:id/approve', async (_r, p) => {
      const id = int(p.id);
      await env.DB.prepare("UPDATE outbox SET status = 'approved', approved_by = 'her' WHERE id = ? AND status IN ('pending','failed','approved')").bind(id).run();
      return json(await sendOutboxItem(env, id));
    }],
    ['POST', '/api/outbox/:id/cancel', async (_r, p) => {
      await env.DB.prepare("UPDATE outbox SET status = 'cancelled' WHERE id = ? AND status != 'sent'").bind(int(p.id)).run();
      return json({ ok: true });
    }],
    ['POST', '/api/outbox/:id/done', async (_r, p) => {
      // She called / messaged / emailed them herself.
      const row = await env.DB.prepare('SELECT * FROM outbox WHERE id = ?').bind(int(p.id)).first<OutboxRow>();
      if (!row) return error('Not found', 404);
      await env.DB.prepare("UPDATE outbox SET status = 'sent', approved_by = 'her', sent_at = datetime('now'), error = 'Done by hand' WHERE id = ?").bind(row.id).run();
      if (row.application_id) await afterContact(env, await loadApp(env, row.application_id), row.kind, null);
      return json({ ok: true });
    }],

    // ---- manual triggers for the autopilot jobs
    ['POST', '/api/inbox/sync', async () => json(await syncInbox(env))],
    ['POST', '/api/followups/run', async () => json(await processFollowUps(env))],

    // ---- Gmail
    ['GET', '/api/google/start', async (req) => {
      if (!googleConfigured(env)) return error('Google isn’t set up yet — run npm run setup.', 400);
      const state = await signJwt(env, { sub: user.sub, email: user.email, name: user.name, purpose: 'connect' }, 600);
      return json({ url: authUrl(env, new URL(req.url).origin, state, 'connect') });
    }],
    ['POST', '/api/google/disconnect', async () => {
      await disconnectGmail(env);
      return json({ ok: true });
    }],
  ];
  return dispatch(routes, request, path);
}
