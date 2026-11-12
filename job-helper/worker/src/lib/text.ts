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

const US_PLACE = /(anywhere|worldwide|\bglobal\b|\busa\b|u\.s\.|united states|\bus\b|north america|\bamericas\b|\bamer\b)/i;
const ABROAD = /(emea|europe|\buk\b|u\.k\.|united kingdom|england|london|ireland|dublin|germany|berlin|munich|dach|france|paris|spain|madrid|barcelona|portugal|lisbon|italy|netherlands|amsterdam|belgium|switzerland|zurich|geneva|lausanne|basel|nordics|sweden|stockholm|denmark|norway|finland|poland|warsaw|india|bangalore|bengaluru|hyderabad|pune|mumbai|apac|\bapj\b|asia|singapore|japan|tokyo|korea|seoul|china|hong kong|taiwan|philippines|manila|australia|sydney|melbourne|\banz\b|new zealand|latam|latin america|mexico|brazil|s[aã]o paulo|argentina|colombia|chile|canada|toronto|vancouver|montreal|quebec|ontario|british columbia|alberta|calgary|israel|tel aviv|dubai|\buae\b|saudi|riyadh|middle east|africa|nigeria|lagos|kenya|nairobi|egypt|cairo|malaysia|kuala lumpur|indonesia|jakarta|vietnam|thailand|bangkok|pakistan|turkey|istanbul|romania|bucharest|czech|prague|hungary|budapest|greece|athens|austria|vienna|estonia|ukraine|kyiv|serbia|croatia|bulgaria|lithuania|latvia|peru|uruguay|costa rica)/i;

/** Remote postings that are restricted to other countries are useless to her. */
export function remoteLocationOk(restriction: string | null | undefined): boolean {
  const r = (restriction ?? '').trim();
  if (!r) return true;
  if (US_PLACE.test(r)) return true;
  if (ABROAD.test(r)) return false;
  return /remote/i.test(r);
}

const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const STATE_CODE = new RegExp(`(^|[\\s,(/-])(${['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'].join('|')})($|[\\s,)/;-])`);

/** Clearly outside the U.S. (mentions another country or region and nothing American). Checks title + location. */
export function abroadOnly(text: string | null | undefined): boolean {
  const t = text ?? '';
  if (!ABROAD.test(t) || US_PLACE.test(t) || STATE_CODE.test(t)) return false;
  return !Object.values(STATES).some((n) => new RegExp(`\\b${n}\\b`, 'i').test(t));
}

/**
 * Rough "is this in-person job near her?" for sources that can't search by distance (company career
 * pages). Matches her city, or her state by name or abbreviation. The AI fit check judges the commute.
 */
export function nearHome(location: string | null | undefined, home: string): boolean {
  const loc = (location ?? '').trim();
  const [city, region] = home.split(',').map((x) => x.trim());
  if (!loc || !city) return false;
  if (loc.toLowerCase().includes(city.toLowerCase())) return true;
  const abbr = (region ?? '').toUpperCase();
  const name = STATES[abbr] ?? Object.values(STATES).find((n) => n.toLowerCase() === (region ?? '').toLowerCase());
  const code = STATES[abbr] ? abbr : Object.keys(STATES).find((k) => STATES[k] === name);
  if (name && new RegExp(`\\b${name}\\b(?!,?\\s*D\\.?C\\b)`, 'i').test(loc)) return true;
  // "Seattle, WA" / "Remote - WA" — the abbreviation must stand alone and be upper case.
  return !!code && new RegExp(`(^|[\\s,(/-])${code}($|[\\s,)/;-])`).test(loc);
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
