// The job-search engine: find → screen → fit check → draft → send → follow up → track replies.
// Called from API routes (when she clicks a button) and from the hourly cron (autopilot).
import type { Env } from './env';
import {
  addEvent, getPrefs, getSetting, getVoice, logActivity, setSetting, sqlNow,
  type AppRow, type JobRow, type OutboxRow,
} from './lib/db';
import { aiJSON, aiText, AIError, pdfBlock } from './lib/ai';
import {
  careerContext, writingContext, classifyMock, classifyUser, CLASSIFY_INSTRUCTIONS, CLASSIFY_SCHEMA, draftMock, draftUser,
  DRAFT_INSTRUCTIONS, DRAFT_SCHEMA, FOLLOW_UP_INSTRUCTIONS, followUpMock, followUpUser, LEARN_INSTRUCTIONS, learnMock,
  LEARN_SCHEMA, MESSAGE_SCHEMA, PDF_TEXT_INSTRUCTIONS, REPLY_INSTRUCTIONS, SCORE_INSTRUCTIONS, SCORE_SCHEMA, scoreMock, scoreUser,
  type ClassifyResult, type DraftResult, type LearnResult, type MessageResult, type ScoreResult, type VoiceExample,
} from './lib/prompts';
import { cleanEmailBody, dedupeKey, extractApplicationEmail, prefilter, remoteLocationOk, truncate } from './lib/text';
import { nextStep, isBusinessHours, localDate, localHour } from './lib/followup';
import { matchApplication, senderAddress } from './lib/match';
import { connectedEmail, getMessage, gmailStatus, listMessages, sendEmail } from './lib/gmail';
import { docFilename, DOCX_MIME, markdownToDocxBase64 } from './lib/docx';
import { fetchAllSources, type SourceReport } from './sources';
import type { RawJob } from './sources/types';

const ACTIVE = ['submitted', 'following_up', 'interviewing', 'offer'];
const KEYWORD_SEARCHED = new Set(['remotive', 'adzuna', 'usajobs', 'web_scout', 'manual']);

async function recentExamples(env: Env): Promise<VoiceExample[]> {
  const { results } = await env.DB.prepare('SELECT kind, before_text, after_text FROM voice_examples ORDER BY id DESC LIMIT 6').all<VoiceExample>();
  return results.reverse();
}

async function limit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

// ------------------------------------------------------------------ voice

export async function learnVoice(env: Env): Promise<LearnResult> {
  const { results: docs } = await env.DB.prepare('SELECT kind, title, content FROM documents WHERE use_for_voice = 1 ORDER BY created_at DESC').all<{ kind: string; title: string; content: string }>();
  if (!docs.length) throw new AIError('Add at least one resume, cover letter, or email first.');
  let budget = 400_000; // characters (~100k tokens) — plenty for a career's worth of documents
  const parts: string[] = [];
  for (const d of docs) {
    if (budget <= 0) break;
    const text = d.content.slice(0, Math.min(budget, 60_000));
    budget -= text.length;
    parts.push(`<document kind="${d.kind}" title="${d.title.replace(/"/g, "'")}">\n${text}\n</document>`);
  }
  const existing = await getVoice(env);
  const examples = await recentExamples(env);
  const user = [
    parts.join('\n\n'),
    existing.career_record ? `<existing_career_record>\n${existing.career_record}\n</existing_career_record>` : '',
    examples.length ? `Edits she made to AI drafts (strong evidence of her preferences):\n${examples.map((e) => `<edit kind="${e.kind}"><before>${truncate(e.before_text, 1500)}</before><after>${truncate(e.after_text, 1500)}</after></edit>`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const result = await aiJSON<LearnResult>(env, {
    instructions: LEARN_INSTRUCTIONS, user, schema: LEARN_SCHEMA, effort: 'high', mock: () => learnMock(docs.length),
  });
  await setSetting(env, 'voice', { ...result, learned_at: new Date().toISOString() });
  await logActivity(env, 'voice', `Re-learned her voice from ${docs.length} documents`);
  return result;
}

// ------------------------------------------------------------------ find + screen

export async function ingestJobs(env: Env, raw: RawJob[]): Promise<{ added: number; screenedOut: number }> {
  const prefs = await getPrefs(env);
  const cutoff = Date.now() - 35 * 86_400_000;
  let added = 0;
  let screenedOut = 0;
  const stmts: D1PreparedStatement[] = [];
  const seen = new Set<string>();
  for (const j of raw) {
    if (!j.title || !j.company) continue;
    if (j.posted_at && new Date(j.posted_at).getTime() < cutoff) continue;
    const key = dedupeKey(j.company, j.title, j.work_mode, j.location);
    if (seen.has(key)) continue;
    seen.add(key);
    // Sources that were already searched by her target roles skip the keyword screen.
    let reason = prefilter({ ...j }, prefs, { skipRoleCheck: KEYWORD_SEARCHED.has(j.source) });
    if (!reason && j.work_mode === 'remote' && !remoteLocationOk(j.location_restriction)) reason = `remote, but only for ${j.location_restriction}`;
    if (reason) screenedOut++;
    stmts.push(env.DB.prepare(
      `INSERT OR IGNORE INTO jobs (source, external_id, dedupe_key, url, apply_url, title, company, location, work_mode, salary, description, posted_at, application_email, status, fit_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      j.source, j.external_id.slice(0, 500), key, j.url, j.apply_url ?? null, j.title.slice(0, 300), j.company.slice(0, 200), j.location,
      j.work_mode, j.salary ?? null, j.description.slice(0, 60_000), j.posted_at ?? null,
      j.application_email ?? extractApplicationEmail(j.description), reason ? 'filtered' : 'new', reason ? `Skipped: ${reason}` : null,
    ));
  }
  for (let i = 0; i < stmts.length; i += 50) {
    const res = await env.DB.batch(stmts.slice(i, i + 50));
    added += res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  return { added, screenedOut };
}

