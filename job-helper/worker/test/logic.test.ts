import { describe, expect, it } from 'vitest';
import { nextStep, isBusinessHours } from '../src/lib/followup';
import { DEFAULT_PREFS, mergePrefs } from '../src/lib/prefs';
import { cleanEmailBody, dedupeKey, extractApplicationEmail, htmlToText, prefilter, remoteLocationOk, salaryToYearly } from '../src/lib/text';
import { matchApplication } from '../src/lib/match';
import { buildMime } from '../src/lib/mime';
import { parseAdzuna, parseGreenhouse, parseHimalayas, parseLever, parseRemoteOK, parseRemotive, parseRss, parseUsaJobs } from '../src/sources/parsers';
import { markdownToDocxBase64 } from '../src/lib/docx';
import { docxToText } from '../src/lib/unzip';
import { authUrl } from '../src/lib/gmail';
import { adminEmails, freeEmails } from '../src/accounts';
import type { Env } from '../src/env';
import { buildDigest, type DigestData } from '../src/digest';

const cfg = DEFAULT_PREFS.autopilot; // follow_up_days [7, 10], close_after_days 21
const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n, 18));
const sql = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);

describe('follow-up schedule', () => {
  it('waits, then follows up after 7 days', () => {
    const app = { status: 'submitted', submitted_at: sql(day(0)), last_contact_at: sql(day(0)), follow_up_count: 0 };
    expect(nextStep(app, day(6), cfg)).toEqual({ type: 'none' });
    expect(nextStep(app, day(7), cfg)).toEqual({ type: 'follow_up', number: 1, kind: 'follow_up' });
  });
  it('second follow-up measured from the first one', () => {
    const app = { status: 'following_up', submitted_at: sql(day(0)), last_contact_at: sql(day(7)), follow_up_count: 1 };
    expect(nextStep(app, day(16), cfg).type).toBe('none');
    expect(nextStep(app, day(17), cfg)).toMatchObject({ type: 'follow_up', number: 2 });
  });
  it('closes after the last follow-up goes unanswered', () => {
    const app = { status: 'following_up', submitted_at: sql(day(0)), last_contact_at: sql(day(17)), follow_up_count: 2 };
    expect(nextStep(app, day(37), cfg).type).toBe('none');
    expect(nextStep(app, day(38), cfg)).toMatchObject({ type: 'close' });
  });
  it('interviewing: two check-ins, never auto-closes', () => {
    const base = { status: 'interviewing', submitted_at: sql(day(0)), last_contact_at: sql(day(10)) };
    expect(nextStep({ ...base, follow_up_count: 0 }, day(17), cfg)).toMatchObject({ type: 'follow_up', kind: 'interview_check_in' });
    expect(nextStep({ ...base, follow_up_count: 2 }, day(90), cfg)).toEqual({ type: 'none' });
  });
  it('ignores closed / unsent applications', () => {
    expect(nextStep({ status: 'ready', submitted_at: null, last_contact_at: null, follow_up_count: 0 }, day(50), cfg)).toEqual({ type: 'none' });
    expect(nextStep({ status: 'rejected', submitted_at: sql(day(0)), last_contact_at: sql(day(0)), follow_up_count: 0 }, day(50), cfg)).toEqual({ type: 'none' });
  });
  it('business hours in her timezone', () => {
    expect(isBusinessHours(new Date('2026-11-12T18:00:00Z'), 'America/Los_Angeles')).toBe(true);  // Thu 10am PT
    expect(isBusinessHours(new Date('2026-11-13T03:00:00Z'), 'America/Los_Angeles')).toBe(false); // Thu 7pm PT
    expect(isBusinessHours(new Date('2026-11-14T18:00:00Z'), 'America/Los_Angeles')).toBe(false); // Saturday
  });
});

