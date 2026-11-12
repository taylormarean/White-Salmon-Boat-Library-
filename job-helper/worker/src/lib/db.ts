import type { Env } from '../env';
import { mergePrefs, type Prefs } from './prefs';

/** The account this code is acting for. Every query on personal data filters by it. */
export function U(env: Env): number {
  if (env.uid == null) throw new Error('internal: no account in scope');
  return env.uid;
}

/** A copy of env acting in one account's workspace. */
export function asUser(env: Env, uid: number): Env {
  return { ...env, uid };
}

export async function getSetting<T>(env: Env, key: string): Promise<T | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?').bind(U(env), key).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function setSetting(env: Env, key: string, value: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(U(env), key, JSON.stringify(value)).run();
}

export async function deleteSetting(env: Env, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM settings WHERE user_id = ? AND key = ?').bind(U(env), key).run();
}

/** Business-wide values (not tied to an account). */
export async function getConfig<T>(env: Env, key: string): Promise<T | null> {
  const row = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?').bind(key).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function setConfig(env: Env, key: string, value: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(key, JSON.stringify(value)).run();
}

export async function getPrefs(env: Env): Promise<Prefs> {
  return mergePrefs(await getSetting<Partial<Prefs>>(env, 'prefs'));
}

export interface Voice {
  voice_guide: string;    // how she writes (markdown)
  career_record: string;  // the facts: history, skills, education (markdown) — the ONLY facts drafts may use
  open_questions: string[];
  learned_at: string | null;
}

/** Her questionnaire answers (onboarding) — her own words about skills, goals, and dealbreakers. */
export interface ProfileAnswers {
  recent_role?: string;
  years_experience?: string;
  skills?: string[];
  tools?: string[];
  desired_roles?: string[];
  industries?: string[];
  work_arrangement?: string[];   // remote | hybrid | onsite
  location?: string;
  radius_miles?: number;
  base_min?: number;             // yearly USD
  ote_min?: number;              // on-target earnings (sales)
  schedule?: string;             // full-time / part-time / either
  start?: string;                // when she can start
  dealbreakers?: string;
  proud_of?: string;             // accomplishments she's proud of
  why_change?: string;           // why this next chapter / why tech sales
  strengths?: string;
  anything_else?: string;
  linkedin_url?: string;
  followups?: { question: string; answer: string }[];
}

/** The career record plus her own words (questionnaire, follow-up answers, career-change story) — for prompts. */
export async function getVoiceForPrompts(env: Env): Promise<Voice> {
  const v = await getVoice(env);
  const a = await getSetting<ProfileAnswers>(env, 'profile_answers');
  const story = await getSetting<{ why_tech_sales?: string; transferable_skills?: { skill: string; evidence: string }[] }>(env, 'story');
  const lines: string[] = [];
  if (a) {
    const add = (label: string, val?: string | string[] | number) => {
      const t = Array.isArray(val) ? val.filter(Boolean).join(', ') : val;
      if (t !== undefined && t !== '' && t !== 0) lines.push(`- ${label}: ${t}`);
    };
    add('Most recent role', a.recent_role); add('Years of experience', a.years_experience); add('Skills', a.skills); add('Tools/software', a.tools);
    add('Wants', a.desired_roles); add('Industries', a.industries); add('Work arrangement', a.work_arrangement); add('Schedule', a.schedule); add('Can start', a.start);
    add('Minimum base pay', a.base_min ? `$${a.base_min.toLocaleString('en-US')}` : undefined);
    add('Minimum OTE', a.ote_min ? `$${a.ote_min.toLocaleString('en-US')}` : undefined);
    add('Dealbreakers', a.dealbreakers); add('Proud of', a.proud_of); add('Strengths', a.strengths); add('Why this next chapter', a.why_change); add('Also', a.anything_else);
    for (const f of a.followups ?? []) if (f.answer?.trim()) lines.push(`- Q: ${f.question}\n  A: ${f.answer.trim()}`);
  }
  const extra = [
    lines.length ? `## In her own words (her onboarding answers — facts here may be used like the rest of the record)\n${lines.join('\n')}` : '',
    story?.why_tech_sales ? `## Her career-change story (use this narrative consistently)\n${story.why_tech_sales}${story.transferable_skills?.length ? `\nTransferable skills:\n${story.transferable_skills.map((t) => `- ${t.skill}: ${t.evidence}`).join('\n')}` : ''}` : '',
  ].filter(Boolean).join('\n\n');
  return extra ? { ...v, career_record: `${v.career_record}\n\n${extra}`.trim() } : v;
}

export async function getVoice(env: Env): Promise<Voice> {
  return (await getSetting<Voice>(env, 'voice')) ?? { voice_guide: '', career_record: '', open_questions: [], learned_at: null };
}

export async function addEvent(env: Env, applicationId: number, type: string, summary: string, detail?: string): Promise<void> {
  await env.DB.prepare('INSERT INTO app_events (user_id, application_id, type, summary, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(U(env), applicationId, type, summary, detail ?? null).run();
}

export async function logActivity(env: Env, kind: string, message: string): Promise<void> {
  await env.DB.prepare('INSERT INTO activity_log (user_id, kind, message) VALUES (?, ?, ?)').bind(env.uid ?? 0, kind, message.slice(0, 2000)).run();
}

export interface JobRow {
  id: number;
  source: string;
  external_id: string;
  url: string | null;
  apply_url: string | null;
  title: string;
  company: string;
  location: string | null;
  work_mode: 'remote' | 'onsite' | 'hybrid' | 'unknown';
  salary: string | null;
  description: string;
  posted_at: string | null;
  found_at: string;
  fit_score: number | null;
  fit_label: string | null;
  fit_summary: string | null;
  fit_json: string | null;
  apply_method: string | null;
  application_email: string | null;
  status: string;
  vote: number | null;
  vote_reason: string | null;
  voted_at: string | null;
}

export interface AppRow {
  id: number;
  job_id: number;
  status: string;
  apply_method: 'email' | 'web' | 'in_person';
  contact_email: string | null;
  resume_md: string | null;
  cover_letter_md: string | null;
  email_subject: string | null;
  email_body: string | null;
  form_answers: string | null;
  ai_notes: string | null;
  gmail_thread_id: string | null;
  rfc_message_id: string | null;
  submitted_at: string | null;
  last_contact_at: string | null;
  follow_up_count: number;
  closed_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutboxRow {
  id: number;
  application_id: number | null;
  kind: string;
  to_email: string | null;
  subject: string;
  body: string;
  attach_resume: number;
  attach_cover_letter: number;
  status: string;
  approved_by: string | null;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

/** SQLite datetime('now') format, UTC. */
export function sqlNow(d = new Date()): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function parseSqlDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
}
