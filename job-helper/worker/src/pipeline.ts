// The job-search engine: find → screen → fit check → draft → send → follow up → track replies.
// Called from API routes (when she clicks a button) and from the hourly cron (autopilot).
import type { Env } from './env';
import {
  addEvent, getPrefs, getSetting, getVoice, getVoiceForPrompts, logActivity, setSetting, sqlNow, U,
  type AppRow, type JobRow, type OutboxRow,
} from './lib/db';
import { aiJSON, aiText, AIError, pdfBlock } from './lib/ai';
import {
  careerContext, writingContext, classifyMock, classifyUser, CLASSIFY_INSTRUCTIONS, CLASSIFY_SCHEMA, draftMock, draftUser,
  DRAFT_INSTRUCTIONS, DRAFT_SCHEMA, FOLLOW_UP_INSTRUCTIONS, followUpMock, followUpUser, LEARN_INSTRUCTIONS, learnMock,
  LEARN_SCHEMA, MESSAGE_SCHEMA, PDF_TEXT_INSTRUCTIONS, REPLY_INSTRUCTIONS, SCORE_INSTRUCTIONS, SCORE_SCHEMA, scoreMock, scoreUser,
  type ClassifyResult, type DraftResult, type LearnResult, type MessageResult, type ScoreResult, type VoiceExample,
} from './lib/prompts';
import { abroadOnly, cleanEmailBody, dedupeKey, extractApplicationEmail, prefilter, remoteLocationOk, truncate } from './lib/text';
import { nextStep, isBusinessHours, localDate, localHour } from './lib/followup';
import { matchApplication, senderAddress } from './lib/match';
import { connectedEmail, getAttachment, getMessage, gmailStatus, listMessages, sendEmail } from './lib/gmail';
import { docxToText } from './lib/unzip';
import { docFilename, DOCX_MIME, markdownToDocxBase64 } from './lib/docx';
import { fetchAllSources, type SourceReport } from './sources';
import { addFeedback, getLessons, getTaste, learnFromFeedback, learningPending } from './learning';
import { sendDigest } from './digest';
import { AI_DOWN_MESSAGE, alertFromError, isAiServiceDown, notifyAlerts, raiseAlert, resolveAlerts, testModeUntil } from './alerts';
import { markdownToPdfBase64, PDF_MIME, pdfFilename } from './lib/pdf';
import { suggestTimes } from './lib/calendar';
import { checkStillOpen, researchCompany } from './career';
import type { RawJob } from './sources/types';
import type { Prefs } from './lib/prefs';

const ACTIVE = ['submitted', 'following_up', 'interviewing', 'offer'];
const KEYWORD_SEARCHED = new Set(['adzuna', 'usajobs', 'web_scout', 'manual', 'jooble', 'google_jobs']);

