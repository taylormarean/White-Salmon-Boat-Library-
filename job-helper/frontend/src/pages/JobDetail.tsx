import { useState } from 'react';
import { api } from '../api';
import { Btn, ErrorBox, Fit, FIT_WORD, Loading, meta, MODE, useLoad, VoteButtons, when } from '../ui';

interface JobFull {
  id: number; title: string; company: string; location: string; work_mode: string; salary: string; description: string; url: string; apply_url: string;
  posted_at: string; found_at: string; source: string; status: string; fit_score: number | null; fit_label: string | null; fit_summary: string | null;
  apply_method: string | null; application_email: string | null; vote: number | null; vote_reason: string | null;
  fit: { strengths: string[]; gaps: string[]; red_flags: string[] } | null;
  application: { id: number; status: string } | null;
}

const SOURCE: Record<string, string> = { remotive: 'Remotive', remoteok: 'RemoteOK', himalayas: 'Himalayas', adzuna: 'Adzuna', usajobs: 'USAJobs', greenhouse: 'company careers page', lever: 'company careers page', rss: 'job feed', web_scout: 'web search', manual: 'you' };

export default function JobDetail({ id }: { id: string }) {
  const { data: j, error, reload } = useLoad<JobFull>(`/jobs/${id}`);
  const [more, setMore] = useState(false);
  if (error) return <ErrorBox error={error} />;
  if (!j) return <Loading />;
  const long = j.description.length > 1600;

  return (
    <div>
      <a href="#/jobs" className="small">← All jobs</a>
      <div className="row" style={{ marginTop: '.5rem', alignItems: 'flex-start' }}>
        <Fit score={j.fit_score} label={j.fit_label} />
        <div className="grow">
          <h1>{j.title}</h1>
          <div className="muted">{meta(j.company, MODE[j.work_mode], j.location, j.salary)}</div>
          <div className="small muted">Found {when(j.found_at)} via {SOURCE[j.source] ?? j.source}{j.posted_at ? ` · posted ${when(j.posted_at)}` : ''}</div>
        </div>
      </div>

      <div className="card hl no-print" style={{ marginTop: '1rem' }}>
        <div className="row between">
          <strong>{j.vote === 1 ? '👍 You liked this one' : j.vote === -1 ? '👎 You said this isn’t for you' : 'Do you like this job?'}</strong>
          {j.vote_reason && <span className="small muted">“{j.vote_reason}”</span>}
        </div>
        <div style={{ marginTop: '.5rem' }}><VoteButtons jobId={j.id} vote={j.vote} onVoted={reload} big /></div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        {j.fit_score === null ? (
          <div className="row between">
            <span>{j.fit_summary ?? 'This job hasn’t been checked against your experience yet.'}</span>
            <Btn className="primary" busyText="Checking…" onClick={async () => { await api(`/jobs/${j.id}/score`, { method: 'POST' }); reload(); }}>Check the fit</Btn>
          </div>
        ) : (
          <>
            <h2>{j.fit_label ? FIT_WORD[j.fit_label] : ''}</h2>
            <p>{j.fit_summary}</p>
            {j.fit && (
              <div className="grid2">
                {j.fit.strengths.length > 0 && <div><h3>👍 Why you fit</h3><ul>{j.fit.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
                {j.fit.gaps.length > 0 && <div><h3>🤔 Things they want that you may not have</h3><ul>{j.fit.gaps.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
              </div>
            )}
            {j.fit && j.fit.red_flags.length > 0 && (
              <div className="card warn" style={{ marginTop: '.75rem' }}>
                <h3>⚠️ Be careful with this one</h3>
                <ul>{j.fit.red_flags.map((s, i) => <li key={i}>{s}</li>)}</ul>
                <p className="small">Never pay to apply, buy gift cards, or share your bank or Social Security number before a real interview.</p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="row no-print" style={{ margin: '1rem 0' }}>
        {j.application ? (
          <a className="btn primary big" href={`#/applications/${j.application.id}`}>Open my application →</a>
        ) : (
          <Btn className="primary big" busyText="Writing your resume and cover letter… (about a minute)"
            onClick={async () => { const r = await api<{ id: number }>(`/jobs/${j.id}/prepare`, { body: {} }); window.location.hash = `#/applications/${r.id}`; }}>
            ✍️ Help me apply
          </Btn>
        )}
        {j.url && <a className="btn" href={j.url} target="_blank" rel="noreferrer">Open the original posting ↗</a>}

      </div>

      <div className="card">
        <h2>The posting</h2>
        {j.apply_method === 'email' && j.application_email && <p className="small">📧 They take applications by email at <strong>{j.application_email}</strong> — the app can send it for you.</p>}
        <div style={{ whiteSpace: 'pre-wrap' }}>{long && !more ? `${j.description.slice(0, 1600)}…` : j.description}</div>
        {long && <button className="ghost" onClick={() => setMore(!more)}>{more ? 'Show less' : 'Show the whole posting'}</button>}
      </div>
    </div>
  );
}
