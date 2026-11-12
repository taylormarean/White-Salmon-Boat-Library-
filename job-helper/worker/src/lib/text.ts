// Pure text helpers — no I/O, unit tested.
import type { Prefs } from './prefs';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…', bull: '•' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Job boards hand back HTML (sometimes entity-escaped HTML). Flatten to readable text. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  let s = html;
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s); // escaped HTML (Greenhouse)
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function normalize(s: string): string {
  return s.toLowerCase().replace(/\b(inc|llc|ltd|co|corp|corporation|company|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Same job on two boards → same key. Location only matters for in-person roles. */
export function dedupeKey(company: string, title: string, workMode: string, location?: string | null): string {
  const loc = workMode === 'remote' ? 'remote' : normalize(location ?? '').split(' ').slice(0, 2).join(' ');
  return `${normalize(company)}|${normalize(title)}|${loc}`;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const IGNORE_EMAIL = /(noreply|no-reply|donotreply|example\.com|privacy|accommodation|accessibility|eeo|unsubscribe)/i;

/** Pull a likely "send your resume to" address out of a job posting. */
export function extractApplicationEmail(text: string): string | null {
  const found = [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase().replace(/\.$/, '')))];
  const usable = found.filter((e) => !IGNORE_EMAIL.test(e));
  if (!usable.length) return null;
  // Prefer one that sits near apply-ish words.
  for (const e of usable) {
    const i = text.toLowerCase().indexOf(e);
    const ctx = text.slice(Math.max(0, i - 120), i).toLowerCase();
    if (/(resume|résumé|apply|application|cv|cover letter|send|email|interested)/.test(ctx)) return e;
  }
  return usable[0];
}

export function emailDomain(email: string | null | undefined): string | null {
  const m = email?.toLowerCase().match(/@([a-z0-9.-]+)$/);
  return m ? m[1] : null;
}

const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'comcast.net', 'msn.com', 'live.com']);
export function isFreeMail(domain: string | null): boolean {
  return !!domain && FREE_MAIL.has(domain);
}

/** Remote postings that are restricted to other countries are useless to her. */
export function remoteLocationOk(restriction: string | null | undefined): boolean {
  const r = (restriction ?? '').trim();
  if (!r) return true;
  if (/(anywhere|worldwide|global|usa|u\.s\.|united states|\bus\b|north america|americas|remote)/i.test(r)) return true;
  return false;
}

/** Best-effort yearly salary from free text like "$22–$26/hr" or "$55,000 - $65,000". Returns the top of the range. */
export function salaryToYearly(text: string | null | undefined): number | null {
  if (!text) return null;
  const nums = [...text.replace(/,/g, '').matchAll(/\$?\s*(\d+(?:\.\d+)?)\s*(k)?/gi)]
    .map((m) => parseFloat(m[1]) * (m[2] ? 1000 : 1))
    .filter((n) => n >= 7);
  if (!nums.length) return null;
  const top = Math.max(...nums);
  if (/(hour|hr|\/h\b)/i.test(text) || top < 200) return Math.round(top * 2080);
  if (/(month|mo\b)/i.test(text)) return Math.round(top * 12);
  return Math.round(top);
}

export interface Candidate {
  title: string;
  company: string;
  description: string;
  location?: string | null;
  work_mode: string;
  salary?: string | null;
}

/** Cheap keyword screen before spending AI calls. Returns a reason when the job is filtered out. */
export function prefilter(job: Candidate, prefs: Prefs, opts: { skipRoleCheck?: boolean } = {}): string | null {
  const hay = `${job.title}\n${job.description}`.toLowerCase();
  const title = job.title.toLowerCase();
  const company = normalize(job.company);
  if (prefs.exclude_companies.some((c) => normalize(c) && normalize(c) === company)) return `${job.company} is on her "no thanks" list`;
  for (const kw of prefs.exclude_keywords) {
    const k = kw.trim().toLowerCase();
    if (k && (title.includes(k) || hay.includes(k))) return `mentions "${kw}"`;
  }
  if (job.work_mode === 'remote' && !prefs.want_remote) return 'remote (she asked for local only)';
  if ((job.work_mode === 'onsite' || job.work_mode === 'hybrid') && !prefs.want_local) return 'in-person (she asked for remote only)';
  const targets = prefs.target_roles.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (targets.length && !opts.skipRoleCheck) {
    const words = (t: string) => t.split(/\s+/).filter((w) => w.length > 2);
    const hit = targets.some((t) => title.includes(t) || words(t).every((w) => title.includes(w)) || hay.includes(t));
    if (!hit) return 'not one of her target roles';
  }
  if (prefs.min_salary && job.salary) {
    const yearly = salaryToYearly(job.salary);
    if (yearly && yearly < prefs.min_salary * 0.85) return `pays about $${yearly.toLocaleString('en-US')}/yr`;
  }
  return null;
}

/** Strip quoted replies and signatures from an email body so it's a clean voice sample. */
export function cleanEmailBody(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:$/.test(line.trim()) || /^-{2,}\s*Original Message/i.test(line) || /^From: /.test(line)) break;
    if (line.startsWith('>')) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
