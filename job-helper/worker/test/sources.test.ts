// Job sources added for wider search: parsers (fixtures trimmed from real responses on 2026-11-12),
// location rules, the shared company-board cache, and the order fit checks run in.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAshby, parseGoogleJobs, parseJobicy, parseJooble, parseWeWorkRemotely, parseWorkingNomads, relativeDate } from '../src/sources/parsers';
import { abroadOnly, nearHome, remoteLocationOk } from '../src/lib/text';
import { companyBoardJobs, shrinkToFit, wantsSalesBoards } from '../src/sources';
import { TECH_SALES_COMPANIES, GTM_TITLE } from '../src/sources/companies';
import { rankForScoring } from '../src/pipeline';
import { DEFAULT_PREFS, mergePrefs } from '../src/lib/prefs';
import type { RawJob } from '../src/sources/types';

describe('new job-board parsers', () => {
  it('Jobicy', () => {
    const [j] = parseJobicy({ jobs: [{ id: 161701, url: 'https://jobicy.com/jobs/161701', jobTitle: 'Director, Client Success', companyName: 'Qventus', jobGeo: 'USA', jobDescription: '<p>Lead &amp; grow</p>', pubDate: '2026-11-12T17:05:16+00:00', salaryMin: 150000, salaryMax: 190000, salaryCurrency: 'USD', salaryPeriod: 'yearly' }] });
    expect(j).toMatchObject({ source: 'jobicy', external_id: '161701', title: 'Director, Client Success', company: 'Qventus', location: 'Remote (USA)', work_mode: 'remote', salary: '$150,000–$190,000/yr', description: 'Lead & grow' });
  });

  it('Working Nomads', () => {
    const [j] = parseWorkingNomads([{ url: 'https://www.workingnomads.com/job/go/1/', title: 'Account Executive', description: '<p>Sell</p>', company_name: 'Acme', category_name: 'Sales', location: 'USA', pub_date: '2026-11-12T06:47:52-05:00' }]);
    expect(j).toMatchObject({ source: 'workingnomads', title: 'Account Executive', company: 'Acme', location: 'Remote (USA)', location_restriction: 'USA', work_mode: 'remote' });
  });

  it('We Work Remotely splits "Company: Title"', () => {
    const xml = `<rss><channel><title>WWR</title><item><title>DataVisor: Senior Account Executive - Payment</title><region>USA Only</region>
      <description>&lt;p&gt;Close deals&lt;/p&gt;</description><pubDate>Wed, 12 Nov 2026 10:00:00 +0000</pubDate>
      <link>https://weworkremotely.com/remote-jobs/datavisor-ae</link></item></channel></rss>`;
    const [j] = parseWeWorkRemotely(xml);
    expect(j).toMatchObject({ source: 'weworkremotely', company: 'DataVisor', title: 'Senior Account Executive - Payment', location: 'Remote (USA Only)', url: 'https://weworkremotely.com/remote-jobs/datavisor-ae' });
    expect(j.description).toContain('Close deals');
  });

  it('Ashby: workplace type, extra locations, salary', () => {
    const jobs = parseAshby({ jobs: [
      { id: 'a1', title: ' Account Executive ', location: 'New York, NY', secondaryLocations: [{ location: 'Remote (US)' }], isListed: true, isRemote: true, workplaceType: 'Remote', jobUrl: 'https://jobs.ashbyhq.com/x/a1', applyUrl: 'https://jobs.ashbyhq.com/x/a1/application', descriptionPlain: 'Sell', publishedAt: '2026-11-01T00:00:00Z', compensation: { summaryComponents: [{ compensationType: 'Salary', interval: '1 YEAR', currencyCode: 'USD', minValue: 90000, maxValue: 120000 }] } },
      { id: 'a2', title: 'SDR', location: 'Austin, TX', isListed: true, isRemote: false, workplaceType: 'Hybrid', jobUrl: 'u', descriptionPlain: '' },
      { id: 'a3', title: 'Hidden', location: 'X', isListed: false, workplaceType: 'OnSite', jobUrl: 'u' },
    ] }, 'acme', 'Acme');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ external_id: 'acme:a1', title: 'Account Executive', company: 'Acme', location: 'New York, NY; Remote (US)', work_mode: 'remote', salary: '$90,000–$120,000/yr' });
    expect(jobs[1].work_mode).toBe('hybrid');
  });

  it('Jooble', () => {
    const [j] = parseJooble({ jobs: [{ id: 99, title: '<b>Inside Sales</b> Rep', location: 'Hood River, OR', snippet: 'Call &amp; close', salary: '$55k', company: 'Orchard Co', link: 'https://jooble.org/desc/99', updated: '2026-11-10T00:00:00' }] });
    expect(j).toMatchObject({ source: 'jooble', title: 'Inside Sales Rep', company: 'Orchard Co', location: 'Hood River, OR', work_mode: 'onsite', salary: '$55k' });
  });

  it('Google Jobs prefers the employer’s own apply link and spots remote jobs', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    vi.setSystemTime(now);
    const [a, b] = parseGoogleJobs({ jobs_results: [
      { title: 'Account Executive', company_name: 'Acme', location: 'Portland, OR', via: 'via LinkedIn', description: 'Sell', job_id: 'g1', detected_extensions: { posted_at: '3 days ago', salary: '$80K–$100K a year' },
        apply_options: [{ title: 'LinkedIn', link: 'https://www.linkedin.com/jobs/view/1' }, { title: 'Acme Careers', link: 'https://careers.acme.com/1' }] },
      { title: 'SDR', company_name: 'Beta', location: 'Anywhere', job_id: 'g2', detected_extensions: { work_from_home: true }, apply_options: [{ title: 'ZipRecruiter', link: 'https://www.ziprecruiter.com/j/2' }] },
    ] });
    vi.useRealTimers();
    expect(a).toMatchObject({ source: 'google_jobs', url: 'https://careers.acme.com/1', work_mode: 'onsite', salary: '$80K–$100K a year' });
    expect(a.description).toContain('via LinkedIn');
    expect(a.posted_at?.slice(0, 10)).toBe('2026-11-09');
    expect(b).toMatchObject({ location: 'Remote', work_mode: 'remote', url: 'https://www.ziprecruiter.com/j/2' });
    expect(relativeDate('2 weeks ago', now)?.slice(0, 10)).toBe('2026-10-29');
    expect(relativeDate('Just posted', now)).toBeNull();
  });
});

