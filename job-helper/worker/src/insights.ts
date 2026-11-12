// Progress numbers: what's been sent, what got answers, which kinds of jobs and sources work.
// Shown on the Insights page and emailed every Monday to the job seeker and her helpers.
import type { Env } from './env';
import { logActivity, U } from './lib/db';
import { getUser } from './accounts';
import { helperEmails, sendSystemEmail } from './alerts';
import { gmailStatus, sendEmail } from './lib/gmail';

export interface Insights {
  week: { found: number; recommended: number; liked: number; passed: number; drafted: number; sent: number; followUps: number; replies: number; interviews: number; offers: number };
  total: { applied: number; replied: number; interviews: number; offers: number; won: number; responseRate: number; interviewRate: number };
  bySource: { source: string; applied: number; replied: number; interviews: number }[];
  byRole: { role: string; applied: number; replied: number; interviews: number }[];
  spendMonthMicro: number;
}

const ROLE_BUCKETS: [string, RegExp][] = [
  ['SDR / BDR', /\b(sdr|bdr|sales development|business development rep)/i],
  ['Account Executive', /\baccount exec|\bAE\b/i],
  ['Account Manager', /account manager/i],
  ['Customer Success', /customer success|\bcsm\b/i],
  ['Inside Sales', /inside sales/i],
  ['Sales Engineer', /sales engineer|solutions/i],
];
function bucket(title: string): string {
  return ROLE_BUCKETS.find(([, re]) => re.test(title))?.[0] ?? 'Other';
}

export async function getInsights(env: Env): Promise<Insights> {
  const uid = U(env);
  const n = async (sql: string) => ((await env.DB.prepare(sql).bind(uid).first<{ n: number }>())?.n ?? 0);
  const WEEK = "datetime('now','-7 days')";
  const week = {
    found: await n(`SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND found_at >= ${WEEK}`),
    recommended: await n(`SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND found_at >= ${WEEK} AND status != 'filtered' AND fit_score IS NOT NULL`),
    liked: await n(`SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND vote = 1 AND voted_at >= ${WEEK}`),
    passed: await n(`SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND vote = -1 AND voted_at >= ${WEEK}`),
    drafted: await n(`SELECT COUNT(*) AS n FROM app_events WHERE user_id = ? AND type = 'drafted' AND created_at >= ${WEEK}`),
    sent: await n(`SELECT COUNT(*) AS n FROM app_events WHERE user_id = ? AND type = 'submitted' AND created_at >= ${WEEK}`),
    followUps: await n(`SELECT COUNT(*) AS n FROM app_events WHERE user_id = ? AND type = 'follow_up_sent' AND created_at >= ${WEEK}`),
    replies: await n(`SELECT COUNT(*) AS n FROM app_events WHERE user_id = ? AND type = 'reply' AND created_at >= ${WEEK}`),
    interviews: await n(`SELECT COUNT(*) AS n FROM app_events WHERE user_id = ? AND type = 'status' AND summary LIKE '%interviewing%' AND created_at >= ${WEEK}`),
    offers: await n(`SELECT COUNT(*) AS n FROM app_events WHERE user_id = ? AND type = 'status' AND summary LIKE '%offer%' AND created_at >= ${WEEK}`),
  };
  const { results: apps } = await env.DB.prepare(
    `SELECT j.source, j.title, a.status,
       EXISTS (SELECT 1 FROM app_events e WHERE e.application_id = a.id AND e.type = 'reply' AND e.summary NOT LIKE 'Application received%') AS replied,
       (a.status IN ('interviewing','offer','won') OR EXISTS (SELECT 1 FROM app_events e WHERE e.application_id = a.id AND e.summary LIKE '%interviewing%')) AS interviewed
     FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.user_id = ? AND a.submitted_at IS NOT NULL`,
  ).bind(uid).all<{ source: string; title: string; status: string; replied: number; interviewed: number }>();
  const group = (key: (a: (typeof apps)[number]) => string) => {
    const m = new Map<string, { applied: number; replied: number; interviews: number }>();
    for (const a of apps) {
      const k = key(a);
      const g = m.get(k) ?? { applied: 0, replied: 0, interviews: 0 };
      g.applied++;
      g.replied += a.replied ? 1 : 0;
      g.interviews += a.interviewed ? 1 : 0;
      m.set(k, g);
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, ...v })).sort((x, y) => y.applied - x.applied);
  };
  const applied = apps.length;
  const replied = apps.filter((a) => a.replied).length;
  const interviews = apps.filter((a) => a.interviewed).length;
  const spend = await env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN charge_micro > 0 THEN charge_micro ELSE cost_micro END),0) AS n FROM usage_events WHERE user_id = ? AND created_at >= datetime('now','start of month')").bind(uid).first<{ n: number }>();
  return {
    week,
    total: {
      applied, replied, interviews,
      offers: apps.filter((a) => ['offer', 'won'].includes(a.status)).length,
      won: apps.filter((a) => a.status === 'won').length,
      responseRate: applied ? Math.round((replied / applied) * 100) : 0,
      interviewRate: applied ? Math.round((interviews / applied) * 100) : 0,
    },
    bySource: group((a) => a.source).map(({ key, ...v }) => ({ source: key, ...v })),
    byRole: group((a) => bucket(a.title)).map(({ key, ...v }) => ({ role: key, ...v })),
    spendMonthMicro: spend?.n ?? 0,
  };
}