export async function scoreJob(env: Env, jobId: number): Promise<ScoreResult> {
  const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(jobId).first<JobRow>();
  if (!job) throw new AIError('Job not found');
  const [prefs, voice] = await Promise.all([getPrefs(env), getVoice(env)]);
  const r = await aiJSON<ScoreResult>(env, {
    context: careerContext(voice, prefs),
    instructions: SCORE_INSTRUCTIONS,
    user: scoreUser(job),
    schema: SCORE_SCHEMA,
    effort: 'medium',
    maxTokens: 16000,
    mock: () => scoreMock(job),
  });
  let score = Math.max(0, Math.min(100, Math.round(r.fit_score)));
  if (r.work_mode !== 'remote' && !r.commute_ok) score = Math.min(score, 45);
  if (r.red_flags.length) score = Math.min(score, 15);
  const label = r.red_flags.length ? 'caution' : score >= 85 ? 'great' : score >= 70 ? 'good' : score >= 50 ? 'stretch' : 'poor';
  await env.DB.prepare(
    `UPDATE jobs SET fit_score = ?, fit_label = ?, fit_summary = ?, fit_json = ?, apply_method = ?,
       application_email = COALESCE(NULLIF(?, ''), application_email), salary = COALESCE(salary, NULLIF(?, '')),
       work_mode = CASE WHEN work_mode = 'unknown' THEN ? ELSE work_mode END
     WHERE id = ?`,
  ).bind(score, label, r.summary, JSON.stringify(r), r.apply_method, r.application_email, r.salary, r.work_mode, jobId).run();
  return { ...r, fit_score: score };
}

export async function scorePending(env: Env, max: number): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM jobs WHERE status = 'new' AND fit_score IS NULL ORDER BY COALESCE(posted_at, found_at) DESC LIMIT ?",
  ).bind(max).all<{ id: number }>();
  let n = 0;
  await limit(results, 4, async ({ id }) => {
    try {
      await scoreJob(env, id);
      n++;
    } catch (e) {
      await logActivity(env, 'error', `Fit check failed for job ${id}: ${e instanceof Error ? e.message : e}`);
    }
  });
  return n;
}

