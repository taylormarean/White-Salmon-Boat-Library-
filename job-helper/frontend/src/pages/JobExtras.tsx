import { useState } from 'react';
import { api } from '../api';
import { Btn, useLoad, useToast, when } from '../ui';

interface Report {
  summary: string; what_they_sell: string; size_and_stage: string; funding: string; layoffs_or_turmoil: string; sales_team_reviews: string;
  pay_realism: string; green_flags: string[]; red_flags: string[]; verdict: 'good' | 'mixed' | 'caution'; sources: string[]; checked_at: string;
}
interface Person { id: number; person_name: string; person_title: string; profile_url: string; why: string; linkedin_note: string; email_subject: string; email_body: string; status: string }

const VERDICT = { good: { label: 'Looks good', cls: 'great' }, mixed: { label: 'Mixed', cls: 'stretch' }, caution: { label: 'Be careful', cls: 'caution' } };

/** Company check, "is it still open?", and people to reach out to — shown on a job's page. */
export default function JobExtras({ job, reload }: { job: { id: number; company: string; company_report: string | null; still_open: number | null; checked_open_at: string | null }; reload: () => void }) {
  const toast = useToast();
  const report = job.company_report ? (JSON.parse(job.company_report) as Report) : null;
  const people = useLoad<Person[]>(`/jobs/${job.id}/outreach`);
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="card">
        <div className="row between">
          <h2>🏢 About {job.company}</h2>
          {report && <span className={`badge ${VERDICT[report.verdict].cls}`}>{VERDICT[report.verdict].label}</span>}
        </div>
        {job.still_open === 0 && <div className="notes" style={{ background: 'var(--bad-soft)', marginBottom: '.75rem' }}>⚠️ This posting looks closed (checked {when(job.checked_open_at)}). It may not be worth applying.</div>}
        {job.still_open === 1 && <p className="small muted">✅ Still open as of {when(job.checked_open_at)}.</p>}
        {!report ? (
          <>
            <p className="small muted">Before you apply, I can look into this company — what they sell, how they’re doing, what their employees say, and whether the pay looks realistic.</p>
            <Btn className="primary" busyText="Researching… (about a minute)" onClick={async () => { await api(`/jobs/${job.id}/research`, { method: 'POST' }); reload(); }}>Check out this company</Btn>
          </>
        ) : (
          <>
            <p>{report.summary}</p>
            <button className="ghost" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show the details'}</button>
            {open && (
              <div className="small">
                <p><strong>What they sell:</strong> {report.what_they_sell}</p>
                <p><strong>Size & stage:</strong> {report.size_and_stage} · <strong>Funding:</strong> {report.funding}</p>
                <p><strong>Layoffs or turmoil:</strong> {report.layoffs_or_turmoil}</p>
                <p><strong>What employees say:</strong> {report.sales_team_reviews}</p>
                <p><strong>Is the pay realistic?</strong> {report.pay_realism}</p>
                {report.green_flags.length > 0 && <><strong>👍 Good signs</strong><ul>{report.green_flags.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
                {report.red_flags.length > 0 && <><strong>⚠️ Watch out</strong><ul>{report.red_flags.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
                {report.sources.length > 0 && <p className="muted">Sources: {report.sources.slice(0, 6).map((s, i) => <span key={i}><a href={s} target="_blank" rel="noreferrer">{new URL(s, 'https://x').hostname.replace(/^www\./, '')}</a>{i < Math.min(report.sources.length, 6) - 1 ? ' · ' : ''}</span>)}</p>}
                <p className="muted">Checked {when(report.checked_at)}.</p>
              </div>
            )}
          </>
        )}
        <div className="row" style={{ marginTop: '.5rem' }}>
          <Btn className="ghost" busyText="Checking…" onClick={async () => { const r = await api<{ still_open: boolean | null }>(`/jobs/${job.id}/check-open`, { method: 'POST' }); toast(r.still_open === null ? 'Couldn’t reach the posting — try opening it yourself.' : r.still_open ? 'Still open ✅' : 'Looks closed ⚠️'); reload(); }}>Is it still open?</Btn>
          {report && <Btn className="ghost" busyText="Researching…" onClick={async () => { await api(`/jobs/${job.id}/research`, { method: 'POST' }); reload(); }}>Check again</Btn>}
        </div>
      </div>

      <div className="card">
        <h2>🤝 Reach out to a real person</h2>
        <p className="small muted">A short, friendly note to the hiring manager or recruiter makes your application stand out — especially in sales. I’ll find who to contact and draft the note; you send it on LinkedIn yourself.</p>
        {(people.data ?? []).length === 0 ? (
          <Btn className="primary" busyText="Looking for the right people…" onClick={async () => { const r = await api<{ people: Person[]; note?: string }>(`/jobs/${job.id}/outreach`, { method: 'POST' }); if (r.note) toast(r.note); people.reload(); }}>Find who to contact</Btn>
        ) : (people.data ?? []).map((p) => (
          <div key={p.id} className="mini" style={{ cursor: 'default' }}>
            <div className="row between">
              <div><strong>{p.person_name}</strong> — {p.person_title}<div className="small muted">{p.why}</div></div>
              <span className={`badge ${p.status === 'sent' ? 'won' : ''}`}>{p.status === 'drafted' ? 'not sent yet' : p.status}</span>
            </div>
            <pre className="mail small" style={{ margin: '.5rem 0' }}>{p.linkedin_note}</pre>
            <div className="row">
              <button onClick={() => navigator.clipboard.writeText(p.linkedin_note).then(() => toast('Copied — paste it into the LinkedIn “Add a note” box'))}>📋 Copy note</button>
              {p.profile_url && <a className="btn" href={p.profile_url} target="_blank" rel="noreferrer">Open their profile ↗</a>}
              {p.status === 'drafted' && <Btn className="ghost" onClick={async () => { await api(`/outreach/${p.id}`, { method: 'PATCH', body: { status: 'sent' } }); people.reload(); }}>I sent it</Btn>}
              {p.status === 'sent' && <Btn className="ghost" onClick={async () => { await api(`/outreach/${p.id}`, { method: 'PATCH', body: { status: 'replied' } }); people.reload(); }}>They replied</Btn>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