describe('location rules', () => {
  it('remote jobs limited to other countries are skipped', () => {
    expect(remoteLocationOk('Lausanne')).toBe(false); // contains "usa" — must not count as the USA
    expect(remoteLocationOk('Remote - EMEA')).toBe(false);
    expect(remoteLocationOk('Remote - Quebec')).toBe(false);
    expect(remoteLocationOk('Remote (USA Only)')).toBe(true);
    expect(remoteLocationOk('US-WI-Remote')).toBe(true);
    expect(remoteLocationOk('Remote')).toBe(true);
    expect(remoteLocationOk(null)).toBe(true);
  });

  it('abroadOnly looks at title and location together', () => {
    expect(abroadOnly('Country Manager Canada | Remote')).toBe(true);
    expect(abroadOnly('Account Executive, DACH | Remote')).toBe(true);
    expect(abroadOnly('Account Executive, Americas | Remote')).toBe(false);
    expect(abroadOnly('Account Executive | London; New York, NY')).toBe(false);
    expect(abroadOnly('Account Executive | Seattle, Washington')).toBe(false);
    expect(abroadOnly('Account Executive | Remote')).toBe(false);
  });

  it('nearHome matches her city or state, not lookalikes', () => {
    const home = 'White Salmon, WA';
    expect(nearHome('US-WA-Bellevue', home)).toBe(true);
    expect(nearHome('Seattle, WA', home)).toBe(true);
    expect(nearHome('White Salmon, Washington', home)).toBe(true);
    expect(nearHome('Washington, DC', home)).toBe(false);
    expect(nearHome('Austin, TX', home)).toBe(false);
    expect(nearHome('Warsaw', home)).toBe(false);
    expect(nearHome('', home)).toBe(false);
    expect(nearHome('Bend, Oregon', 'Hood River, Oregon')).toBe(true);
  });
});