export async function runSearch(env: Env): Promise<{ report: SourceReport[]; added: number; screenedOut: number; scored: number; prepared: number }> {
  const [prefs, voice] = await Promise.all([getPrefs(env), getVoice(env)]);
  const { jobs, report } = await fetchAllSources(env, prefs, voice);
  const { added, screenedOut } = await ingestJobs(env, jobs);
  const scored = await scorePending(env, prefs.autopilot.max_scores_per_run);
  const prepared = await autoPrepare(env);
  await setSetting(env, 'last_search', { at: new Date().toISOString(), report, added, screenedOut, scored, prepared });
  await logActivity(env, 'search', `Search: ${jobs.length} postings seen, ${added} new (${screenedOut} screened out), ${scored} fit-checked, ${prepared} drafted`);
  return { report, added, screenedOut, scored, prepared };
}

// ------------------------------------------------------------------ draft applications

function applyMethodFor(job: JobRow): AppRow['apply_method'] {
  if (job.apply_method === 'email' && job.application_email) return 'email';
  if (job.apply_method === 'in_person') return 'in_person';
  return 'web';
}

export async function prepareApplication(env: Env, jobId: number, opts: { feedback?: string; by: 'her' | 'autopilot' } = { by: 'her' }): Promise<AppRow> {
  const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(jobId).first<JobRow>();
  if (!job) throw new AIError('Job not found');
  const [prefs, voice, examples] = await Promise.all([getPrefs(env), getVoice(env), recentExamples(env)]);
  if (!voice.career_record) throw new AIError('Upload her resume and click "Learn my voice" first — drafts can only use facts from her career record.');

  let app = await env.DB.prepare("SELECT * FROM applications WHERE job_id = ? AND status NOT IN ('withdrawn') ORDER BY id DESC LIMIT 1").bind(jobId).first<AppRow>();
  const previous = app && opts.feedback ? { resume_md: app.resume_md ?? '', cover_letter_md: app.cover_letter_md ?? '', email_body: app.email_body ?? '' } : undefined;
  const fit = job.fit_json ? (JSON.parse(job.fit_json) as ScoreResult) : null;

  const d = await aiJSON<DraftResult>(env, {
    context: writingContext(voice, prefs, examples),
    instructions: DRAFT_INSTRUCTIONS,
    user: draftUser(job, fit, opts.feedback, previous),
    schema: DRAFT_SCHEMA,
    effort: 'high',
    mock: () => draftMock(job, prefs, opts.feedback),
  });

  const method = applyMethodFor(job);
  if (!app) {
    const res = await env.DB.prepare(
      `INSERT INTO applications (job_id, status, apply_method, contact_email) VALUES (?, 'drafting', ?, ?)`,
    ).bind(jobId, method, job.application_email).run();
    app = (await env.DB.prepare('SELECT * FROM applications WHERE id = ?').bind(res.meta.last_row_id).first<AppRow>())!;
    await addEvent(env, app.id, 'created', opts.by === 'autopilot' ? `Autopilot started an application (fit ${job.fit_score ?? '?'})` : 'Started an application');
    await env.DB.prepare("UPDATE jobs SET status = 'applying' WHERE id = ?").bind(jobId).run();
  }
  const isSubmitted = ACTIVE.includes(app.status) || ['won', 'rejected', 'closed'].includes(app.status);
  await env.DB.prepare(
    `UPDATE applications SET resume_md = ?, cover_letter_md = ?, email_subject = ?, email_body = ?, form_answers = ?, ai_notes = ?,
       status = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(d.resume_md, d.cover_letter_md, d.email_subject, d.email_body, JSON.stringify(d.form_answers), d.notes_for_her,
    isSubmitted ? app.status : 'ready', app.id).run();
  await addEvent(env, app.id, 'drafted', opts.feedback ? `Rewrote the drafts: “${truncate(opts.feedback, 120)}”` : 'Wrote a tailored resume, cover letter, and email');

  // Autopilot may send email applications on its own — only if she turned that on.
  if (opts.by === 'autopilot' && method === 'email' && prefs.autopilot.auto_send_applications && !isSubmitted) {
    await queueApplication(env, app.id, 'autopilot');
  }
  return (await env.DB.prepare('SELECT * FROM applications WHERE id = ?').bind(app.id).first<AppRow>())!;
}

async function autoPrepare(env: Env): Promise<number> {
  const prefs = await getPrefs(env);
  const t = prefs.autopilot.auto_prepare_threshold;
  if (!t) return 0;
  const voice = await getVoice(env);
  if (!voice.career_record) return 0;
  const { results } = await env.DB.prepare(
    `SELECT j.id FROM jobs j WHERE j.status = 'new' AND j.fit_score >= ?
       AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id) ORDER BY j.fit_score DESC LIMIT 5`,
  ).bind(t).all<{ id: number }>();
  let n = 0;
  for (const { id } of results) {
    try {
      await prepareApplication(env, id, { by: 'autopilot' });
      n++;
    } catch (e) {
      await logActivity(env, 'error', `Auto-draft failed for job ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return n;
}