describe('screening', () => {
  const prefs = mergePrefs({ target_roles: ['office manager', 'bookkeeper'], exclude_keywords: ['commission only'], min_salary: 45000 });
  it('keeps target roles', () => {
    expect(prefilter({ title: 'Office Manager', company: 'X', description: 'Run the office', work_mode: 'onsite' }, prefs)).toBeNull();
    expect(prefilter({ title: 'Full-Charge Bookkeeper', company: 'X', description: '', work_mode: 'remote' }, prefs)).toBeNull();
  });
  it('drops unrelated, excluded, and underpaid jobs', () => {
    expect(prefilter({ title: 'Senior Rust Engineer', company: 'X', description: 'systems', work_mode: 'remote' }, prefs)).toMatch(/target/);
    expect(prefilter({ title: 'Office Manager', company: 'X', description: 'This is commission only', work_mode: 'onsite' }, prefs)).toMatch(/commission/);
    expect(prefilter({ title: 'Office Manager', company: 'X', description: '', work_mode: 'onsite', salary: '$15–$17/hr' }, prefs)).toMatch(/pays/);
    expect(prefilter({ title: 'Office Manager', company: 'X', description: '', work_mode: 'onsite', salary: '$24/hr' }, prefs)).toBeNull();
  });
  it('skips the role check for sources already searched by role', () => {
    expect(prefilter({ title: 'Front Office Coordinator', company: 'X', description: '', work_mode: 'onsite' }, prefs, { skipRoleCheck: true })).toBeNull();
  });
  it('respects remote/local wishes', () => {
    expect(prefilter({ title: 'Office Manager', company: 'X', description: '', work_mode: 'remote' }, { ...prefs, want_remote: false })).toMatch(/remote/);
  });
  it('salary parsing', () => {
    expect(salaryToYearly('$22–$26/hr')).toBe(26 * 2080);
    expect(salaryToYearly('$55,000 - $65,000')).toBe(65000);
    expect(salaryToYearly('$60k')).toBe(60000);
    expect(salaryToYearly('Competitive')).toBeNull();
  });
  it('remote location restrictions', () => {
    expect(remoteLocationOk('USA Only')).toBe(true);
    expect(remoteLocationOk('Worldwide')).toBe(true);
    expect(remoteLocationOk('')).toBe(true);
    expect(remoteLocationOk('Europe, UK')).toBe(false);
  });
  it('dedupes the same job across boards', () => {
    expect(dedupeKey('Acme, Inc.', 'Office Manager', 'remote')).toBe(dedupeKey('ACME', 'Office  Manager!', 'remote', 'Anywhere'));
    expect(dedupeKey('Acme', 'Office Manager', 'onsite', 'Hood River, OR')).not.toBe(dedupeKey('Acme', 'Office Manager', 'onsite', 'Portland, OR'));
  });
  it('finds the application email', () => {
    expect(extractApplicationEmail('Questions? privacy@acme.com. To apply, send your resume to Hiring@Acme.com.')).toBe('hiring@acme.com');
    expect(extractApplicationEmail('Apply online.')).toBeNull();
  });
});

describe('text cleanup', () => {
  it('flattens escaped HTML from Greenhouse', () => {
    expect(htmlToText('&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;')).toBe('Hello & welcome\n\n• One');
  });
  it('strips quoted replies from sent mail', () => {
    expect(cleanEmailBody('Hi Pam,\n\nSounds great!\n\nOn Tue, Jan 2, 2024 Pam wrote:\n> old stuff')).toBe('Hi Pam,\n\nSounds great!');
  });
});

describe('reply matching', () => {
  const apps = [
    { id: 1, company: 'Providence Health', contact_email: null, gmail_thread_id: null, updated_at: '2026-01-01' },
    { id: 2, company: 'Gorge Dental', contact_email: 'office@gorgedental.com', gmail_thread_id: 't-2', updated_at: '2026-01-02' },
    { id: 3, company: 'Acme', contact_email: 'jobs@gmail.com', gmail_thread_id: null, updated_at: '2026-01-03' },
  ];
  it('by thread, by employer domain, by company name through an ATS', () => {
    expect(matchApplication({ threadId: 't-2', from: 'x@y.com', subject: '', body: '' }, apps)?.id).toBe(2);
    expect(matchApplication({ threadId: 'z', from: 'Dr. Lee <lee@gorgedental.com>', subject: 'Hi', body: '' }, apps)?.id).toBe(2);
    expect(matchApplication({ threadId: 'z', from: 'no-reply@greenhouse.io', subject: 'Your application to Providence Health', body: '' }, apps)?.id).toBe(1);
  });
  it('does not match on free-mail domains or unrelated mail', () => {
    expect(matchApplication({ threadId: 'z', from: 'friend@gmail.com', subject: 'Lunch?', body: 'see you' }, apps)).toBeNull();
  });
});

