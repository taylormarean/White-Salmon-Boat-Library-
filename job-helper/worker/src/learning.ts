// How the app learns from her: 👍/👎 on every recommended job, and feedback on anything it did.
// Votes act immediately (status, blocked employers) and, with her feedback, are distilled by Claude
// into short lessons that go into every future fit check, web search, and draft.
import type { Env } from './env';
import { getPrefs, getSetting, logActivity, setSetting, type JobRow } from './lib/db';
import { aiJSON } from './lib/ai';
import { LESSONS_INSTRUCTIONS, LESSONS_SCHEMA, lessonsMock, NO_LESSONS, type Lessons, type LessonsResult, type Taste } from './lib/prompts';
import { normalize, truncate } from './lib/text';

export const DOWN_REASONS: Record<string, string> = {
  not_my_kind: 'Not the kind of work I want',
  too_senior: 'Needs experience or skills I don’t have',
  too_junior: 'Too junior for me',
  pay: 'Pay is too low',
  location: 'Too far / wrong location',
  company: 'Don’t want to work for this company',
  schedule: 'Hours or schedule don’t work',
  other: 'Something else',
};
export const UP_REASONS: Record<string, string> = {
  role: 'The kind of work I want',
  company: 'Great company',
  pay: 'Good pay',
  remote: 'Location / remote works for me',
  other: 'Something else',
};

export async function getLessons(env: Env): Promise<Lessons> {
  return (await getSetting<Lessons>(env, 'lessons')) ?? NO_LESSONS;
}

/** Lessons + her most recent votes, formatted for the prompts. */
export async function getTaste(env: Env): Promise<Taste> {
  const lessons = await getLessons(env);
  const { results } = await env.DB.prepare(
    'SELECT title, company, location, work_mode, salary, vote, vote_reason FROM jobs WHERE vote IS NOT NULL ORDER BY voted_at DESC LIMIT 60',
  ).all<{ title: string; company: string; location: string | null; work_mode: string; salary: string | null; vote: number; vote_reason: string | null }>();
  const fmt = (j: (typeof results)[number]) =>
    `${j.title} — ${j.company} (${[j.work_mode, j.location, j.salary].filter(Boolean).join(', ')})${j.vote_reason ? ` — “${truncate(j.vote_reason, 160)}”` : ''}`;
  return {
    lessons,
    liked: results.filter((j) => j.vote > 0).slice(0, 25).map(fmt),
    disliked: results.filter((j) => j.vote < 0).slice(0, 35).map(fmt),
  };
}

export interface VoteInput { vote: 1 | -1; reason?: string; note?: string }

export function describeVote(v: VoteInput): string {
  const label = v.reason ? (v.vote > 0 ? UP_REASONS : DOWN_REASONS)[v.reason] ?? '' : '';
  return [label, v.note?.trim()].filter(Boolean).join(': ');
}

/** Record her 👍/👎. Returns what changed so the UI can tell her. */
export async function voteJob(env: Env, jobId: number, v: VoteInput): Promise<{ blockedCompany: string | null; withdrew: boolean }> {
  const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(jobId).first<JobRow>();
  if (!job) throw new Error('Job not found');
  const reason = describeVote(v).slice(0, 1000) || null;
  const status = v.vote > 0 ? (job.status === 'applying' ? 'applying' : 'shortlisted') : 'dismissed';
  await env.DB.prepare("UPDATE jobs SET vote = ?, vote_reason = ?, voted_at = datetime('now'), status = ? WHERE id = ?").bind(v.vote, reason, status, jobId).run();

  let blockedCompany: string | null = null;
  let withdrew = false;
  if (v.vote < 0) {
    // 👎 "this company" → never show that employer again.
    if (v.reason === 'company') {
      const prefs = await getPrefs(env);
      if (!prefs.exclude_companies.some((c) => normalize(c) === normalize(job.company))) {
        await setSetting(env, 'prefs', { ...prefs, exclude_companies: [...prefs.exclude_companies, job.company] });
      }
      await env.DB.prepare("UPDATE jobs SET status = 'dismissed' WHERE status = 'new' AND vote IS NULL AND lower(company) = lower(?)").bind(job.company).run();
      blockedCompany = job.company;
    }
    // A draft she hasn't sent yet for a job she now dislikes is withdrawn.
    const res = await env.DB.prepare("UPDATE applications SET status = 'withdrawn', closed_reason = 'She gave the job a thumbs-down', updated_at = datetime('now') WHERE job_id = ? AND status IN ('drafting','ready')").bind(jobId).run();
    withdrew = (res.meta.changes ?? 0) > 0;
  }
  return { blockedCompany, withdrew };
}

export async function addFeedback(env: Env, f: { sentiment: 'good' | 'bad' | 'note'; about?: string; application_id?: number | null; context?: string | null; text: string }): Promise<number> {
  const res = await env.DB.prepare('INSERT INTO feedback (sentiment, about, application_id, context, text) VALUES (?, ?, ?, ?, ?)')
    .bind(f.sentiment, f.about ?? 'general', f.application_id ?? null, f.context ? truncate(f.context, 2500) : null, f.text.trim().slice(0, 4000)).run();
  return res.meta.last_row_id as number;
}

