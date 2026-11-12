// Response parsers for each job source. Pure functions over the documented JSON shapes — unit tested with fixtures.
import { htmlToText, decodeEntities } from '../lib/text';
import { guessWorkMode, money, isoDate, type RawJob } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// https://remotive.com/api/remote-jobs
export function parseRemotive(data: any): RawJob[] {
  return (data?.jobs ?? []).map((j: any) => ({
    source: 'remotive',
    external_id: String(j.id),
    url: j.url ?? null,
    title: j.title ?? '',
    company: j.company_name ?? '',
    location: j.candidate_required_location || 'Remote',
    location_restriction: j.candidate_required_location ?? null,
    work_mode: 'remote',
    salary: j.salary || null,
    description: htmlToText(j.description),
    posted_at: isoDate(j.publication_date),
  }));
}

// https://remoteok.com/api — first element is a legal notice, not a job.
export function parseRemoteOK(data: any): RawJob[] {
  return (Array.isArray(data) ? data : []).filter((j) => j && j.id && j.position).map((j: any) => ({
    source: 'remoteok',
    external_id: String(j.id),
    url: j.url ?? null,
    apply_url: j.apply_url ?? null,
    title: decodeEntities(j.position ?? ''),
    company: decodeEntities(j.company ?? ''),
    location: j.location || 'Remote',
    location_restriction: j.location ?? null,
    work_mode: 'remote',
    salary: money(j.salary_min, j.salary_max, '/yr'),
    description: htmlToText(j.description),
    posted_at: isoDate(j.date ?? j.epoch),
  }));
}

// https://himalayas.app/jobs/api
export function parseHimalayas(data: any): RawJob[] {
  return (data?.jobs ?? []).map((j: any) => {
    const restrictions: string[] = j.locationRestrictions ?? [];
    return {
      source: 'himalayas',
      external_id: String(j.guid ?? j.applicationLink ?? j.title),
      url: j.applicationLink ?? j.guid ?? null,
      title: j.title ?? '',
      company: j.companyName ?? '',
      location: restrictions.length ? `Remote (${restrictions.join(', ')})` : 'Remote',
      location_restriction: restrictions.join(', ') || null,
      work_mode: 'remote',
      salary: j.currency && j.currency !== 'USD' ? null : money(j.minSalary, j.maxSalary, '/yr'),
      description: htmlToText(j.description ?? j.excerpt),
      posted_at: isoDate(j.pubDate),
    } satisfies RawJob;
  });
}

// https://api.adzuna.com/v1/api/jobs/us/search/1
export function parseAdzuna(data: any): RawJob[] {
  return (data?.results ?? []).map((j: any) => {
    const desc = htmlToText(j.description);
    return {
      source: 'adzuna',
      external_id: String(j.id),
      url: j.redirect_url ?? null,
      title: htmlToText(j.title),
      company: j.company?.display_name ?? '',
      location: j.location?.display_name ?? null,
      work_mode: guessWorkMode(`${j.title} ${desc}`),
      salary: j.salary_is_predicted === '1' ? null : money(j.salary_min, j.salary_max, '/yr'),
      description: desc,
      posted_at: isoDate(j.created),
    } satisfies RawJob;
  });
}

// https://data.usajobs.gov/api/search
export function parseUsaJobs(data: any): RawJob[] {
  return (data?.SearchResult?.SearchResultItems ?? []).map((item: any) => {
    const d = item.MatchedObjectDescriptor ?? {};
    const pay = d.PositionRemuneration?.[0];
    const unit = pay?.RateIntervalCode === 'PH' ? '/hr' : '/yr';
    const details = d.UserArea?.Details ?? {};
    const duties = Array.isArray(details.MajorDuties) ? details.MajorDuties.join('\n') : '';
    const description = [details.JobSummary, d.QualificationSummary, duties].filter(Boolean).join('\n\n');
    return {
      source: 'usajobs',
      external_id: String(d.PositionID ?? item.MatchedObjectId),
      url: d.PositionURI ?? null,
      apply_url: d.ApplyURI?.[0] ?? null,
      title: d.PositionTitle ?? '',
      company: [d.OrganizationName, d.DepartmentName].filter(Boolean).join(' — '),
      location: d.PositionLocationDisplay ?? null,
      work_mode: details.RemoteIndicator ? 'remote' : guessWorkMode(description),
      salary: pay ? money(Number(pay.MinimumRange), Number(pay.MaximumRange), unit) : null,
      description: htmlToText(description),
      posted_at: isoDate(d.PublicationStartDate),
    } satisfies RawJob;
  });
}

