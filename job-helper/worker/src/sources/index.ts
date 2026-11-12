// Fetches every enabled job source and returns normalized postings plus a per-source report.
import type { Env } from '../env';
import type { Prefs } from '../lib/prefs';
import type { Voice } from '../lib/db';
import { aiWebScout } from '../lib/ai';
import { careerContext, scoutInstructions, scoutMock, SCOUT_SCHEMA, type ScoutResult, type Taste } from '../lib/prompts';
import { parseAdzuna, parseGreenhouse, parseHimalayas, parseLever, parseRemoteOK, parseRemotive, parseRss, parseUsaJobs } from './parsers';
import type { RawJob } from './types';

const UA = 'NextChapterJobHelper/1.0 (personal job search assistant)';

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function queries(prefs: Prefs): string[] {
  const roles = prefs.target_roles.map((r) => r.trim()).filter(Boolean);
  return roles.length ? roles.slice(0, 5) : [''];
}

export interface SourceReport { source: string; found: number; error?: string }

type Fetcher = { name: string; enabled: boolean; run: () => Promise<RawJob[]> };

export function locationParts(home: string): { city?: string; region?: string } {
  const [city, region] = home.split(',').map((s) => s.trim());
  return { city: city || undefined, region: region || undefined };
}

export async function fetchAllSources(env: Env, prefs: Prefs, voice: Voice, taste?: Taste): Promise<{ jobs: RawJob[]; report: SourceReport[] }> {
  const s = prefs.sources;
  const local = prefs.want_local && !!prefs.home_location;
  const fetchers: Fetcher[] = [
    {
      name: 'Remotive', enabled: s.remotive && prefs.want_remote,
      run: async () => (await Promise.all(queries(prefs).map(async (q) =>
        parseRemotive(await getJson(`https://remotive.com/api/remote-jobs?limit=50${q ? `&search=${encodeURIComponent(q)}` : ''}`))))).flat(),
    },
    {
      name: 'RemoteOK', enabled: s.remoteok && prefs.want_remote,
      run: async () => parseRemoteOK(await getJson('https://remoteok.com/api')),
    },
    {
      name: 'Himalayas', enabled: s.himalayas && prefs.want_remote,
      run: async () => parseHimalayas(await getJson('https://himalayas.app/jobs/api?limit=100')),
    },
    {
      name: 'Adzuna (local)', enabled: s.adzuna && local && !!env.ADZUNA_APP_ID && !!env.ADZUNA_APP_KEY,
      run: async () => (await Promise.all(queries(prefs).map(async (q) => {
        const p = new URLSearchParams({
          app_id: env.ADZUNA_APP_ID!, app_key: env.ADZUNA_APP_KEY!,
          where: prefs.home_location, distance: String(Math.round(prefs.radius_miles * 1.609)),
          max_days_old: '21', results_per_page: '50', sort_by: 'date',
        });
        if (q) p.set('what', q);
        return parseAdzuna(await getJson(`https://api.adzuna.com/v1/api/jobs/us/search/1?${p}`));
      }))).flat(),
    },
    {
      name: 'USAJobs (local)', enabled: s.usajobs && local && !!env.USAJOBS_API_KEY && !!env.USAJOBS_EMAIL,
      run: async () => (await Promise.all(queries(prefs).map(async (q) => {
        const p = new URLSearchParams({ LocationName: prefs.home_location, Radius: String(prefs.radius_miles), ResultsPerPage: '50' });
        if (q) p.set('Keyword', q);
        return parseUsaJobs(await getJson(`https://data.usajobs.gov/api/search?${p}`, {
          'User-Agent': env.USAJOBS_EMAIL!, 'Authorization-Key': env.USAJOBS_API_KEY!, Host: 'data.usajobs.gov',
        }));
      }))).flat(),
    },
    ...s.greenhouse_boards.filter(Boolean).map((token): Fetcher => ({
      name: `Greenhouse: ${token}`, enabled: true,
      run: async () => {
        const board = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}`).catch(() => null)) as { name?: string } | null;
        return parseGreenhouse(await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`), token, board?.name ?? token);
      },
    })),
    ...s.lever_sites.filter(Boolean).map((site): Fetcher => ({
      name: `Lever: ${site}`, enabled: true,
      run: async () => parseLever(await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`), site),
    })),
    ...s.rss_feeds.filter(Boolean).map((url): Fetcher => ({
      name: `Feed: ${safeHost(url)}`, enabled: /^https?:\/\//.test(url),
      run: async () => parseRss(await getText(url), url),
    })),
    {
      name: 'AI web scout (local)', enabled: s.web_scout && local,
      run: async () => {
        const loc = locationParts(prefs.home_location);
        const result = await aiWebScout<ScoutResult>(env, {
          context: careerContext(voice, prefs, taste),
          purpose: 'Searching the web for local jobs',
          instructions: scoutInstructions(prefs),
          user: `Find current openings for her near ${prefs.home_location}. Today is ${new Date().toDateString()}.`,
          location: { type: 'approximate', city: loc.city, region: loc.region, country: 'US', timezone: env.TIMEZONE || 'America/Los_Angeles' },
          saveSchema: SCOUT_SCHEMA,
          mock: scoutMock,
        });
        return (result?.jobs ?? []).filter((j) => j.url && j.title).map((j) => ({
          source: 'web_scout',
          external_id: j.url,
          url: j.url,
          title: j.title,
          company: j.company || safeHost(j.url),
          location: j.location || null,
          work_mode: j.work_mode,
          salary: j.salary || null,
          description: j.description,
          application_email: j.application_email || null,
        }));
      },
    },
  ];

  const report: SourceReport[] = [];
  const jobs: RawJob[] = [];
  await Promise.all(fetchers.filter((f) => f.enabled).map(async (f) => {
    try {
      const found = await f.run();
      jobs.push(...found);
      report.push({ source: f.name, found: found.length });
    } catch (e) {
      report.push({ source: f.name, found: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }));
  return { jobs, report };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