describe('MIME', () => {
  it('builds a threaded message with an attachment', () => {
    const raw = buildMime({ from: 'Linda <l@gmail.com>', to: 'hr@acme.com', subject: 'Résumé for Office Manager', text: 'Hi!', inReplyTo: '<abc@mail>', attachments: [{ filename: 'Linda_Resume.docx', mimeType: 'application/x', base64: 'AAAA' }] }, 'BOUNDARY');
    expect(raw).toContain('Subject: =?UTF-8?B?');
    expect(raw).toContain('In-Reply-To: <abc@mail>');
    expect(raw).toContain('Content-Type: multipart/mixed; boundary="BOUNDARY"');
    expect(raw).toContain('filename="Linda_Resume.docx"');
    expect(raw.trim().endsWith('--BOUNDARY--')).toBe(true);
  });
  it('blocks header injection', () => {
    const raw = buildMime({ from: 'a@b.c', to: 'x@y.z\r\nBcc: evil@z.z', subject: 's', text: 't' });
    expect(raw).not.toMatch(/\r\nBcc:/);
  });
});

describe('source parsers', () => {
  it('Remotive', () => {
    const [j] = parseRemotive({ jobs: [{ id: 7, url: 'https://remotive.com/j/7', title: 'Bookkeeper', company_name: 'Acme', candidate_required_location: 'USA', salary: '$50k', description: '<p>Do books</p>', publication_date: '2026-11-01T10:00:00' }] });
    expect(j).toMatchObject({ source: 'remotive', external_id: '7', work_mode: 'remote', company: 'Acme', description: 'Do books', location_restriction: 'USA' });
  });
  it('RemoteOK skips the legal notice', () => {
    const jobs = parseRemoteOK([{ legal: 'notice' }, { id: '9', position: 'Admin Assistant', company: 'Beta', location: 'Worldwide', salary_min: 40000, salary_max: 50000, description: 'x', url: 'u', date: '2026-11-01' }]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].salary).toBe('$40,000–$50,000/yr');
  });
  it('Himalayas', () => {
    const [j] = parseHimalayas({ jobs: [{ title: 'Ops Coordinator', companyName: 'Gamma', locationRestrictions: ['United States'], minSalary: 50000, maxSalary: 60000, currency: 'USD', description: '<b>Hi</b>', pubDate: 1762000000, applicationLink: 'https://h/1', guid: 'g1' }] });
    expect(j).toMatchObject({ external_id: 'g1', location: 'Remote (United States)', salary: '$50,000–$60,000/yr' });
    expect(j.posted_at).toMatch(/^2025-/);
  });
  it('Adzuna', () => {
    const [j] = parseAdzuna({ results: [{ id: 1, title: '<strong>Office</strong> Manager', description: 'Hybrid role in Hood River', redirect_url: 'r', company: { display_name: 'Delta' }, location: { display_name: 'Hood River, OR' }, salary_min: 50000, salary_max: 55000, salary_is_predicted: '0', created: '2026-11-01T00:00:00Z' }] });
    expect(j).toMatchObject({ title: 'Office Manager', work_mode: 'hybrid', company: 'Delta' });
  });
  it('USAJobs', () => {
    const [j] = parseUsaJobs({ SearchResult: { SearchResultItems: [{ MatchedObjectId: '1', MatchedObjectDescriptor: { PositionID: 'FS-1', PositionTitle: 'Office Assistant', PositionURI: 'p', ApplyURI: ['a'], PositionLocationDisplay: 'Trout Lake, WA', OrganizationName: 'Forest Service', PositionRemuneration: [{ MinimumRange: '20', MaximumRange: '25', RateIntervalCode: 'PH' }], UserArea: { Details: { JobSummary: 'Support the district office.' } } } }] } });
    expect(j).toMatchObject({ external_id: 'FS-1', apply_url: 'a', salary: '$20–$25/hr', work_mode: 'onsite' });
  });
  it('Greenhouse + Lever', () => {
    const [g] = parseGreenhouse({ jobs: [{ id: 5, title: 'Receptionist', absolute_url: 'g', location: { name: 'Remote - US' }, content: '&lt;p&gt;Hi&lt;/p&gt;' }] }, 'acme', 'Acme Co');
    expect(g).toMatchObject({ external_id: 'acme:5', company: 'Acme Co', work_mode: 'remote', description: 'Hi' });
    const [l] = parseLever([{ id: 'x', text: 'Office Manager', hostedUrl: 'h', applyUrl: 'a', categories: { location: 'Hood River' }, workplaceType: 'onsite', descriptionPlain: 'Run it', lists: [{ text: 'Requirements', content: '<li>3 years</li>' }] }], 'gorge-co');
    expect(l).toMatchObject({ company: 'Gorge Co', work_mode: 'onsite' });
    expect(l.description).toContain('3 years');
  });
  it('RSS', () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>Gorge Jobs</title><item><title>Front Desk - Hood River Inn</title><link>https://ex.org/1</link><description><![CDATA[<p>Greet guests</p>]]></description><pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate><guid>1</guid></item></channel></rss>`;
    const [j] = parseRss(xml, 'https://ex.org/feed');
    expect(j).toMatchObject({ title: 'Front Desk', company: 'Hood River Inn', url: 'https://ex.org/1', description: 'Greet guests' });
  });
});