async function recentExamples(env: Env): Promise<VoiceExample[]> {
  const { results } = await env.DB.prepare('SELECT kind, before_text, after_text FROM voice_examples WHERE user_id = ? ORDER BY id DESC LIMIT 6').bind(U(env)).all<VoiceExample>();
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
  const { results: docs } = await env.DB.prepare('SELECT kind, title, content FROM documents WHERE user_id = ? AND use_for_voice = 1 ORDER BY created_at DESC').bind(U(env)).all<{ kind: string; title: string; content: string }>();
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
    purpose: 'Learning your voice', instructions: LEARN_INSTRUCTIONS, user, schema: LEARN_SCHEMA, effort: 'high', mock: () => learnMock(docs.length),
  });
  const { suggested, ...voice } = result;
  await setSetting(env, 'voice', { ...voice, learned_at: new Date().toISOString() });

  // Fill in any search settings she hasn't set yet from what the documents say. Never overwrite hers.
  const prefs = await getPrefs(env);
  const filled = {
    ...prefs,
    name: prefs.name || suggested.full_name,
    phone: prefs.phone || suggested.phone,
    home_location: prefs.home_location || suggested.home_location,
    target_roles: prefs.target_roles.length ? prefs.target_roles : suggested.target_roles.slice(0, 6),
  };
  await setSetting(env, 'prefs', filled);
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
  const screened: boolean[] = [];
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
    if (!reason && abroadOnly(`${j.title} | ${j.location ?? ''}`)) reason = 'outside the U.S.';
    screened.push(!!reason);
    stmts.push(env.DB.prepare(
      `INSERT OR IGNORE INTO jobs (user_id, source, external_id, dedupe_key, url, apply_url, title, company, location, work_mode, salary, description, posted_at, application_email, status, fit_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      U(env), j.source, j.external_id.slice(0, 500), key, j.url, j.apply_url ?? null, j.title.slice(0, 300), j.company.slice(0, 200), j.location,
      j.work_mode, j.salary ?? null, j.description.slice(0, 60_000), j.posted_at ?? null,
      j.application_email ?? extractApplicationEmail(j.description), reason ? 'filtered' : 'new', reason ? `Skipped: ${reason}` : null,
    ));
  }
  for (let i = 0; i < stmts.length; i += 50) {
    const res = await env.DB.batch(stmts.slice(i, i + 50));
    // Count only postings that are new to her (already-seen ones are ignored by the insert).
    res.forEach((r, k) => {
      if (!r.meta.changes) return;
      if (screened[i + k]) screenedOut++;
      else added++;
    });
  }
  return { added, screenedOut };
}

export async function scoreJob(env: Env, jobId: number): Promise<ScoreResult> {
  const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').bind(jobId, U(env)).first<JobRow>();
  if (!job) throw new AIError('Job not found');
  const [prefs, voice, taste] = await Promise.all([getPrefs(env), getVoiceForPrompts(env), getTaste(env)]);
  const r = await aiJSON<ScoreResult>(env, {
    context: careerContext(voice, prefs, taste),
    purpose: 'Checking job fit', instructions: SCORE_INSTRUCTIONS,
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
     WHERE id = ? AND user_id = ?`,
  ).bind(score, label, r.summary, JSON.stringify(r), r.apply_method, r.application_email, r.salary, r.work_mode, jobId, U(env)).run();
  // Only jobs worth her time are recommended (and need her 👍/👎); the rest are screened out, still viewable.
  if (score < prefs.min_fit_to_recommend) {
    await env.DB.prepare("UPDATE jobs SET status = 'filtered' WHERE id = ? AND user_id = ? AND status = 'new' AND vote IS NULL").bind(jobId, U(env)).run();
  }
  return { ...r, fit_score: score };
}

/**
 * With hundreds of new postings and a daily limit on fit checks, check the likeliest ones first: the
 * title is one of her target roles, then in-person/hybrid nearby (fewer of those exist), then newest.
 */
export function rankForScoring<T extends { title: string; work_mode: string; at: string }>(jobs: T[], prefs: Prefs): T[] {
  const targets = prefs.target_roles.map((t) => t.trim().toLowerCase()).filter(Boolean);
  const score = (j: T) => {
    const t = j.title.toLowerCase();
    const title = targets.some((r) => t.includes(r)) ? 2 : targets.some((r) => r.split(/\s+/).filter((w) => w.length > 2).every((w) => t.includes(w))) ? 1 : 0;
    return title * 10 + (j.work_mode !== 'remote' ? 3 : 0);
  };
  return [...jobs].sort((a, b) => score(b) - score(a) || (b.at ?? '').localeCompare(a.at ?? ''));
}