/** Put the application email in the outbox (approved = it will send). */
export async function queueApplication(env: Env, appId: number, by: 'her' | 'autopilot'): Promise<number> {
  const app = await env.DB.prepare('SELECT * FROM applications WHERE id = ?').bind(appId).first<AppRow>();
  if (!app) throw new Error('Application not found');
  if (!app.contact_email) throw new Error('Add the employer’s email address first.');
  if (!app.email_subject || !app.email_body) throw new Error('The email draft is empty.');
  if (by === 'her' && !(await gmailStatus(env)).connected) throw new Error('Connect Gmail in Settings first, so the app can send from your address.');
  await env.DB.prepare("UPDATE outbox SET status = 'cancelled' WHERE application_id = ? AND kind = 'application' AND status IN ('pending','approved')").bind(appId).run();
  const res = await env.DB.prepare(
    `INSERT INTO outbox (application_id, kind, to_email, subject, body, attach_resume, attach_cover_letter, status, approved_by)
     VALUES (?, 'application', ?, ?, ?, 1, 1, 'approved', ?)`,
  ).bind(appId, app.contact_email, app.email_subject, app.email_body, by).run();
  return res.meta.last_row_id as number;
}

// ------------------------------------------------------------------ sending

export async function sendOutboxItem(env: Env, id: number): Promise<OutboxRow> {
  const row = await env.DB.prepare('SELECT * FROM outbox WHERE id = ?').bind(id).first<OutboxRow & { thread_id: string | null; in_reply_to: string | null }>();
  if (!row) throw new Error('Message not found');
  if (row.status === 'sent') return row;
  if (!row.to_email) throw new Error('This message has no recipient yet.');
  const prefs = await getPrefs(env);
  const app = row.application_id ? await env.DB.prepare('SELECT * FROM applications WHERE id = ?').bind(row.application_id).first<AppRow>() : null;
  try {
    const attachments = [];
    if (app && row.attach_resume && app.resume_md) attachments.push({ filename: docFilename(prefs.name, 'Resume'), mimeType: DOCX_MIME, base64: await markdownToDocxBase64(app.resume_md, 'resume') });
    if (app && row.attach_cover_letter && app.cover_letter_md) attachments.push({ filename: docFilename(prefs.name, 'Cover_Letter'), mimeType: DOCX_MIME, base64: await markdownToDocxBase64(app.cover_letter_md, 'letter') });
    const sent = await sendEmail(env, {
      fromName: prefs.name,
      to: row.to_email,
      subject: row.subject,
      text: row.body,
      threadId: row.thread_id ?? (row.kind !== 'application' ? app?.gmail_thread_id : null),
      inReplyTo: row.in_reply_to ?? (row.kind !== 'application' ? app?.rfc_message_id : null),
      attachments,
    });
    await env.DB.prepare("UPDATE outbox SET status = 'sent', sent_at = datetime('now'), error = NULL WHERE id = ?").bind(id).run();
    if (app) await afterContact(env, app, row.kind, row.to_email, { threadId: sent.threadId, messageId: sent.messageId, subject: row.subject });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await env.DB.prepare("UPDATE outbox SET status = 'failed', error = ? WHERE id = ?").bind(msg.slice(0, 500), id).run();
    if (app) await addEvent(env, app.id, 'error', `Couldn't send ${row.kind.replace('_', ' ')}: ${msg.slice(0, 200)}`);
    throw e;
  }
  return (await env.DB.prepare('SELECT * FROM outbox WHERE id = ?').bind(id).first<OutboxRow>())!;
}