// https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
export function parseGreenhouse(data: any, token: string, companyName: string): RawJob[] {
  return (data?.jobs ?? []).map((j: any) => {
    const loc = j.location?.name ?? '';
    const desc = htmlToText(j.content);
    return {
      source: 'greenhouse',
      external_id: `${token}:${j.id}`,
      url: j.absolute_url ?? null,
      title: j.title ?? '',
      company: companyName,
      location: loc || null,
      work_mode: guessWorkMode(`${loc} ${j.title}`, /remote/i.test(desc.slice(0, 400)) ? 'remote' : 'onsite'),
      description: desc,
      posted_at: isoDate(j.updated_at),
    } satisfies RawJob;
  });
}

// https://api.lever.co/v0/postings/{site}?mode=json
export function parseLever(data: any, site: string): RawJob[] {
  return (Array.isArray(data) ? data : []).map((j: any) => {
    const wt = String(j.workplaceType ?? '').toLowerCase();
    const sal = j.salaryRange;
    const lists = (j.lists ?? []).map((l: any) => `${l.text}\n${htmlToText(l.content)}`).join('\n\n');
    return {
      source: 'lever',
      external_id: `${site}:${j.id}`,
      url: j.hostedUrl ?? null,
      apply_url: j.applyUrl ?? null,
      title: j.text ?? '',
      company: site.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      location: j.categories?.location ?? null,
      work_mode: wt === 'remote' ? 'remote' : wt === 'hybrid' ? 'hybrid' : wt === 'on-site' || wt === 'onsite' ? 'onsite' : guessWorkMode(j.categories?.location ?? ''),
      salary: sal && (!sal.currency || sal.currency === 'USD') ? money(sal.min, sal.max, sal.interval === 'per-hour-wage' ? '/hr' : '/yr') : null,
      description: [j.descriptionPlain ?? htmlToText(j.description), lists, j.additionalPlain ?? ''].filter(Boolean).join('\n\n'),
      posted_at: isoDate(j.createdAt),
    } satisfies RawJob;
  });
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
}

// Any RSS 2.0 or Atom job feed (local job boards, newspaper classifieds, government job pages).
export function parseRss(xml: string, feedUrl: string): RawJob[] {
  const channelTitle = htmlToText(tag(xml.split(/<item[\s>]|<entry[\s>]/i)[0], 'title')) || new URL(feedUrl).hostname;
  const items = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) ?? [];
  return items.map((it) => {
    const title = htmlToText(tag(it, 'title'));
    const link = tag(it, 'link') || (it.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? '');
    const desc = htmlToText(tag(it, 'description') || tag(it, 'content:encoded') || tag(it, 'content') || tag(it, 'summary'));
    // Many feeds use "Job Title - Company" or "Job Title at Company".
    const split = title.match(/^(.+?)\s+(?:-|–|—|at|@)\s+(.+)$/);
    return {
      source: 'rss',
      external_id: `${feedUrl}:${tag(it, 'guid') || tag(it, 'id') || link || title}`,
      url: link || null,
      title: split ? split[1] : title,
      company: split ? split[2] : channelTitle,
      location: null,
      work_mode: guessWorkMode(`${title} ${desc}`, 'unknown'),
      description: desc,
      posted_at: isoDate(tag(it, 'pubDate') || tag(it, 'published') || tag(it, 'updated')),
    } satisfies RawJob;
  }).filter((j) => j.title);
}

// https://jobicy.com/api/v2/remote-jobs?industry=…&geo=usa
export function parseJobicy(data: any): RawJob[] {
  return (data?.jobs ?? []).map((j: any) => ({
    source: 'jobicy',
    external_id: String(j.id),
    url: j.url ?? null,
    title: decodeEntities(j.jobTitle ?? ''),
    company: decodeEntities(j.companyName ?? ''),
    location: j.jobGeo ? `Remote (${j.jobGeo})` : 'Remote',
    location_restriction: j.jobGeo ?? null,
    work_mode: 'remote',
    salary: (!j.salaryCurrency || j.salaryCurrency === 'USD') ? money(j.salaryMin, j.salaryMax, j.salaryPeriod === 'hourly' ? '/hr' : '/yr') : null,
    description: htmlToText(j.jobDescription ?? j.jobExcerpt),
    posted_at: isoDate(j.pubDate),
  } satisfies RawJob));
}

// https://www.workingnomads.com/api/exposed_jobs/ — the latest remote postings in all categories.
export function parseWorkingNomads(data: any): RawJob[] {
  return (Array.isArray(data) ? data : []).filter((j: any) => j?.title && j?.url).map((j: any) => ({
    source: 'workingnomads',
    external_id: String(j.url),
    url: j.url,
    title: decodeEntities(j.title),
    company: decodeEntities(j.company_name ?? ''),
    location: j.location ? `Remote (${j.location})` : 'Remote',
    location_restriction: j.location ?? null,
    work_mode: 'remote',
    description: htmlToText(j.description),
    posted_at: isoDate(j.pub_date),
  } satisfies RawJob));
}