export async function scorePending(env: Env, max: number): Promise<number> {
  const { results: pool } = await env.DB.prepare(
    "SELECT id, title, work_mode, COALESCE(posted_at, found_at) AS at FROM jobs WHERE user_id = ? AND status = 'new' AND fit_score IS NULL ORDER BY COALESCE(posted_at, found_at) DESC LIMIT 400",
  ).bind(U(env)).all<{ id: number; title: string; work_mode: string; at: string }>();
  const results = rankForScoring(pool, await getPrefs(env)).slice(0, max);
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
  if (await learningPending(env)) await learnFromFeedback(env).catch((e) => logActivity(env, 'error', `Learning: ${e instanceof Error ? e.message : e}`));
  const [prefs, voice, taste] = await Promise.all([getPrefs(env), getVoiceForPrompts(env), getTaste(env)]);
  const { jobs, report } = await fetchAllSources(env, prefs, voice, taste);
  const { added, screenedOut } = await ingestJobs(env, jobs);
  const scored = await scorePending(env, prefs.autopilot.max_scores_per_run);
  const prepared = await autoPrepare(env);
  await setSetting(env, 'last_search', { at: new Date().toISOString(), report, seen: jobs.length, added, screenedOut, scored, prepared });
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
  const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').bind(jobId, U(env)).first<JobRow>();
  if (!job) throw new AIError('Job not found');
  const [prefs, voice, examples, lessons] = await Promise.all([getPrefs(env), getVoiceForPrompts(env), recentExamples(env), getLessons(env)]);
  if (!voice.career_record) throw new AIError('Upload her resume and click "Learn my voice" first — drafts can only use facts from her career record.');

  let app = await env.DB.prepare("SELECT * FROM applications WHERE job_id = ? AND user_id = ? AND status NOT IN ('withdrawn') ORDER BY id DESC LIMIT 1").bind(jobId, U(env)).first<AppRow>();
  const previous = app && opts.feedback ? { resume_md: app.resume_md ?? '', cover_letter_md: app.cover_letter_md ?? '', email_body: app.email_body ?? '' } : undefined;
  const fit = job.fit_json ? (JSON.parse(job.fit_json) as ScoreResult) : null;

  const d = await aiJSON<DraftResult>(env, {
    context: writingContext(voice, prefs, examples, lessons),
    purpose: 'Writing an application', instructions: DRAFT_INSTRUCTIONS,
    user: draftUser(job, fit, opts.feedback, previous),
    schema: DRAFT_SCHEMA,
    effort: 'high',
    mock: () => draftMock(job, prefs, opts.feedback),
  });

  const method = applyMethodFor(job);
  if (!app) {
    const res = await env.DB.prepare(
      `INSERT INTO applications (user_id, job_id, status, apply_method, contact_email) VALUES (?, ?, 'drafting', ?, ?)`,
    ).bind(U(env), jobId, method, job.application_email).run();
    app = (await env.DB.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').bind(res.meta.last_row_id, U(env)).first<AppRow>())!;
    await addEvent(env, app.id, 'created', opts.by === 'autopilot' ? `Autopilot started an application (fit ${job.fit_score ?? '?'})` : 'Started an application');
    await env.DB.prepare("UPDATE jobs SET status = 'applying' WHERE id = ? AND user_id = ?").bind(jobId, U(env)).run();
  }
  const isSubmitted = ACTIVE.includes(app.status) || ['won', 'rejected', 'closed'].includes(app.status);
  await env.DB.prepare(
    `UPDATE applications SET resume_md = ?, cover_letter_md = ?, email_subject = ?, email_body = ?, form_answers = ?, ai_notes = ?,
       status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
  ).bind(d.resume_md, d.cover_letter_md, d.email_subject, d.email_body, JSON.stringify(d.form_answers), d.notes_for_her,
    isSubmitted ? app.status : 'ready', app.id, U(env)).run();
  await addEvent(env, app.id, 'drafted', opts.feedback ? `Rewrote the drafts: “${truncate(opts.feedback, 120)}”` : 'Wrote a tailored resume, cover letter, and email');
  if (opts.feedback) {
    // "Make it warmer" should apply to every future draft, not just this one.
    await addFeedback(env, { sentiment: 'bad', about: 'application', application_id: app.id, context: `Draft for ${job.title} at ${job.company}`, text: opts.feedback });
  }
  if (!job.vote) await env.DB.prepare("UPDATE jobs SET vote = 1, vote_reason = COALESCE(vote_reason, 'She chose to apply'), voted_at = datetime('now') WHERE id = ? AND user_id = ?").bind(jobId, U(env)).run();

  // Autopilot may send email applications on its own — only if she turned that on.
  if (opts.by === 'autopilot' && method === 'email' && prefs.autopilot.auto_send_applications && !isSubmitted) {
    await queueApplication(env, app.id, 'autopilot');
  }
  return (await env.DB.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').bind(app.id, U(env)).first<AppRow>())!;
}

export async function autoPrepare(env: Env): Promise<number> {
  const prefs = await getPrefs(env);
  const t = prefs.autopilot.auto_prepare_threshold;
  if (!t) return 0;
  const voice = await getVoiceForPrompts(env);
  if (!voice.career_record) return 0;
  // Applications are only written for jobs she gave a 👍.
  const { results } = await env.DB.prepare(
    `SELECT j.id FROM jobs j WHERE j.user_id = ? AND j.vote = 1 AND j.status = 'shortlisted'
       AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id) ORDER BY j.voted_at LIMIT 5`,
  ).bind(U(env)).all<{ id: number }>();
  let n = 0;
  for (const { id } of results) {
    try {
      // Before writing: is the posting still up, and is the company worth her time?
      if ((await checkStillOpen(env, id)) === false) {
        await env.DB.prepare("UPDATE jobs SET status = 'dismissed', fit_summary = 'This posting has closed.' WHERE id = ? AND user_id = ?").bind(id, U(env)).run();
        continue;
      }
      const j = await env.DB.prepare('SELECT company_report FROM jobs WHERE id = ? AND user_id = ?').bind(id, U(env)).first<{ company_report: string | null }>();
      if (!j?.company_report) await researchCompany(env, id).catch((e) => logActivity(env, 'error', `Company check: ${e instanceof Error ? e.message : e}`));
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
  const app = await env.DB.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').bind(appId, U(env)).first<AppRow>();
  if (!app) throw new Error('Application not found');
  if (!app.contact_email) throw new Error('Add the employer’s email address first.');
  if (!app.email_subject || !app.email_body) throw new Error('The email draft is empty.');
  if (by === 'her' && !(await gmailStatus(env)).connected) throw new Error('Connect Gmail in Settings first, so the app can send from your address.');
  await env.DB.prepare("UPDATE outbox SET status = 'cancelled' WHERE application_id = ? AND user_id = ? AND kind = 'application' AND status IN ('pending','approved')").bind(appId, U(env)).run();
  const res = await env.DB.prepare(
    `INSERT INTO outbox (user_id, application_id, kind, to_email, subject, body, attach_resume, attach_cover_letter, status, approved_by)
     VALUES (?, ?, 'application', ?, ?, ?, 1, 1, 'approved', ?)`,
  ).bind(U(env), appId, app.contact_email, app.email_subject, app.email_body, by).run();
  return res.meta.last_row_id as number;
}

// ------------------------------------------------------------------ sending

export async function sendOutboxItem(env: Env, id: number): Promise<OutboxRow> {
  const row = await env.DB.prepare('SELECT * FROM outbox WHERE id = ? AND user_id = ?').bind(id, U(env)).first<OutboxRow & { thread_id: string | null; in_reply_to: string | null }>();
  if (!row) throw new Error('Message not found');
  if (row.status === 'sent') return row;
  if (!row.to_email) throw new Error('This message has no recipient yet.');
  const prefs = await getPrefs(env);
  const app = row.application_id ? await env.DB.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').bind(row.application_id, U(env)).first<AppRow>() : null;
  const testUntil = await testModeUntil(env);
  try {
    const attachments: { filename: string; mimeType: string; base64: string }[] = [];
    const fmt = prefs.attachment_format;
    const add = async (md: string, kind: 'resume' | 'letter', what: string) => {
      if (fmt !== 'docx') attachments.push({ filename: pdfFilename(prefs.name, what), mimeType: PDF_MIME, base64: await markdownToPdfBase64(md, kind) });
      if (fmt !== 'pdf') attachments.push({ filename: docFilename(prefs.name, what), mimeType: DOCX_MIME, base64: await markdownToDocxBase64(md, kind) });
    };
    if (app && row.attach_resume && app.resume_md) await add(app.resume_md, 'resume', 'Resume');
    if (app && row.attach_cover_letter && app.cover_letter_md) await add(app.cover_letter_md, 'letter', 'Cover_Letter');
    if (testUntil) {
      // First-week test mode: the message goes to her own inbox, exactly as the employer would see it.
      const me = (await connectedEmail(env)) ?? row.to_email;
      await sendEmail(env, {
        fromName: prefs.name, to: me, subject: `[TEST — would go to ${row.to_email}] ${row.subject}`,
        text: `This is a test copy. Test mode is on until ${testUntil.slice(0, 10)} — nothing was sent to the employer.\nTurn test mode off in Settings when you're happy with how these look.\n\n-----\n\n${row.body}`,
        attachments,
      });
      await env.DB.prepare("UPDATE outbox SET status = 'sent', sent_at = datetime('now'), error = 'Test mode — sent to you' WHERE id = ? AND user_id = ?").bind(id, U(env)).run();
      if (app) await addEvent(env, app.id, 'test', `Test mode: sent a copy of the ${row.kind.replace('_', ' ')} to you instead of ${row.to_email}`);
      return (await env.DB.prepare('SELECT * FROM outbox WHERE id = ? AND user_id = ?').bind(id, U(env)).first<OutboxRow>())!;
    }
    const sent = await sendEmail(env, {
      fromName: prefs.name,
      to: row.to_email,
      subject: row.subject,
      text: row.body,
      threadId: row.thread_id ?? (row.kind !== 'application' ? app?.gmail_thread_id : null),
      inReplyTo: row.in_reply_to ?? (row.kind !== 'application' ? app?.rfc_message_id : null),
      attachments,
    });
    await env.DB.prepare("UPDATE outbox SET status = 'sent', sent_at = datetime('now'), error = NULL WHERE id = ? AND user_id = ?").bind(id, U(env)).run();
    await resolveAlerts(env, 'send');
    if (app) await afterContact(env, app, row.kind, row.to_email, { threadId: sent.threadId, messageId: sent.messageId, subject: row.subject });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await env.DB.prepare("UPDATE outbox SET status = 'failed', error = ? WHERE id = ? AND user_id = ?").bind(msg.slice(0, 500), id, U(env)).run();
    if (app) await addEvent(env, app.id, 'error', `Couldn't send ${row.kind.replace('_', ' ')}: ${msg.slice(0, 200)}`);
    await alertFromError(env, 'send', e);
    throw e;
  }
  return (await env.DB.prepare('SELECT * FROM outbox WHERE id = ? AND user_id = ?').bind(id, U(env)).first<OutboxRow>())!;
}