describe('Word export', () => {
  it('produces a .docx (zip) file', async () => {
    const b64 = await markdownToDocxBase64('# Linda Example\nWhite Salmon, WA · l@x.com\n\n## Experience\n### Office Manager — Dental · 2014–2024\n- Ran **everything**', 'resume');
    expect(atob(b64).slice(0, 2)).toBe('PK');
  });
});

describe('Google sign-in', () => {
  const env = { ADMIN_EMAILS: 'Me@Example.com', FREE_EMAILS: ' Mom@Gmail.com ', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 's' } as unknown as Env;
  it('reads admin and comped (free) accounts from the configured lists', () => {
    expect(adminEmails(env)).toEqual(['me@example.com']);
    expect(freeEmails(env)).toEqual(['mom@gmail.com']);
    // v1 installs: first ALLOWED_EMAILS address was the job seeker (comped), the rest were helpers (now admins)
    const legacy = { ALLOWED_EMAILS: 'mom@gmail.com, kid@example.com' } as unknown as Env;
    expect(freeEmails(legacy)).toEqual(['mom@gmail.com']);
    expect(adminEmails(legacy)).toEqual(['kid@example.com']);
  });
  it('asks job seekers for Gmail + Calendar, but helpers only for their name and email', () => {
    const owner = new URL(authUrl(env, 'https://app.example', 'st', 'owner'));
    expect(owner.searchParams.get('scope')).toContain('gmail.send');
    expect(owner.searchParams.get('scope')).toContain('gmail.readonly');
    expect(owner.searchParams.get('scope')).toContain('calendar.events');
    expect(owner.searchParams.get('access_type')).toBe('offline');
    expect(owner.searchParams.get('redirect_uri')).toBe('https://app.example/api/google/callback');
    const helper = new URL(authUrl(env, 'https://app.example', 'st', 'helper'));
    expect(helper.searchParams.get('scope')).toBe('openid email profile');
    const connect = new URL(authUrl(env, 'https://app.example', 'st', 'connect', 'mom@gmail.com'));
    expect(connect.searchParams.get('login_hint')).toBe('mom@gmail.com');
  });
});