// https://weworkremotely.com/categories/<category>.rss — titles are "Company: Job title".
export function parseWeWorkRemotely(xml: string): RawJob[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  return items.map((it) => {
    const full = htmlToText(tag(it, 'title'));
    const i = full.indexOf(': ');
    const region = htmlToText(tag(it, 'region'));
    const link = tag(it, 'link') || tag(it, 'guid');
    return {
      source: 'weworkremotely',
      external_id: link || full,
      url: link || null,
      title: i > 0 ? full.slice(i + 2) : full,
      company: i > 0 ? full.slice(0, i) : 'We Work Remotely',
      location: region ? `Remote (${region})` : 'Remote',
      location_restriction: region || null,
      work_mode: 'remote',
      description: htmlToText(tag(it, 'description')),
      posted_at: isoDate(tag(it, 'pubDate')),
    } satisfies RawJob;
  }).filter((j) => j.title);
}

// https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true
export function parseAshby(data: any, board: string, companyName: string): RawJob[] {
  return (data?.jobs ?? []).filter((j: any) => j.isListed !== false).map((j: any) => {
    const wt = String(j.workplaceType ?? '').toLowerCase();
    const extra = (j.secondaryLocations ?? []).map((l: any) => l.location).filter(Boolean);
    const locs = [j.location, ...extra].filter(Boolean).join('; ');
    const pay = (j.compensation?.summaryComponents ?? []).find((c: any) => c.compensationType === 'Salary' && (!c.currencyCode || c.currencyCode === 'USD'));
    return {
      source: 'ashby',
      external_id: `${board}:${j.id}`,
      url: j.jobUrl ?? null,
      apply_url: j.applyUrl ?? null,
      title: String(j.title ?? '').trim(),
      company: companyName,
      location: locs || null,
      work_mode: wt === 'remote' || (j.isRemote && wt !== 'onsite' && wt !== 'hybrid') ? 'remote' : wt === 'hybrid' ? 'hybrid' : 'onsite',
      salary: pay ? money(pay.minValue, pay.maxValue, /HOUR/i.test(pay.interval ?? '') ? '/hr' : '/yr') : null,
      description: j.descriptionPlain ?? htmlToText(j.descriptionHtml),
      posted_at: isoDate(j.publishedAt),
    } satisfies RawJob;
  });
}

// POST https://jooble.org/api/{key} — aggregates listings from thousands of job sites.
export function parseJooble(data: any): RawJob[] {
  return (data?.jobs ?? []).map((j: any) => {
    const desc = htmlToText(j.snippet);
    return {
      source: 'jooble',
      external_id: String(j.id ?? j.link),
      url: j.link ?? null,
      title: htmlToText(j.title),
      company: decodeEntities(j.company ?? ''),
      location: j.location || null,
      work_mode: guessWorkMode(`${j.title} ${j.location ?? ''} ${desc}`),
      salary: j.salary || null,
      description: desc,
      posted_at: isoDate(j.updated),
    } satisfies RawJob;
  });
}

// https://serpapi.com/search.json?engine=google_jobs — Google for Jobs, which gathers listings from
// LinkedIn, Indeed, ZipRecruiter, Monster, Glassdoor and employers' own sites.
export function parseGoogleJobs(data: any): RawJob[] {
  return (data?.jobs_results ?? []).map((j: any) => {
    const ext = j.detected_extensions ?? {};
    const options: { title?: string; link?: string }[] = j.apply_options ?? [];
    // Prefer applying on the employer's own site over a job board.
    const direct = options.find((o) => o.link && !/(linkedin|indeed|ziprecruiter|monster|glassdoor|simplyhired|talent\.com|jooble|bebee|lensa)/i.test(o.link));
    const loc = String(j.location ?? '').trim();
    const remote = ext.work_from_home === true || /anywhere|remote/i.test(loc);
    return {
      source: 'google_jobs',
      external_id: String(j.job_id ?? `${j.company_name}|${j.title}|${loc}`).slice(0, 400),
      url: direct?.link ?? options[0]?.link ?? j.share_link ?? null,
      apply_url: direct?.link ?? options[0]?.link ?? null,
      title: j.title ?? '',
      company: j.company_name ?? '',
      location: remote ? (loc && !/anywhere/i.test(loc) ? `Remote (${loc})` : 'Remote') : loc || null,
      work_mode: remote ? 'remote' : guessWorkMode(`${j.title} ${loc}`),
      salary: ext.salary ?? null,
      description: [j.description ?? '', j.via ? `Listed ${j.via}.` : ''].filter(Boolean).join('\n\n'),
      posted_at: relativeDate(ext.posted_at),
    } satisfies RawJob;
  });
}

/** "3 days ago" → ISO date (Google shows relative posting dates). */
export function relativeDate(text: string | null | undefined, now = Date.now()): string | null {
  const m = String(text ?? '').match(/(\d+)\+?\s*(minute|hour|day|week|month)s?\s+ago/i);
  if (!m) return null;
  const unit = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 }[m[2].toLowerCase() as 'day'];
  return new Date(now - Number(m[1]) * unit).toISOString();
}