/** Update the application after any contact she made (sent by the app, or done by hand). */
export async function afterContact(env: Env, app: AppRow, kind: string, to: string | null, mail?: { threadId?: string; messageId?: string | null; subject?: string }): Promise<void> {
  if (kind === 'application') {
    await env.DB.prepare(
      `UPDATE applications SET status = 'submitted', submitted_at = COALESCE(submitted_at, datetime('now')), last_contact_at = datetime('now'),
         gmail_thread_id = COALESCE(?, gmail_thread_id), rfc_message_id = COALESCE(?, rfc_message_id), updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    ).bind(mail?.threadId ?? null, mail?.messageId ?? null, app.id, U(env)).run();
    // Any other unsent copy of the application email is now moot.
    await env.DB.prepare("UPDATE outbox SET status = 'cancelled' WHERE application_id = ? AND user_id = ? AND kind = 'application' AND status IN ('pending','approved','failed')").bind(app.id, U(env)).run();
    await env.DB.prepare("UPDATE jobs SET status = 'applying' WHERE id = ? AND user_id = ?").bind(app.job_id, U(env)).run();
    await addEvent(env, app.id, 'submitted', to ? `Application emailed to ${to}` : 'Application submitted');
  } else if (kind === 'follow_up') {
    await env.DB.prepare(
      `UPDATE applications SET follow_up_count = follow_up_count + 1, last_contact_at = datetime('now'),
         status = CASE WHEN status = 'submitted' THEN 'following_up' ELSE status END,
         rfc_message_id = COALESCE(?, rfc_message_id), gmail_thread_id = COALESCE(gmail_thread_id, ?), updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    ).bind(mail?.messageId ?? null, mail?.threadId ?? null, app.id, U(env)).run();
    await addEvent(env, app.id, 'follow_up_sent', to ? `Follow-up sent to ${to}` : 'Followed up');
  } else {
    await env.DB.prepare("UPDATE applications SET last_contact_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND user_id = ?").bind(app.id, U(env)).run();
    await addEvent(env, app.id, 'reply_sent', to ? `Replied to ${to}` : 'Replied');
  }
}

