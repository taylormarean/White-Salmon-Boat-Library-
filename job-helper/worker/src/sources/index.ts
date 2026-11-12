// Fetches every enabled job source and returns normalized postings plus a per-source report.
import type { Env } from '../env';
import type { Prefs } from '../lib/prefs';
import type { Voice } from '../lib/db';
import { aiWebScout } from '../lib/ai';
import { careerContext, scoutInstructions, scoutMock, SCOUT_SCHEMA, type ScoutResult, type Taste } from '../lib/prompts';
import { parseAdzuna, parseAshby, parseGoogleJobs, parseGreenhouse, parseHimalayas, parseJobicy, parseJooble, parseLever, parseRemoteOK, parseRemotive, parseRss, parseUsaJobs, parseWeWorkRemotely, parseWorkingNomads } from './parsers';
import type { RawJob } from './types';
import { GTM_TITLE, TECH_SALES_COMPANIES, type CompanyBoard } from './companies';
import { abroadOnly, nearHome, remoteLocationOk } from '../lib/text';
import { guardSpend, recordCost } from '../billing';

/** SerpApi's price per search on its entry plan ($75 / 5,000). Billed to the customer like AI usage. */
const SERPAPI_COST_MICRO = 15_000;

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

/** Is this a sales-type search? Then the built-in list of software companies hiring sales is worth searching. */
export function wantsSalesBoards(prefs: Prefs): boolean {
  return /(sales|account (executive|manager)|business development|customer success|\bsdr\b|\bbdr\b)/i.test(`${prefs.target_roles.join(' ')} ${prefs.industry_focus}`);
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
      name: 'Jobicy', enabled: s.jobicy !== false && prefs.want_remote,
      run: async () => (await Promise.all(['business', 'marketing', 'supporting'].map(async (industry) =>
        parseJobicy(await getJson(`https://jobicy.com/api/v2/remote-jobs?count=50&geo=usa&industry=${industry}`))))).flat(),
    },
    {
      name: 'Working Nomads', enabled: s.working_nomads !== false && prefs.want_remote,
      run: async () => parseWorkingNomads(await getJson('https://www.workingnomads.com/api/exposed_jobs/')),
    },
    {
      name: 'We Work Remotely', enabled: s.weworkremotely !== false && prefs.want_remote,
      run: async () => (await Promise.all(['remote-sales-and-marketing-jobs', 'remote-customer-support-jobs'].map(async (c) =>
        parseWeWorkRemotely(await getText(`https://weworkremotely.com/categories/${c}.rss`))))).flat(),
    },
    {
      name: 'Software companies hiring sales', enabled: s.company_boards !== false && wantsSalesBoards(prefs) && (prefs.want_remote || local),
      run: async () => {
        const { jobs, failed } = await companyBoardJobs(env, TECH_SALES_COMPANIES);
        const near = (j: RawJob) => local && j.work_mode !== 'remote' && nearHome(j.location, prefs.home_location);
        const remote = (j: RawJob) => prefs.want_remote && (j.work_mode === 'remote' || /remote/i.test(j.location ?? '')) && remoteLocationOk(j.location) && !abroadOnly(`${j.title} | ${j.location ?? ''}`);
        const kept = jobs.filter((j) => remote(j) || near(j));
        if (failed.length && !jobs.length) throw new Error(`no company pages reachable (${failed.slice(0, 3).join(', ')})`);
        return kept;
      },
    },
    {
      name: 'Google Jobs (LinkedIn, Indeed, ZipRecruiter, Monster…)', enabled: s.google_jobs !== false && !!env.SERPAPI_KEY && (prefs.want_remote || local),
      run: async () => {
        // Two roles × (nearby, remote) at most: each search is a paid call.
        const searches: URLSearchParams[] = [];
        for (const q of queries(prefs).slice(0, 2)) {
          const base = { engine: 'google_jobs', q: q || 'sales', hl: 'en', gl: 'us', api_key: env.SERPAPI_KEY! };
          if (local) searches.push(new URLSearchParams({ ...base, location: prefs.home_location, lrad: String(Math.round(prefs.radius_miles * 1.609)) }));
          if (prefs.want_remote) searches.push(new URLSearchParams({ ...base, location: 'United States', ltype: '1' }));
        }
        const out: RawJob[] = [];
        for (const p of searches) {
          await guardSpend(env);
          const data = await getJson(`https://serpapi.com/search.json?${p}`);
          await recordCost(env, 'Job search (Google Jobs)', 'serpapi', SERPAPI_COST_MICRO);
          out.push(...parseGoogleJobs(data));
        }
        return out;
      },
    },
    {
      name: 'Jooble (local)', enabled: s.jooble !== false && local && !!env.JOOBLE_API_KEY,
      run: async () => {
        const km = Math.round(prefs.radius_miles * 1.609);
        const radius = [0, 4, 8, 16, 26, 40, 80].reduce((a, b) => (Math.abs(b - km) < Math.abs(a - km) ? b : a));
        return (await Promise.all(queries(prefs).slice(0, 3).map(async (q) => {
          const res = await fetch(`https://jooble.org/api/${encodeURIComponent(env.JOOBLE_API_KEY!)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
            body: JSON.stringify({ keywords: q, location: prefs.home_location, radius: String(radius), page: '1' }),
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return parseJooble(await res.json());
        }))).flat();
      },
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
    ...(s.ashby_boards ?? []).filter(Boolean).map((board): Fetcher => ({
      name: `Ashby: ${board}`, enabled: true,
      run: async () => parseAshby(await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`), board,
        board.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())),
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

// ------------------------------------------------------------------ shared company career pages

const BOARD_FRESH_MS = 20 * 3_600_000;
const BOARD_DESC_CHARS = 6_000;

const BOARD_MAX_BYTES = 800_000; // well under D1's 2 MB row limit

/** Newest first, descriptions trimmed until the board fits comfortably in one database row. */
export function shrinkToFit(jobs: RawJob[]): RawJob[] {
  let list = [...jobs].sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? '')).slice(0, 250);
  for (let chars = BOARD_DESC_CHARS; ; chars = Math.floor(chars * 0.7)) {
    const trimmed = list.map((j) => ({ ...j, description: j.description.slice(0, chars) }));
    if (JSON.stringify(trimmed).length <= BOARD_MAX_BYTES || chars < 800) return trimmed;
    if (chars < 1500) list = list.slice(0, Math.floor(list.length * 0.8));
  }
}

async function fetchBoard(b: CompanyBoard): Promise<RawJob[]> {
  const slug = encodeURIComponent(b.slug);
  if (b.ats === 'greenhouse') return parseGreenhouse(await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`), b.slug, b.name);
  if (b.ats === 'ashby') return parseAshby(await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`), b.slug, b.name);
  return parseLever(await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`), b.slug).map((j) => ({ ...j, company: b.name }));
}

/**
 * Sales and customer-success openings from many companies' career pages. Each page is fetched at most
 * about once a day and shared by every account, so a hundred customers cost the same as one.
 */
export async function companyBoardJobs(env: Env, boards: CompanyBoard[], now = Date.now()): Promise<{ jobs: RawJob[]; failed: string[] }> {
  const key = (b: CompanyBoard) => `${b.ats}:${b.slug}`;
  const cached = new Map<string, { at: number; jobs: RawJob[] }>();
  for (let i = 0; i < boards.length; i += 90) {
    const part = boards.slice(i, i + 90).map(key);
    const { results } = await env.DB.prepare(`SELECT board, fetched_at, jobs FROM board_cache WHERE board IN (${part.map(() => '?').join(',')})`)
      .bind(...part).all<{ board: string; fetched_at: string; jobs: string }>();
    for (const r of results) {
      try { cached.set(r.board, { at: Date.parse(r.fetched_at), jobs: JSON.parse(r.jobs) as RawJob[] }); } catch { /* rebuilt below */ }
    }
  }
  const stale = boards.filter((b) => !cached.has(key(b)) || now - cached.get(key(b))!.at > BOARD_FRESH_MS);
  const failed: string[] = [];
  const writes: D1PreparedStatement[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, stale.length) }, async () => {
    while (next < stale.length) {
      const b = stale[next++];
      try {
        const jobs = shrinkToFit((await fetchBoard(b)).filter((j) => GTM_TITLE.test(j.title) && !abroadOnly(`${j.title} | ${j.location ?? ''}`)));
        cached.set(key(b), { at: now, jobs });
        writes.push(env.DB.prepare('INSERT INTO board_cache (board, fetched_at, jobs) VALUES (?, ?, ?) ON CONFLICT(board) DO UPDATE SET fetched_at = excluded.fetched_at, jobs = excluded.jobs')
          .bind(key(b), new Date(now).toISOString(), JSON.stringify(jobs)));
      } catch {
        failed.push(b.name); // keep yesterday's copy if there is one
      }
    }
  }));
  for (let i = 0; i < writes.length; i += 20) await env.DB.batch(writes.slice(i, i + 20));
  return { jobs: boards.flatMap((b) => cached.get(key(b))?.jobs ?? []), failed };
}