export function weeklyText(name: string, i: Insights, appUrl: string): string {
  const w = i.week;
  const best = i.byRole.filter((r) => r.applied >= 3).sort((a, b) => b.interviews / b.applied - a.interviews / a.applied)[0];
  return [
    `Weekly job search summary for ${name}`,
    '',
    'THIS WEEK',
    `  • ${w.found} new listings found, ${w.recommended} recommended`,
    `  • ${w.liked} liked 👍, ${w.passed} passed on 👎`,
    `  • ${w.drafted} applications written, ${w.sent} sent, ${w.followUps} follow-ups`,
    `  • ${w.replies} replies from employers${w.interviews ? `, ${w.interviews} interview${w.interviews === 1 ? '' : 's'}` : ''}${w.offers ? `, ${w.offers} offer${w.offers === 1 ? '' : 's'} 🎉` : ''}`,
    '',
    'SO FAR',
    `  • ${i.total.applied} applications sent · ${i.total.responseRate}% got a reply · ${i.total.interviewRate}% led to an interview`,
    best ? `  • Best results so far: ${best.role} (${best.interviews} interview${best.interviews === 1 ? '' : 's'} from ${best.applied} applications)` : '',
    '',
    `Open Next Chapter: ${appUrl}`,
  ].filter((l) => l !== '').join('\n');
}

/** Monday: a summary to every active job seeker (via her Gmail, to herself) and her helpers (system email). */
export async function sendWeeklySummaries(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT u.id FROM users u WHERE u.status = 'active' AND EXISTS (SELECT 1 FROM settings s WHERE s.user_id = u.id AND s.key = 'voice')",
  ).all<{ id: number }>();
  const appUrl = (await env.DB.prepare("SELECT value FROM app_config WHERE key = 'app_url'").first<{ value: string }>())?.value;
  for (const { id } of results) {
    const wenv = { ...env, uid: id };
    try {
      const owner = (await getUser(env, id))!;
      const text = weeklyText(owner.name, await getInsights(wenv), env.APP_URL ?? (appUrl ? JSON.parse(appUrl) : ''));
      const helpers = await helperEmails(env, id);
      if (helpers.length) await sendSystemEmail(env, helpers, `Weekly update: ${owner.name.split(' ')[0]}’s job search`, text);
      const g = await gmailStatus(wenv);
      if (g.connected && g.email) await sendEmail(wenv, { fromName: 'Next Chapter', to: g.email, subject: 'Your week in the job search', text });
    } catch (e) {
      await logActivity(wenv, 'error', `weekly summary: ${e instanceof Error ? e.message : e}`);
    }
  }
}