async function sendApproved(env: Env): Promise<number> {
  const tz = env.TIMEZONE || 'America/Los_Angeles';
  // Her own approvals send right away from the API; anything still approved here was queued by
  // autopilot (or failed earlier) and only goes out during business hours.
  if (!isBusinessHours(new Date(), tz)) return 0;
  const { results } = await env.DB.prepare("SELECT id FROM outbox WHERE user_id = ? AND status = 'approved' ORDER BY id LIMIT 10").bind(U(env)).all<{ id: number }>();
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
  const { results } = await env.DB.prepare('SELECT created_at, summary FROM app_events WHERE application_id = ? AND user_id = ? ORDER BY id').bind(appId, U(env)).all<{ created_at: string; summary: string }>();
  return results.map((e) => `- ${e.created_at.slice(0, 10)}: ${e.summary}`).join('\n');
}

export async function processFollowUps(env: Env, now = new Date()): Promise<{ drafted: number; closed: number }> {
  const prefs = await getPrefs(env);
  const { results: apps } = await env.DB.prepare(
    `SELECT a.*, j.title, j.company FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.user_id = ? AND a.status IN ('submitted','following_up','interviewing')
       AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.application_id = a.id AND o.kind != 'application' AND o.status IN ('pending','approved','failed'))`,
  ).bind(U(env)).all<AppRow & { title: string; company: string }>();
  let drafted = 0;
  let closed = 0;
  for (const app of apps) {
    const step = nextStep(app, now, prefs.autopilot);
    if (step.type === 'close') {
      await env.DB.prepare("UPDATE applications SET status = 'closed', closed_reason = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").bind(step.reason, app.id, U(env)).run();
      await addEvent(env, app.id, 'status', `Closed: ${step.reason}`);
      closed++;
      continue;
    }
    if (step.type !== 'follow_up') continue;
    try {
      const msg = await draftFollowUp(env, app, step.number, step.kind);
      const auto = prefs.autopilot.auto_send_follow_ups && !!app.contact_email;
      await env.DB.prepare(
        `INSERT INTO outbox (user_id, application_id, kind, to_email, subject, body, status, approved_by, thread_id, in_reply_to, notes_for_her)
         VALUES (?, ?, 'follow_up', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(U(env), app.id, app.contact_email, msg.subject, msg.body, auto ? 'approved' : 'pending', auto ? 'autopilot' : null,
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
  const [prefs, voice, examples, lessons] = await Promise.all([getPrefs(env), getVoiceForPrompts(env), recentExamples(env), getLessons(env)]);
  const ctx = { title: app.title, company: app.company, submitted_at: app.submitted_at, subject: app.apply_method === 'email' ? app.email_subject : null, number, kind, history: await historyText(env, app.id) };
  return aiJSON<MessageResult>(env, {
    context: writingContext(voice, prefs, examples, lessons),
    purpose: 'Writing a follow-up', instructions: FOLLOW_UP_INSTRUCTIONS,
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
    `SELECT a.*, j.title, j.company FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.user_id = ? AND a.status IN ('submitted','following_up','interviewing','offer')`,
  ).bind(U(env)).all<AppRow & { title: string; company: string }>();

  let checked = 0;
  let matched = 0;
  let learnFromEmail = false;
  for (const { id } of ids) {
    if (await env.DB.prepare('SELECT 1 FROM inbox_seen WHERE user_id = ? AND gmail_id = ?').bind(U(env), id).first()) continue;
    checked++;
    const mail = await getMessage(env, id);
    if (senderAddress(mail.from) === me) {
      await env.DB.prepare('INSERT OR IGNORE INTO inbox_seen (user_id, gmail_id) VALUES (?, ?)').bind(U(env), id).run();
      // She replied to the morning email → that's feedback for the app.
      if (/^re:.*your job search today/i.test(mail.subject)) {
        const note = cleanEmailBody(mail.body).trim();
        if (note) {
          await addFeedback(env, { sentiment: 'note', about: 'digest', context: 'Her reply to the morning email', text: note });
          learnFromEmail = true;
        }
      }
      continue;
    }
    const app = matchApplication(mail, apps) as (AppRow & { title: string; company: string }) | null;
    if (!app) {
      await env.DB.prepare('INSERT OR IGNORE INTO inbox_seen (user_id, gmail_id) VALUES (?, ?)').bind(U(env), id).run();
      continue;
    }
    const c = await aiJSON<ClassifyResult>(env, {
      purpose: 'Reading an employer email', instructions: CLASSIFY_INSTRUCTIONS,
      user: classifyUser(app, mail),
      schema: CLASSIFY_SCHEMA,
      effort: 'low',
      maxTokens: 4000,
      mock: () => classifyMock(mail),
    });
    await env.DB.prepare('INSERT OR IGNORE INTO inbox_seen (user_id, gmail_id, application_id, category) VALUES (?, ?, ?, ?)').bind(U(env), id, c.related ? app.id : null, c.category).run();
    if (!c.related) continue;
    matched++;
    await handleReply(env, app, mail, c);
  }
  await setSetting(env, 'inbox_sync', { at: startedAt });
  if (learnFromEmail) await learnFromFeedback(env);
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
       updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
  ).bind(newStatus ?? null, reset ? 1 : 0, newStatus ?? '', c.summary, human ? sender : null, human ? mail.threadId : null, human ? mail.messageId : null, app.id, U(env)).run();
  if (c.category === 'rejection' || c.category === 'interview' || c.category === 'offer') {
    // Pending follow-ups are moot now.
    await env.DB.prepare("UPDATE outbox SET status = 'cancelled' WHERE application_id = ? AND user_id = ? AND kind = 'follow_up' AND status IN ('pending','approved')").bind(app.id, U(env)).run();
  }
  if (newStatus) await addEvent(env, app.id, 'status', `Status → ${newStatus.replace('_', ' ')}`);

  if (c.needs_response && human) {
    const times = c.category === 'interview' ? await suggestTimes(env, env.TIMEZONE || 'America/Los_Angeles').catch(() => [] as string[]) : [];
    const [prefs, voice, examples, lessons] = await Promise.all([getPrefs(env), getVoiceForPrompts(env), recentExamples(env), getLessons(env)]);
    const r = await aiJSON<MessageResult>(env, {
      context: writingContext(voice, prefs, examples, lessons),
      purpose: 'Drafting a reply', instructions: REPLY_INSTRUCTIONS,
      user: `Her application: ${app.title} at ${app.company}\n\n${classifyUser(app, mail).split('\n\n').slice(1).join('\n\n')}${times.length ? `\n\nTimes she is free (from her calendar) — offer two or three of these if they want to schedule:\n${times.map((t) => `- ${t}`).join('\n')}` : ''}`,
      schema: MESSAGE_SCHEMA,
      effort: 'medium',
      maxTokens: 8000,
      mock: () => ({ subject: `Re: ${mail.subject}`, body: `Hi,\n\nThank you so much — I'd be glad to. I'm generally available weekdays; please let me know what works for you.\n\nThanks so much,\n${prefs.name}`, notes_for_her: 'Confirm your availability before sending.' }),
    });
    // Replies to a real person always wait for her OK, even on autopilot.
    await env.DB.prepare(
      `INSERT INTO outbox (user_id, application_id, kind, to_email, subject, body, status, thread_id, in_reply_to, notes_for_her) VALUES (?, ?, 'reply', ?, ?, ?, 'pending', ?, ?, ?)`,
    ).bind(U(env), app.id, sender, r.subject, r.body, mail.threadId, mail.messageId, r.notes_for_her).run();
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
    const exists = await env.DB.prepare("SELECT 1 FROM documents WHERE user_id = ? AND kind = 'email' AND filename = ?").bind(U(env), `gmail:${id}`).first();
    if (exists) continue;
    await env.DB.prepare("INSERT INTO documents (user_id, kind, title, content, filename) VALUES (?, 'email', ?, ?, ?)")
      .bind(U(env), `Sent email: ${m.subject || '(no subject)'}`.slice(0, 200), body.slice(0, 20000), `gmail:${id}`).run();
    n++;
  }
  return n;
}

const RESUME_NAME = /(resume|résumé|cv\b|curriculum|cover[\s_-]*letter)/i;

/** Resumes and cover letters she has emailed before are already in her Gmail — pull in the newest few. */
export async function importGmailDocuments(env: Env, maxFiles = 5): Promise<number> {
  const ids = await listMessages(env, 'has:attachment {filename:pdf filename:docx} {resume résumé cv "cover letter" filename:resume filename:cv} newer_than:6y', 25);
  const seen = new Set<string>();
  let n = 0;
  for (const { id } of ids) {
    if (n >= maxFiles) break;
    const m = await getMessage(env, id);
    for (const a of m.attachments) {
      if (n >= maxFiles) break;
      const name = a.filename;
      const ext = name.toLowerCase().split('.').pop();
      if (!RESUME_NAME.test(name) || (ext !== 'pdf' && ext !== 'docx')) continue;
      const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/\d+/g, '');
      if (seen.has(key)) continue; // newest copy of each file only
      seen.add(key);
      if (await env.DB.prepare('SELECT 1 FROM documents WHERE user_id = ? AND filename = ?').bind(U(env), `gmail:${id}:${name}`).first()) continue;
      try {
        const bytes = await getAttachment(env, id, a.attachmentId);
        if (bytes.length > 10_000_000) continue;
        const text = ext === 'docx' ? await docxToText(bytes) : await extractPdfText(env, bytesToBase64(bytes));
        if (text.length < 200) continue;
        const kind = /cover/i.test(name) ? 'cover_letter' : 'resume';
        await env.DB.prepare('INSERT INTO documents (user_id, kind, title, content, filename) VALUES (?, ?, ?, ?, ?)')
          .bind(U(env), kind, `${name.replace(/\.[^.]+$/, '')} (from email, ${m.date.slice(0, 10)})`, text.slice(0, 200_000), `gmail:${id}:${name}`).run();
        n++;
      } catch (e) {
        await logActivity(env, 'error', `Couldn't read ${name}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  return n;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ------------------------------------------------------------------ first sign-in setup

export const ONBOARD_STEPS = ['emails', 'documents', 'learn', 'search'] as const;
export type OnboardStep = (typeof ONBOARD_STEPS)[number];
export interface OnboardState { done: boolean; steps: Partial<Record<OnboardStep, { ok: boolean; note: string }>> }

export async function getOnboarding(env: Env): Promise<OnboardState> {
  return (await getSetting<OnboardState>(env, 'onboarding')) ?? { done: false, steps: {} };
}

/** One step of the first-time setup. The web app calls these in order and shows progress. */
export async function runOnboardStep(env: Env, step: OnboardStep): Promise<OnboardState> {
  const state = await getOnboarding(env);
  let note = '';
  let ok = true;
  try {
    if (step === 'emails') {
      const n = (await gmailStatus(env)).connected ? await importSentEmails(env, 30) : 0;
      note = n ? `Read ${n} emails you’ve written` : 'No sent emails to learn from';
    } else if (step === 'documents') {
      const n = (await gmailStatus(env)).connected ? await importGmailDocuments(env) : 0;
      note = n ? `Found ${n} resume${n === 1 ? '' : 's'} or cover letter${n === 1 ? '' : 's'} in your email` : 'No resumes found in your email — you can add one on the My Writing page';
    } else if (step === 'learn') {
      const docs = await env.DB.prepare('SELECT COUNT(*) AS n FROM documents WHERE user_id = ?').bind(U(env)).first<{ n: number }>();
      if (docs?.n) {
        await learnVoice(env);
        note = 'Learned your work history and how you write';
      } else {
        ok = false;
        note = 'Nothing to learn from yet — add your resume on the My Writing page';
      }
    } else if (step === 'search') {
      const prefs = await getPrefs(env);
      if (!(await getVoiceForPrompts(env)).career_record || !prefs.home_location) {
        ok = false;
        note = 'Skipped the first search until your resume and town are in';
      } else {
        const r = await runSearch(env);
        note = `Looked through job listings and found ${r.added} new ones`;
      }
    }
  } catch (e) {
    ok = false;
    note = e instanceof Error ? e.message : String(e);
    if (isAiServiceDown(e)) {
      note = AI_DOWN_MESSAGE;
      await alertFromError(env, `onboarding: ${step}`, e).catch(() => {});
    }
  }
  state.steps[step] = { ok, note };
  if (step === ONBOARD_STEPS[ONBOARD_STEPS.length - 1]) state.done = true;
  await setSetting(env, 'onboarding', state);
  return state;
}

// ------------------------------------------------------------------ daily digest + cron

export async function runHourly(env: Env): Promise<void> {
  const tz = env.TIMEZONE || 'America/Los_Angeles';
  const now = new Date();
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      await alertFromError(env, name, e);
    }
  };
  await step('send', () => sendApproved(env));
  await step('inbox', async () => { await syncInbox(env); await resolveAlerts(env, 'gmail'); });
  await step('follow-ups', () => processFollowUps(env, now));
  await step('learn', async () => { if (await learningPending(env)) await learnFromFeedback(env); });
  await step('drafts', () => autoPrepare(env)); // jobs she 👍'd get their application written within the hour
  const prefs = await getPrefs(env);
  const today = localDate(now, tz);
  const lastDaily = await getSetting<string>(env, 'last_daily');
  if (lastDaily !== today && localHour(now, tz) >= prefs.autopilot.daily_hour) {
    await setSetting(env, 'last_daily', today);
    if (prefs.autopilot.daily_search) await step('search', async () => { await runSearch(env); for (const k of ['credit', 'cap', 'stalled'] as const) await resolveAlerts(env, k); });
    if (prefs.autopilot.daily_digest) await step('digest', () => sendDigest(env));
  }
  // Nothing has happened for two days? Someone should know.
  const last = await getSetting<{ at: string }>(env, 'last_search');
  if (prefs.autopilot.daily_search && last && Date.now() - new Date(last.at).getTime() > 2.5 * 86_400_000) {
    await raiseAlert(env, 'stalled', `No job search has run since ${last.at.slice(0, 10)}. Check the Today page for a warning (Gmail, credit, or settings).`);
  }
  await step('alerts', () => notifyAlerts(env));
}

/** The hourly cron: every active account in turn, inside a time budget (unfinished accounts go next hour). */
export async function runCron(env: Env): Promise<void> {
  const started = Date.now();
  const budget = 12 * 60_000; // Workers cron wall-clock limit is 15 minutes
  const { results } = await env.DB.prepare(
    `SELECT u.id FROM users u WHERE u.status = 'active'
       AND (EXISTS (SELECT 1 FROM settings s WHERE s.user_id = u.id AND s.key = 'google') OR EXISTS (SELECT 1 FROM settings s WHERE s.user_id = u.id AND s.key = 'voice'))
     ORDER BY COALESCE((SELECT updated_at FROM settings s WHERE s.user_id = u.id AND s.key = 'last_daily'), '') ASC`,
  ).all<{ id: number }>();
  for (const { id } of results) {
    if (Date.now() - started > budget) break;
    try {
      await runHourly({ ...env, uid: id });
    } catch (e) {
      await logActivity({ ...env, uid: id }, 'error', `cron: ${e instanceof Error ? e.message : e}`);
    }
  }
  await env.DB.prepare("DELETE FROM activity_log WHERE created_at < datetime('now','-60 days')").run();
}

export async function extractPdfText(env: Env, base64: string): Promise<string> {
  return aiText(env, {
    purpose: 'Reading a PDF', instructions: PDF_TEXT_INSTRUCTIONS,
    user: [pdfBlock(base64), { type: 'text', text: 'Transcribe this document.' }],
    effort: 'low',
    mock: () => '(Mock PDF text) Linda Example — Office Manager, Gorge Family Dental, 2014–2024.',
  });
}
