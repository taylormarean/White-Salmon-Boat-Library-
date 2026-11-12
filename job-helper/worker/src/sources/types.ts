export type WorkMode = 'remote' | 'onsite' | 'hybrid' | 'unknown';

export interface RawJob {
  source: string;
  external_id: string;
  url: string | null;
  apply_url?: string | null;
  title: string;
  company: string;
  location: string | null;
  work_mode: WorkMode;
  salary?: string | null;
  description: string;
  posted_at?: string | null;
  application_email?: string | null;
  /** remote postings restricted to certain countries ("USA only", "Europe") */
  location_restriction?: string | null;
}

export function guessWorkMode(text: string, fallback: WorkMode = 'onsite'): WorkMode {
  const t = text.toLowerCase();
  if (/\bhybrid\b/.test(t)) return 'hybrid';
  if (/\b(fully remote|100% remote|remote position|work from home|wfh|remote)\b/.test(t)) return 'remote';
  return fallback;
}

export function money(min?: number | null, max?: number | null, unit = ''): string | null {
  const f = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  if (min && max && min !== max) return `${f(min)}–${f(max)}${unit}`;
  if (max || min) return `${f((max || min)!)}${unit}`;
  return null;
}

export function isoDate(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