describe('company career pages', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeDb() {
    const rows = new Map<string, { board: string; fetched_at: string; jobs: string }>();
    const stmt = (sql: string, args: unknown[] = []): any => ({
      bind: (...a: unknown[]) => stmt(sql, a),
      all: async () => ({ results: args.map((k) => rows.get(String(k))).filter(Boolean) }),
      run: async () => { rows.set(String(args[0]), { board: String(args[0]), fetched_at: String(args[1]), jobs: String(args[2]) }); return { meta: {} }; },
    });
    return { rows, DB: { prepare: (sql: string) => stmt(sql), batch: async (l: any[]) => Promise.all(l.map((s) => s.run())) } };
  }

  const board = { ats: 'greenhouse' as const, slug: 'acme', name: 'Acme' };
  const ghJobs = { jobs: [
    { id: 1, title: 'Account Executive', location: { name: 'Remote - US' }, content: '&lt;p&gt;Sell&lt;/p&gt;', absolute_url: 'https://x/1', updated_at: '2026-11-10T00:00:00Z' },
    { id: 2, title: 'Software Engineer', location: { name: 'Remote - US' }, content: '', absolute_url: 'https://x/2', updated_at: '2026-11-10T00:00:00Z' },
    { id: 3, title: 'Account Executive, DACH', location: { name: 'Munich' }, content: '', absolute_url: 'https://x/3', updated_at: '2026-11-10T00:00:00Z' },
  ] };

  it('keeps sales roles in the U.S., caches them, and reuses the copy for a day', async () => {
    const { rows, DB } = fakeDb();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ghJobs), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const now = Date.parse('2026-11-12T12:00:00Z');
    const first = await companyBoardJobs({ DB } as any, [board], now);
    expect(first.jobs.map((j) => j.title)).toEqual(['Account Executive']);
    expect(first.jobs[0].company).toBe('Acme');
    expect(rows.size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await companyBoardJobs({ DB } as any, [board], now + 3 * 3_600_000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // fresh copy reused

    fetchMock.mockImplementation(async () => new Response('down', { status: 503 }));
    const later = await companyBoardJobs({ DB } as any, [board], now + 30 * 3_600_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(later.failed).toEqual(['Acme']);
    expect(later.jobs).toHaveLength(1); // yesterday's copy still used
  });

  it('shrinkToFit keeps a big board under the row size limit', () => {
    const big: RawJob[] = Array.from({ length: 400 }, (_, i) => ({ source: 'greenhouse', external_id: String(i), url: null, title: `Account Executive ${i}`, company: 'Big', location: 'Remote', work_mode: 'remote', description: 'x'.repeat(6000), posted_at: `2026-11-${String((i % 28) + 1).padStart(2, '0')}` }));
    const out = shrinkToFit(big);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(800_000);
    expect(out.length).toBeGreaterThan(100);
    expect(out[0].posted_at! >= out[out.length - 1].posted_at!).toBe(true);
  });

  it('the built-in list is well formed and only searched for sales-type searches', () => {
    const keys = TECH_SALES_COMPANIES.map((b) => `${b.ats}:${b.slug}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(TECH_SALES_COMPANIES.length).toBeGreaterThan(50);
    expect(wantsSalesBoards(DEFAULT_PREFS)).toBe(true);
    expect(wantsSalesBoards(mergePrefs({ target_roles: ['Bookkeeper'], industry_focus: 'Accounting' }))).toBe(false);
    expect(GTM_TITLE.test('Commercial Account Executive')).toBe(true);
    expect(GTM_TITLE.test('Senior Software Engineer')).toBe(false);
  });
});

describe('fit-check order', () => {
  it('title matches first, then nearby, then newest', () => {
    const jobs = [
      { id: 1, title: 'Marketing Manager', work_mode: 'remote', at: '2026-11-12' },
      { id: 2, title: 'Account Executive, SMB', work_mode: 'remote', at: '2026-11-01' },
      { id: 3, title: 'Account Executive', work_mode: 'onsite', at: '2026-10-30' },
      { id: 4, title: 'Senior Account Executive', work_mode: 'remote', at: '2026-11-10' },
    ];
    expect(rankForScoring(jobs, DEFAULT_PREFS).map((j) => j.id)).toEqual([3, 4, 2, 1]);
  });
});