describe('Word attachments', () => {
  it('reads the text back out of a .docx', async () => {
    const b64 = await markdownToDocxBase64('# Linda Example\nWhite Salmon, WA\n\n## Experience\n- Ran the front desk & billing', 'resume');
    const text = await docxToText(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    expect(text).toContain('Linda Example');
    expect(text).toContain('Ran the front desk & billing');
  });
  it('rejects things that are not Word files', async () => {
    await expect(docxToText(new TextEncoder().encode('not a zip'))).rejects.toThrow();
  });
});

describe('morning email', () => {
  const base: DigestData = {
    firstName: 'Linda', appUrl: 'https://nc.test',
    toVote: [{ id: 7, title: 'Account Executive', company: 'Acme SaaS', location: null, work_mode: 'remote', salary: '$70k–$90k', fit_score: 82, fit_summary: 'Your <client> work fits.' }],
    toVoteTotal: 3, voteLinks: { 7: { up: 'https://nc.test/api/q?t=UP', down: 'https://nc.test/api/q?t=DOWN' } },
    ready: [{ id: 1, title: 'SDR', company: 'Beta' }], waiting: [],
    news: [{ company: 'Gamma', summary: 'Wants a phone call Tuesday', application_id: 2 }],
    did: { seen: 140, sources: 5, recommended: 6, screenedOut: 30, drafted: 2, sentApplications: 1, sentFollowUps: 1, sentReplies: 0, replies: 1, closed: 0 },
    learned: { reply: 'Got it — shorter letters from now on.', changes: ['Now skipping jobs that mention: cold calling'] },
  };
  it('has the to-do, one-tap vote buttons, what it did, and what it learned', () => {
    const d = buildDigest(base);
    expect(d.subject).toBe('Your job search today — 1 reply from employers, 3 new jobs to vote on, 1 thing to OK');
    expect(d.html).toContain('https://nc.test/api/q?t=UP');
    expect(d.html).toContain('👎 Not for me');
    expect(d.html).toContain('Your &lt;client&gt; work fits.'); // escaped
    expect(d.html).toContain('…and 2 more');
    expect(d.text).toContain('Looked through 140 job listings from 5 sources.');
    expect(d.text).toContain('Sent 1 application from your Gmail.');
    expect(d.text).toContain('Got it — shorter letters from now on.');
    expect(d.text).toContain('reply to this email');
  });
  it('still says something on a quiet day', () => {
    const d = buildDigest({ ...base, toVote: [], toVoteTotal: 0, ready: [], news: [], learned: null, did: { seen: 0, sources: 0, recommended: 0, screenedOut: 0, drafted: 0, sentApplications: 0, sentFollowUps: 0, sentReplies: 0, replies: 0, closed: 0 } });
    expect(d.subject).toBe('Your job search today');
    expect(d.text).toContain('Nothing today');
    expect(d.text).toContain('A quiet day');
  });
  it('MIME carries both a plain and an HTML version', () => {
    const raw = buildMime({ from: 'a@b.c', to: 'a@b.c', subject: 's', text: 'plain', html: '<b>rich</b>' }, 'B');
    expect(raw).toContain('multipart/alternative; boundary="B_alt"');
    expect(raw).toContain('Content-Type: text/html');
    expect(raw).toContain('Content-Type: text/plain');
  });
});

describe('tech sales focus + blocked employers', () => {
  it('starts focused on tech sales roles', () => {
    expect(DEFAULT_PREFS.target_roles).toContain('Account Executive');
    expect(DEFAULT_PREFS.target_roles).toContain('Sales Development Representative');
    expect(DEFAULT_PREFS.industry_focus).toMatch(/software|SaaS/);
    expect(prefilter({ title: 'Account Executive, Mid-Market', company: 'Acme', description: 'Sell our SaaS platform', work_mode: 'remote' }, DEFAULT_PREFS)).toBeNull();
    expect(prefilter({ title: 'Account Executive', company: 'Acme', description: 'This role is 100% commission', work_mode: 'remote' }, DEFAULT_PREFS)).toMatch(/commission/);
  });
  it('never shows an employer she gave a thumbs-down to', () => {
    const prefs = mergePrefs({ exclude_companies: ['Acme, Inc.'] });
    expect(prefilter({ title: 'Account Executive', company: 'ACME', description: '', work_mode: 'remote' }, prefs)).toMatch(/no thanks/);
  });
});