/** Is there anything new to learn from? (unlearned feedback, or a few votes since the last update) */
export async function learningPending(env: Env): Promise<boolean> {
  const fb = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE learned = 0').first<{ n: number }>();
  if (fb?.n) return true;
  const lessons = await getLessons(env);
  const votes = await env.DB.prepare(
    lessons.updated_at ? 'SELECT COUNT(*) AS n FROM jobs WHERE vote IS NOT NULL AND voted_at > ?' : 'SELECT COUNT(*) AS n FROM jobs WHERE vote IS NOT NULL AND ? IS NULL',
  ).bind(lessons.updated_at ? lessons.updated_at.replace('T', ' ').slice(0, 19) : null).first<{ n: number }>();
  return (votes?.n ?? 0) >= 3;
}

/** Claude rewrites the lessons from everything new she has told the app. Returns its note to her. */
export async function learnFromFeedback(env: Env): Promise<{ reply: string; lessons: Lessons; changes: string[] }> {
  const current = await getLessons(env);
  const prefs = await getPrefs(env);
  const { results: fb } = await env.DB.prepare('SELECT * FROM feedback WHERE learned = 0 ORDER BY id LIMIT 40')
    .all<{ id: number; sentiment: string; about: string; context: string | null; text: string; created_at: string }>();
  const since = current.updated_at ? current.updated_at.replace('T', ' ').slice(0, 19) : '1970-01-01';
  const { results: votes } = await env.DB.prepare(
    'SELECT title, company, location, work_mode, salary, vote, vote_reason FROM jobs WHERE vote IS NOT NULL AND voted_at > ? ORDER BY voted_at DESC LIMIT 60',
  ).bind(since).all<{ title: string; company: string; location: string | null; work_mode: string; salary: string | null; vote: number; vote_reason: string | null }>();

  const user = [
    `<current_lessons>\n${JSON.stringify({ writing: current.writing, job_search: current.job_search, process: current.process }, null, 1)}\n</current_lessons>`,
    `<current_search_settings>\nTarget roles: ${prefs.target_roles.join(', ')}\nFocus: ${prefs.industry_focus}\nExcluded words: ${prefs.exclude_keywords.join(', ') || 'none'}\nExcluded employers: ${prefs.exclude_companies.join(', ') || 'none'}\n</current_search_settings>`,
    fb.length ? `<new_feedback>\n${fb.map((f) => `<item sentiment="${f.sentiment}" about="${f.about}" date="${f.created_at.slice(0, 10)}">\n${f.context ? `<context>${f.context}</context>\n` : ''}Her words: ${f.text}\n</item>`).join('\n')}\n</new_feedback>` : '<new_feedback>(none)</new_feedback>',
    votes.length ? `<new_job_votes>\n${votes.map((v) => `${v.vote > 0 ? '👍' : '👎'} ${v.title} — ${v.company} (${[v.work_mode, v.location, v.salary].filter(Boolean).join(', ')})${v.vote_reason ? ` — her reason: ${v.vote_reason}` : ''}`).join('\n')}\n</new_job_votes>` : '',
  ].filter(Boolean).join('\n\n');

  const r = await aiJSON<LessonsResult>(env, {
    instructions: LESSONS_INSTRUCTIONS, user, schema: LESSONS_SCHEMA, effort: 'medium', maxTokens: 16000, mock: () => lessonsMock(fb),
  });
  const lessons: Lessons = {
    writing: r.writing.slice(0, 12), job_search: r.job_search.slice(0, 12), process: r.process.slice(0, 12), updated_at: new Date().toISOString(),
  };
  await setSetting(env, 'lessons', lessons);

  // Settings changes she clearly asked for.
  const changes: string[] = [];
  const uniq = (arr: string[]) => [...new Map(arr.filter((x) => x.trim()).map((x) => [normalize(x), x.trim()])).values()];
  const next = { ...prefs };
  const addKw = r.add_exclude_keywords.filter((k) => !prefs.exclude_keywords.some((e) => normalize(e) === normalize(k)));
  if (addKw.length) { next.exclude_keywords = uniq([...prefs.exclude_keywords, ...addKw]); changes.push(`Now skipping jobs that mention: ${addKw.join(', ')}`); }
  const addCo = r.add_exclude_companies.filter((k) => !prefs.exclude_companies.some((e) => normalize(e) === normalize(k)));
  if (addCo.length) { next.exclude_companies = uniq([...prefs.exclude_companies, ...addCo]); changes.push(`No more jobs from: ${addCo.join(', ')}`); }
  const removeRoles = r.remove_target_roles.map(normalize);
  const kept = prefs.target_roles.filter((t) => !removeRoles.includes(normalize(t)));
  const addRoles = r.add_target_roles.filter((t) => !kept.some((k) => normalize(k) === normalize(t)));
  if (addRoles.length || kept.length !== prefs.target_roles.length) {
    next.target_roles = uniq([...kept, ...addRoles]).slice(0, 10);
    if (addRoles.length) changes.push(`Also searching for: ${addRoles.join(', ')}`);
    if (kept.length !== prefs.target_roles.length) changes.push(`Stopped searching for: ${prefs.target_roles.filter((t) => !kept.includes(t)).join(', ')}`);
  }
  if (changes.length) await setSetting(env, 'prefs', next);

  if (fb.length) await env.DB.prepare(`UPDATE feedback SET learned = 1 WHERE id IN (${fb.map(() => '?').join(',')})`).bind(...fb.map((f) => f.id)).run();
  await setSetting(env, 'last_learning', { at: lessons.updated_at, reply: r.reply_to_her, changes, feedback: fb.length, votes: votes.length });
  await logActivity(env, 'learn', `Learned from ${fb.length} feedback note${fb.length === 1 ? '' : 's'} and ${votes.length} job vote${votes.length === 1 ? '' : 's'}${changes.length ? ` — ${changes.join('; ')}` : ''}`);
  return { reply: r.reply_to_her, lessons, changes };
}