/** Update the application after any contact she made (sent by the app, or done by hand). */
export async function afterContact(env: Env, app: AppRow, kind: string, to: string | null, mail?: { threadId?: string; messageId?: string | null; subject?: string }): Promise<void> {
  if (kind === 'application') {
    await env.DB.prepare(
      `UPDATE applications SET status = 'submitted', submitted_at = COALESCE(submitted_at, datetime('now')), last_contact_at = datetime('now'),
         gmail_thread_id = COALESCE(?, gmail_thread_id), rfc_message_id = COALESCE(?, rfc_message_id), updated_at = datetime('now') WHERE id = ?`,
    ).bind(mail?.threadId ?? null, mail?.messageId ?? null, app.id).run();
    // Any other unsent copy of the application email is now moot.
    await env.DB.prepare("UPDATE outbox SET status = 'cancelled' WHERE application_id = ? AND kind = 'application' AND status IN ('pending','approved','failed')").bind(app.id).run();
    await env.DB.prepare("UPDATE jobs SET status = 'applying' WHERE id = ?").bind(app.job_id).run();
    await addEvent(env, app.id, 'submitted', to ? `Application emailed to ${to}` : 'Application submitted');
  } else if (kind === 'follow_up') {
    await env.DB.prepare(
      `UPDATE applications SET follow_up_count = follow_up_count + 1, last_contact_at = datetime('now'),
         status = CASE WHEN status = 'submitted' THEN 'following_up' ELSE status END,
         rfc_message_id = COALESCE(?, rfc_message_id), gmail_thread_id = COALESCE(gmail_thread_id, ?), updated_at = datetime('now') WHERE id = ?`,
    ).bind(mail?.messageId ?? null, mail?.threadId ?? null, app.id).run();
    await addEvent(env, app.id, 'follow_up_sent', to ? `Follow-up sent to ${to}` : 'Followed up');
  } else {
    await env.DB.prepare("UPDATE applications SET last_contact_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(app.id).run();
    await addEvent(env, app.id, 'reply_sent', to ? `Replied to ${to}` : 'Replied');
  }
}

async function sendApproved(env: Env): Promise<number> {
  const tz = env.TIMEZONE || 'America/Los_Angeles';
  // Her own approvals send right away from the API; anything still approved here was queued by
  // autopilot (or failed earlier) and only goes out during business hours.
  if (!isBusinessHours(new Date(), tz)) return 0;
  const { results } = await env.DB.prepare("SELECT id FROM outbox WHERE status = 'approved' ORDER BY id LIMIT 10").all<{ id: number }>();
  let n = 0;
  for (const { id } of results) {
    try {
      await sendOutboxItem(env, id);
      n++;
    } catch (e) {
      await logActivity(env, 'error', `Send failed for message ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return n;
}

// ------------------------------------------------------------------ follow-ups

async function historyText(env: Env, appId: number): Promise<string> {
  const { results } = await env.DB.prepare('SELECT created_at, summary FROM app_events WHERE application_id = ? ORDER BY id').bind(appId).all<{ created_at: string; summary: string }>();
  return results.map((e) => `- ${e.created_at.slice(0, 10)}: ${e.summary}`).join('\n');
}

export async function processFollowUps(env: Env, now = new Date()): Promise<{ drafted: number; closed: number }> {
  const prefs = await getPrefs(env);
  const { results: apps } = await env.DB.prepare(
    `SELECT a.*, j.title, j.company FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.status IN ('submitted','following_up','interviewing')
       AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.application_id = a.id AND o.kind != 'application' AND o.status IN ('pending','approved','failed'))`,
  ).all<AppRow & { title: string; company: string }>();
  let drafted = 0;
  let closed = 0;
  for (const app of apps) {
    const step = nextStep(app, now, prefs.autopilot);
    if (step.type === 'close') {
      await env.DB.prepare("UPDATE applications SET status = 'closed', closed_reason = ?, updated_at = datetime('now') WHERE id = ?").bind(step.reason, app.id).run();
      await addEvent(env, app.id, 'status', `Closed: ${step.reason}`);
      closed++;
      continue;
    }
    if (step.type !== 'follow_up') continue;
    try {
      const msg = await draftFollowUp(env, app, step.number, step.kind);
      const auto = prefs.autopilot.auto_send_follow_ups && !!app.contact_email;
      await env.DB.prepare(
        `INSERT INTO outbox (application_id, kind, to_email, subject, body, status, approved_by, thread_id, in_reply_to, notes_for_her)
         VALUES (?, 'follow_up', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(app.id, app.contact_email, msg.subject, msg.body, auto ? 'approved' : 'pending', auto ? 'autopilot' : null,
        app.gmail_thread_id, app.rfc_message_id,
        app.contact_email ? msg.notes_for_her : `We don't have an email address for ${app.company}. Add one to send this, or use it as a script for a phone call or a LinkedIn message, then tap “I did this myself”.${msg.notes_for_her ? `\n${msg.notes_for_her}` : ''}`,
      ).run();
      await addEvent(env, app.id, 'task', step.kind === 'interview_check_in' ? 'Drafted an interview check-in' : `Drafted follow-up #${step.number}`);
      drafted++;
    } catch (e) {
      await logActivity(env, 'error', `Follow-up draft failed for application ${app.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { drafted, closed };
}

async function draftFollowUp(env: Env, app: AppRow & { title: string; company: string }, number: number, kind: string): Promise<MessageResult> {
  const [prefs, voice, examples] = await Promise.all([getPrefs(env), getVoice(env), recentExamples(env)]);
  const ctx = { title: app.title, company: app.company, submitted_at: app.submitted_at, subject: app.apply_method === 'email' ? app.email_subject : null, number, kind, history: await historyText(env, app.id) };
  return aiJSON<MessageResult>(env, {
    context: writingContext(voice, prefs, examples),
    instructions: FOLLOW_UP_INSTRUCTIONS,
    user: followUpUser(ctx),
    schema: MESSAGE_SCHEMA,
    effort: 'medium',
    maxTokens: 8000,
    mock: () => followUpMock(ctx, prefs),
  });
}

// ------------------------------------------------------------------ replies (Gmail inbox)

const STATUS_FOR: Partial<Record<ClassifyResult['category'], string>> = { interview: 'interviewing', offer: 'offer', rejection: 'rejected' };

export async function syncInbox(env: Env): Promise<{ checked: number; matched: number }> {
  const status = await gmailStatus(env);
  if (!status.connected) return { checked: 0, matched: 0 };
  const me = (await connectedEmail(env))?.toLowerCase() ?? '';
  const last = await getSetting<{ at: number }>(env, 'inbox_sync');
  const since = last ? Math.floor(last.at / 1000) - 3600 : Math.floor(Date.now() / 1000) - 14 * 86400;
  const startedAt = Date.now();
  const ids = await listMessages(env, `in:inbox after:${since} -category:promotions -category:social`, 50);

  const { results: apps } = await env.DB.prepare(
    `SELECT a.*, j.title, j.company FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.status IN ('submitted','following_up','interviewing','offer')`,
  ).all<AppRow & { title: string; company: string }>();

  let checked = 0;
  let matched = 0;
  for (const { id } of ids) {
    if (await env.DB.prepare('SELECT 1 FROM inbox_seen WHERE gmail_id = ?').bind(id).first()) continue;
    checked++;
    const mail = await getMessage(env, id);
    if (senderAddress(mail.from) === me) {
      await env.DB.prepare('INSERT OR IGNORE INTO inbox_seen (gmail_id) VALUES (?)').bind(id).run();
      continue;
    }
    const app = matchApplication(mail, apps) as (AppRow & { title: string; company: string }) | null;
    if (!app) {
      await env.DB.prepare('INSERT OR IGNORE INTO inbox_seen (gmail_id) VALUES (?)').bind(id).run();
      continue;
    }
    const c = await aiJSON<ClassifyResult>(env, {
      instructions: CLASSIFY_INSTRUCTIONS,
      user: classifyUser(app, mail),
      schema: CLASSIFY_SCHEMA,
      effort: 'low',
      maxTokens: 4000,
      mock: () => classifyMock(mail),
    });
    await env.DB.prepare('INSERT OR IGNORE INTO inbox_seen (gmail_id, application_id, category) VALUES (?, ?, ?)').bind(id, c.related ? app.id : null, c.category).run();
    if (!c.related) continue;
    matched++;
    await handleReply(env, app, mail, c);
  }
  await setSetting(env, 'inbox_sync', { at: startedAt });
  return { checked, matched };
}

async function handleReply(env: Env, app: AppRow & { title: string; company: string }, mail: Awaited<ReturnType<typeof getMessage>>, c: ClassifyResult): Promise<void> {
  const label = { interview: '🎉 Interview request', offer: '🎉 Offer', rejection: 'Not moving forward', info_request: 'They need something', acknowledgement: 'Application received', other: 'New email' }[c.category];
  await addEvent(env, app.id, 'reply', `${label}: ${c.summary}`, JSON.stringify({ from: mail.from, subject: mail.subject, date: mail.date, key_details: c.key_details, body: truncate(mail.body, 4000) }));

  const newStatus = STATUS_FOR[c.category];
  const reset = c.category === 'interview' && app.status !== 'interviewing';
  // Automated "no-reply" senders (applicant tracking systems) aren't a person to follow up with.
  const sender = senderAddress(mail.from);
  const human = !/no-?reply|donotreply|notifications?@/i.test(sender);
  await env.DB.prepare(
    `UPDATE applications SET status = COALESCE(?, status), last_contact_at = datetime('now'),
       follow_up_count = CASE WHEN ? THEN 0 ELSE follow_up_count END,
       closed_reason = CASE WHEN ? = 'rejected' THEN ? ELSE closed_reason END,
       contact_email = COALESCE(contact_email, ?), gmail_thread_id = COALESCE(gmail_thread_id, ?), rfc_message_id = COALESCE(?, rfc_message_id),
       updated_at = datetime('now') WHERE id = ?`,
  ).bind(newStatus ?? null, reset ? 1 : 0, newStatus ?? '', c.summary, human ? sender : null, human ? mail.threadId : null, human ? mail.messageId : null, app.id).run();
  if (c.category === 'rejection' || c.category === 'interview' || c.category === 'offer') {
    // Pending follow-ups are moot now.
    await env.DB.prepare("UPDATE outbox SET status = 'cancelled' WHERE application_id = ? AND kind = 'follow_up' AND status IN ('pending','approved')").bind(app.id).run();
  }
  if (newStatus) await addEvent(env, app.id, 'status', `Status → ${newStatus.replace('_', ' ')}`);

  if (c.needs_response && human) {
    const [prefs, voice, examples] = await Promise.all([getPrefs(env), getVoice(env), recentExamples(env)]);
    const r = await aiJSON<MessageResult>(env, {
      context: writingContext(voice, prefs, examples),
      instructions: REPLY_INSTRUCTIONS,
      user: `Her application: ${app.title} at ${app.company}\n\n${classifyUser(app, mail).split('\n\n').slice(1).join('\n\n')}`,
      schema: MESSAGE_SCHEMA,
      effort: 'medium',
      maxTokens: 8000,
      mock: () => ({ subject: `Re: ${mail.subject}`, body: `Hi,\n\nThank you so much — I'd be glad to. I'm generally available weekdays; please let me know what works for you.\n\nThanks so much,\n${prefs.name}`, notes_for_her: 'Confirm your availability before sending.' }),
    });
    // Replies to a real person always wait for her OK, even on autopilot.
    await env.DB.prepare(
      `INSERT INTO outbox (application_id, kind, to_email, subject, body, status, thread_id, in_reply_to, notes_for_her) VALUES (?, 'reply', ?, ?, ?, 'pending', ?, ?, ?)`,
    ).bind(app.id, sender, r.subject, r.body, mail.threadId, mail.messageId, r.notes_for_her).run();
    await addEvent(env, app.id, 'task', 'Drafted a reply for you to review');
  }
}

/** Her Gmail sent folder is the best sample of her natural voice. */
export async function importSentEmails(env: Env, max = 25): Promise<number> {
  const ids = await listMessages(env, 'in:sent newer_than:2y -has:attachment', max);
  let n = 0;
  for (const { id } of ids) {
    const m = await getMessage(env, id);
    const body = cleanEmailBody(m.body);
    if (body.length < 120) continue; // skip one-liners
    const exists = await env.DB.prepare("SELECT 1 FROM documents WHERE kind = 'email' AND filename = ?").bind(`gmail:${id}`).first();
    if (exists) continue;
    await env.DB.prepare("INSERT INTO documents (kind, title, content, filename) VALUES ('email', ?, ?, ?)")
      .bind(`Sent email: ${m.subject || '(no subject)'}`.slice(0, 200), body.slice(0, 20000), `gmail:${id}`).run();
    n++;
  }
  return n;
}

// ------------------------------------------------------------------ daily digest + cron

async function sendDigest(env: Env): Promise<void> {
  const status = await gmailStatus(env);
  if (!status.connected || !status.email) return;
  const prefs = await getPrefs(env);
  const { results: matches } = await env.DB.prepare(
    "SELECT title, company, fit_score, location FROM jobs WHERE status IN ('new','applying') AND fit_score >= 70 AND found_at >= datetime('now','-1 day') ORDER BY fit_score DESC LIMIT 8",
  ).all<{ title: string; company: string; fit_score: number; location: string }>();
  const waiting = await env.DB.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'").first<{ n: number }>();
  const ready = await env.DB.prepare("SELECT COUNT(*) AS n FROM applications WHERE status = 'ready'").first<{ n: number }>();
  const { results: replies } = await env.DB.prepare(
    "SELECT e.summary, j.company FROM app_events e JOIN applications a ON a.id = e.application_id JOIN jobs j ON j.id = a.job_id WHERE e.type = 'reply' AND e.created_at >= datetime('now','-1 day')",
  ).all<{ summary: string; company: string }>();
  if (!matches.length && !waiting?.n && !ready?.n && !replies.length) return;
  const first = prefs.name.split(' ')[0] || 'there';
  const lines = [
    `Good morning ${first}!`, '',
    ...(replies.length ? ['Replies from employers:', ...replies.map((r) => `  • ${r.company}: ${r.summary}`), ''] : []),
    ...(matches.length ? ['New jobs that look like a good fit:', ...matches.map((m) => `  • ${m.title} — ${m.company} (${m.location ?? 'remote'}) · fit ${m.fit_score}`), ''] : []),
    ...(ready?.n ? [`${ready.n} application${ready.n === 1 ? ' is' : 's are'} drafted and ready for you to look over.`] : []),
    ...(waiting?.n ? [`${waiting.n} message${waiting.n === 1 ? ' is' : 's are'} waiting for your OK before sending.`] : []),
    '', `Open the app: ${env.FRONTEND_URL}`,
  ];
  await sendEmail(env, { fromName: 'Next Chapter', to: status.email, subject: `Your job search today${replies.length ? ` — ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}` : ''}`, text: lines.join('\n') });
}

export async function runHourly(env: Env): Promise<void> {
  const tz = env.TIMEZONE || 'America/Los_Angeles';
  const now = new Date();
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      await logActivity(env, 'error', `${name}: ${e instanceof Error ? e.message : e}`);
    }
  };
  await step('send', () => sendApproved(env));
  await step('inbox', () => syncInbox(env));
  await step('follow-ups', () => processFollowUps(env, now));
  const prefs = await getPrefs(env);
  const today = localDate(now, tz);
  const lastDaily = await getSetting<string>(env, 'last_daily');
  if (lastDaily !== today && localHour(now, tz) >= prefs.autopilot.daily_hour) {
    await setSetting(env, 'last_daily', today);
    if (prefs.autopilot.daily_search) await step('search', () => runSearch(env));
    if (prefs.autopilot.daily_digest) await step('digest', () => sendDigest(env));
  }
  await env.DB.prepare("DELETE FROM activity_log WHERE created_at < datetime('now','-60 days')").run();
}

export async function extractPdfText(env: Env, base64: string): Promise<string> {
  return aiText(env, {
    instructions: PDF_TEXT_INSTRUCTIONS,
    user: [pdfBlock(base64), { type: 'text', text: 'Transcribe this document.' }],
    effort: 'low',
    mock: () => '(Mock PDF text) Linda Example — Office Manager, Gorge Family Dental, 2014–2024.',
  });
}
