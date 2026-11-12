// The morning email: what she needs to do (vote on jobs right from the email, review drafts,
// approve messages) and what the app did for her in the last day. Replying to it = feedback.
import type { Env } from './env';
import { getPrefs, getSetting, logActivity } from './lib/db';
import { signJwt } from './lib/auth';
import { gmailStatus, ownerEmail, sendEmail } from './lib/gmail';

export interface DigestJob { id: number; title: string; company: string; location: string | null; work_mode: string; salary: string | null; fit_score: number; fit_summary: string | null }
export interface DigestData {
  firstName: string;
  appUrl: string;
  toVote: DigestJob[];
  toVoteTotal: number;
  voteLinks: Record<number, { up: string; down: string }>;
  ready: { id: number; title: string; company: string }[];
  waiting: { kind: string; title: string | null; company: string | null }[];
  news: { company: string; summary: string; application_id: number }[];
  did: {
    seen: number; sources: number; recommended: number; screenedOut: number; drafted: number;
    sentApplications: number; sentFollowUps: number; sentReplies: number; replies: number; closed: number;
  };
  learned: { reply: string; changes: string[] } | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function didLines(d: DigestData['did']): string[] {
  const out: string[] = [];
  if (d.seen) out.push(`Looked through ${plural(d.seen, 'job listing')} from ${plural(d.sources, 'source')}.`);
  if (d.recommended || d.screenedOut) out.push(`Recommended ${plural(d.recommended, 'job')} for you${d.screenedOut ? ` and skipped ${d.screenedOut} that didn’t fit what you’ve told me` : ''}.`);
  if (d.drafted) out.push(`Wrote ${plural(d.drafted, 'tailored application')} (resume, cover letter, and email).`);
  if (d.sentApplications) out.push(`Sent ${plural(d.sentApplications, 'application')} from your Gmail.`);
  if (d.sentFollowUps) out.push(`Sent ${plural(d.sentFollowUps, 'follow-up')} to employers who hadn’t answered.`);
  if (d.sentReplies) out.push(`Sent ${plural(d.sentReplies, 'reply', 'replies')} you approved.`);
  if (d.replies) out.push(`Noticed ${plural(d.replies, 'email')} from employers and filed ${d.replies === 1 ? 'it' : 'them'} with the right application.`);
  if (d.closed) out.push(`Closed ${plural(d.closed, 'application')} that never got an answer.`);
  if (!out.length) out.push('A quiet day — I kept watch on your inbox and will search again tomorrow morning.');
  return out;
}

export function digestSubject(d: DigestData): string {
  const bits: string[] = [];
  if (d.news.length) bits.push(plural(d.news.length, 'reply', 'replies') + ' from employers');
  if (d.toVoteTotal) bits.push(`${d.toVoteTotal} new job${d.toVoteTotal === 1 ? '' : 's'} to vote on`);
  if (d.ready.length + d.waiting.length) bits.push(`${d.ready.length + d.waiting.length} thing${d.ready.length + d.waiting.length === 1 ? '' : 's'} to OK`);
  return `Your job search today${bits.length ? ` — ${bits.join(', ')}` : ''}`;
}

export function buildDigest(d: DigestData): { subject: string; text: string; html: string } {
  const subject = digestSubject(d);
  const app = d.appUrl.replace(/\/$/, '');
  const todo = d.toVoteTotal + d.ready.length + d.waiting.length;

  // ---------- plain text
  const t: string[] = [`Good morning ${d.firstName}!`, ''];
  if (d.news.length) t.push('NEWS FROM EMPLOYERS', ...d.news.map((n) => `  • ${n.company}: ${n.summary}`), '');
  t.push('WHAT YOU NEED TO DO');
  if (!todo) t.push('  Nothing today — enjoy it!');
  if (d.toVoteTotal) {
    t.push(`  Vote on ${plural(d.toVoteTotal, 'new job')} (👍 if you like it, 👎 if not — that's how I learn what to look for):`);
    for (const j of d.toVote) t.push(`   - ${j.title} — ${j.company} (${[j.work_mode === 'remote' ? 'remote' : j.location, j.salary].filter(Boolean).join(', ')}), fit ${j.fit_score}`, `       👍 ${d.voteLinks[j.id].up}`, `       👎 ${d.voteLinks[j.id].down}`);
    if (d.toVoteTotal > d.toVote.length) t.push(`   …and ${d.toVoteTotal - d.toVote.length} more: ${app}/#/jobs`);
  }
  if (d.ready.length) t.push(`  Look over ${plural(d.ready.length, 'application')} I wrote: ${app}/#/`);
  if (d.waiting.length) t.push(`  OK ${plural(d.waiting.length, 'message')} before I send ${d.waiting.length === 1 ? 'it' : 'them'}: ${app}/#/`);
  t.push('', 'WHAT I DID FOR YOU (last 24 hours)', ...didLines(d.did).map((l) => `  • ${l}`));
  if (d.learned) t.push('', 'WHAT I LEARNED FROM YOU', `  ${d.learned.reply}`, ...d.learned.changes.map((c) => `  • ${c}`));
  t.push('', 'How am I doing? Just reply to this email — tell me what I did well or badly and I’ll adjust.', '', `Open Next Chapter: ${app}`);

  // ---------- HTML
  const btn = (href: string, label: string, bg: string) =>
    `<a href="${esc(href)}" style="display:inline-block;padding:10px 16px;margin:4px 6px 0 0;border-radius:8px;background:${bg};color:#fff;text-decoration:none;font-weight:600;font-size:15px">${label}</a>`;
  const h2 = (s: string) => `<h2 style="font-size:18px;margin:26px 0 8px;color:#1f2a2e">${s}</h2>`;
  const card = (inner: string) => `<div style="border:1px solid #e2ddd2;border-radius:12px;padding:14px 16px;margin:10px 0;background:#fff">${inner}</div>`;
  const h: string[] = [
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1f2a2e;max-width:620px;margin:0 auto;padding:8px">`,
    `<p style="font-size:20px;font-weight:700;margin:8px 0">Good morning ${esc(d.firstName)}! 🌱</p>`,
  ];
  if (d.news.length) {
    h.push(h2('🎉 News from employers'));
    for (const n of d.news) h.push(card(`<strong>${esc(n.company)}</strong><br>${esc(n.summary)}<br>${btn(`${app}/#/applications/${n.application_id}`, 'Open it', '#2f6f62')}`));
  }
  h.push(h2('✅ What you need to do'));
  if (!todo) h.push('<p>Nothing today — enjoy it!</p>');
  if (d.toVoteTotal) {
    h.push(`<p style="margin:4px 0">Vote on ${plural(d.toVoteTotal, 'new job')}. 👍 if you like it, 👎 if not — that’s how I learn what to look for.</p>`);
    for (const j of d.toVote) {
      const where = [j.work_mode === 'remote' ? '🏠 Remote' : j.location ? `📍 ${j.location}` : '', j.salary ?? ''].filter(Boolean).join(' · ');
      h.push(card(
        `<div style="font-weight:700;font-size:17px">${esc(j.title)}</div>`
        + `<div style="color:#5d6b70">${esc(j.company)}${where ? ` · ${esc(where)}` : ''} · fit <strong>${j.fit_score}</strong></div>`
        + (j.fit_summary ? `<div style="margin:6px 0">${esc(j.fit_summary)}</div>` : '')
        + btn(d.voteLinks[j.id].up, '👍 I like it', '#23704a') + btn(d.voteLinks[j.id].down, '👎 Not for me', '#a3332b')
        + ` <a href="${esc(`${app}/#/jobs/${j.id}`)}" style="color:#2f6f62;font-size:14px">details</a>`,
      ));
    }
    if (d.toVoteTotal > d.toVote.length) h.push(`<p><a href="${esc(`${app}/#/jobs`)}" style="color:#2f6f62">…and ${d.toVoteTotal - d.toVote.length} more in the app</a></p>`);
  }
  if (d.ready.length) {
    h.push(card(`<strong>${plural(d.ready.length, 'application')} ready for you to look over</strong><ul style="margin:6px 0">${d.ready.map((r) => `<li><a href="${esc(`${app}/#/applications/${r.id}`)}" style="color:#2f6f62">${esc(r.title)} — ${esc(r.company)}</a></li>`).join('')}</ul>`));
  }
  if (d.waiting.length) {
    h.push(card(`<strong>${plural(d.waiting.length, 'message')} waiting for your OK</strong><ul style="margin:6px 0">${d.waiting.map((w) => `<li>${esc({ application: 'Application', follow_up: 'Follow-up', reply: 'Reply' }[w.kind] ?? w.kind)}${w.company ? ` to ${esc(w.company)}` : ''}</li>`).join('')}</ul>${btn(`${app}/#/`, 'Review them', '#2f6f62')}`));
  }
  h.push(h2('🤖 What I did for you'), `<ul style="margin:4px 0;padding-left:20px">${didLines(d.did).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`);
  if (d.learned) {
    h.push(h2('🧠 What I learned from you'), `<p style="margin:4px 0">${esc(d.learned.reply)}</p>`);
    if (d.learned.changes.length) h.push(`<ul style="margin:4px 0;padding-left:20px">${d.learned.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`);
  }
  h.push(
    `<div style="margin-top:26px;padding:14px 16px;border-radius:12px;background:#e3f0ec">💬 <strong>How am I doing?</strong> Just reply to this email — tell me what I did well or badly and I’ll adjust.</div>`,
    `<p style="margin-top:18px">${btn(app, 'Open Next Chapter', '#2f6f62')}</p>`,
    '</div>',
  );
  return { subject, text: t.join('\n'), html: h.join('\n') };
}

/** One-click vote links. They open a small confirm page (a GET never votes, so link scanners can't). */
async function voteLinks(env: Env, appUrl: string, jobs: DigestJob[]): Promise<DigestData['voteLinks']> {
  const owner = ownerEmail(env) ?? '';
  const out: DigestData['voteLinks'] = {};
  for (const j of jobs) {
    const mk = async (v: 1 | -1) => `${appUrl}/api/q?t=${encodeURIComponent(await signJwt(env, { sub: 0, email: owner, name: '', purpose: `vote:${j.id}:${v}` }, 14 * 86400))}`;
    out[j.id] = { up: await mk(1), down: await mk(-1) };
  }
  return out;
}

export async function collectDigest(env: Env): Promise<DigestData> {
  const prefs = await getPrefs(env);
  const appUrl = ((await getSetting<string>(env, 'app_url')) ?? env.FRONTEND_URL ?? '').replace(/\/$/, '');
  const one = async (sql: string, ...args: unknown[]) => ((await env.DB.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0);
  const all = async <T>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
  const DAY = "datetime('now','-1 day')";

  const toVoteTotal = await one("SELECT COUNT(*) AS n FROM jobs WHERE status = 'new' AND vote IS NULL AND fit_score >= ?", prefs.min_fit_to_recommend);
  const toVote = await all<DigestJob>(
    "SELECT id, title, company, location, work_mode, salary, fit_score, fit_summary FROM jobs WHERE status = 'new' AND vote IS NULL AND fit_score >= ? ORDER BY fit_score DESC, found_at DESC LIMIT 8",
    prefs.min_fit_to_recommend,
  );
  const last = await getSetting<{ at: string; report: { found: number; error?: string }[] }>(env, 'last_search');
  const recent = last && Date.now() - new Date(last.at).getTime() < 26 * 3600_000;
  const learning = await getSetting<{ at: string; reply: string; changes: string[] }>(env, 'last_learning');

  return {
    firstName: prefs.name.split(' ')[0] || 'there',
    appUrl,
    toVote,
    toVoteTotal,
    voteLinks: await voteLinks(env, appUrl, toVote),
    ready: await all("SELECT a.id, j.title, j.company FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.status = 'ready' ORDER BY a.updated_at DESC LIMIT 10"),
    waiting: await all("SELECT o.kind, j.title, j.company FROM outbox o LEFT JOIN applications a ON a.id = o.application_id LEFT JOIN jobs j ON j.id = a.job_id WHERE o.status IN ('pending','failed') ORDER BY o.id DESC LIMIT 10"),
    news: await all(`SELECT j.company, e.summary, e.application_id FROM app_events e JOIN applications a ON a.id = e.application_id JOIN jobs j ON j.id = a.job_id
      WHERE e.type = 'reply' AND e.created_at >= ${DAY} AND e.summary NOT LIKE 'Application received%' ORDER BY e.id DESC LIMIT 6`),
    did: {
      seen: recent ? last!.report.reduce((n, r) => n + r.found, 0) : 0,
      sources: recent ? last!.report.filter((r) => !r.error).length : 0,
      recommended: await one(`SELECT COUNT(*) AS n FROM jobs WHERE found_at >= ${DAY} AND status != 'filtered' AND fit_score >= ?`, prefs.min_fit_to_recommend),
      screenedOut: await one(`SELECT COUNT(*) AS n FROM jobs WHERE found_at >= ${DAY} AND status = 'filtered'`),
      drafted: await one(`SELECT COUNT(*) AS n FROM app_events WHERE type = 'drafted' AND created_at >= ${DAY}`),
      sentApplications: await one(`SELECT COUNT(*) AS n FROM outbox WHERE kind = 'application' AND status = 'sent' AND COALESCE(error,'') != 'Done by hand' AND sent_at >= ${DAY}`),
      sentFollowUps: await one(`SELECT COUNT(*) AS n FROM outbox WHERE kind = 'follow_up' AND status = 'sent' AND COALESCE(error,'') != 'Done by hand' AND sent_at >= ${DAY}`),
      sentReplies: await one(`SELECT COUNT(*) AS n FROM outbox WHERE kind IN ('reply','thank_you') AND status = 'sent' AND COALESCE(error,'') != 'Done by hand' AND sent_at >= ${DAY}`),
      replies: await one(`SELECT COUNT(*) AS n FROM app_events WHERE type = 'reply' AND created_at >= ${DAY}`),
      closed: await one(`SELECT COUNT(*) AS n FROM app_events WHERE type = 'status' AND summary LIKE 'Closed:%' AND created_at >= ${DAY}`),
    },
    learned: learning && Date.now() - new Date(learning.at).getTime() < 26 * 3600_000 ? { reply: learning.reply, changes: learning.changes } : null,
  };
}

export async function sendDigest(env: Env): Promise<{ sent: boolean; subject?: string }> {
  const status = await gmailStatus(env);
  if (!status.connected || !status.email) return { sent: false };
  const d = await collectDigest(env);
  const { subject, text, html } = buildDigest(d);
  await sendEmail(env, { fromName: 'Next Chapter', to: status.email, subject, text, html });
  await logActivity(env, 'digest', `Sent the morning email: ${subject}`);
  return { sent: true, subject };
}
