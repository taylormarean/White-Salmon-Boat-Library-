import type { Env } from '../env';
import { mergePrefs, type Prefs } from './prefs';

export async function getSetting<T>(env: Env, key: string): Promise<T | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function setSetting(env: Env, key: string, value: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
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

export async function getVoice(env: Env): Promise<Voice> {
  return (await getSetting<Voice>(env, 'voice')) ?? { voice_guide: '', career_record: '', open_questions: [], learned_at: null };
}

export async function addEvent(env: Env, applicationId: number, type: string, summary: string, detail?: string): Promise<void> {
  await env.DB.prepare('INSERT INTO app_events (application_id, type, summary, detail) VALUES (?, ?, ?, ?)')
    .bind(applicationId, type, summary, detail ?? null).run();
}

export async function logActivity(env: Env, kind: string, message: string): Promise<void> {
  await env.DB.prepare('INSERT INTO activity_log (kind, message) VALUES (?, ?)').bind(kind, message.slice(0, 2000)).run();
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
