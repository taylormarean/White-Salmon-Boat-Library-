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
