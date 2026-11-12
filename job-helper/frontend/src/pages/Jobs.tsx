import { useState } from 'react';
import { api } from '../api';
import { Btn, ErrorBox, Fit, Loading, meta, MODE, useLoad, when } from '../ui';

interface Job { id: number; title: string; company: string; location: string; work_mode: string; salary: string; fit_score: number | null; fit_label: string | null; fit_summary: string | null; status: string; found_at: string; source: string; application_id: number | null; url: string }

const VIEWS = [
  { key: 'new', label: 'New' },
  { key: 'shortlisted', label: 'Saved' },
  { key: 'applying', label: 'Applying' },
  { key: 'dismissed', label: 'Not interested' },
  { key: 'filtered', label: 'Screened out' },
];

export default function Jobs() {
  const [view, setView] = useState('new');
  const [mode, setMode] = useState('');
  const [min, setMin] = useState(view === 'new' ? 0 : 0);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const list = useLoad<{ jobs: Job[]; totals: { status: string; n: number }[] }>(`/jobs?status=${view}&mode=${mode}&min=${min}&q=${encodeURIComponent(q)}`);
  const count = (k: string) => list.data?.totals.find((t) => t.status === k)?.n ?? 0;

  return (
    <div>
      <div className="row between">
        <div>
          <h1>Jobs</h1>
          <p className="muted">Found automatically every morning and checked against your experience.</p>
        </div>
        <button onClick={() => setAdding(!adding)}>➕ Add a job I found</button>
      </div>
      {adding && <AddJob onDone={(id) => { window.location.hash = `#/jobs/${id}`; }} />}

      <div className="tabs">
        {VIEWS.map((v) => <button key={v.key} className={view === v.key ? 'on' : ''} onClick={() => setView(v.key)}>{v.label} ({count(v.key)})</button>)}
      </div>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Remote and local</option>
          <option value="remote">Remote only</option>
          <option value="local">In person / hybrid only</option>
        </select>
        <select value={min} onChange={(e) => setMin(Number(e.target.value))} style={{ width: 'auto' }}>
          <option value={0}>Any fit</option>
          <option value={50}>Stretch or better</option>
          <option value={70}>Good fits</option>
          <option value={85}>Great fits</option>
        </select>
        <input placeholder="Search title, company, town…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
      </div>

      {list.error && <ErrorBox error={list.error} />}
      {!list.data ? <Loading /> : list.data.jobs.length === 0 ? <div className="card empty">Nothing here yet.</div> : list.data.jobs.map((j) => (
        <div key={j.id} className="card row" style={{ alignItems: 'flex-start' }}>
          <Fit score={j.fit_score} label={j.fit_label} />
          <div className="grow">
            <a href={`#/jobs/${j.id}`} style={{ color: 'inherit', textDecoration: 'none' }}><h3>{j.title}</h3></a>
            <div className="muted small">{meta(j.company, MODE[j.work_mode], j.location, j.salary, `found ${when(j.found_at)}`)}</div>
            {j.fit_summary && <p className="small">{j.fit_summary}</p>}
            <div className="row">
              <a className="btn primary" href={`#/jobs/${j.id}`}>See details</a>
              {j.application_id ? <a className="btn" href={`#/applications/${j.application_id}`}>Open application</a> : null}
              {j.status === 'new' && (
                <>
                  <Btn onClick={async () => { await api(`/jobs/${j.id}`, { method: 'PATCH', body: { status: 'shortlisted' } }); list.reload(); }} done="Saved for later">☆ Save</Btn>
                  <Btn className="ghost" onClick={async () => { await api(`/jobs/${j.id}`, { method: 'PATCH', body: { status: 'dismissed' } }); list.reload(); }}>Not interested</Btn>
                </>
              )}
              {(j.status === 'dismissed' || j.status === 'filtered') && (
                <Btn className="ghost" onClick={async () => { await api(`/jobs/${j.id}`, { method: 'PATCH', body: { status: 'shortlisted' } }); list.reload(); }} done="Moved to Saved">Actually, I’m interested</Btn>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AddJob({ onDone }: { onDone: (id: number) => void }) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  return (
    <div className="card hl">
      <h2>Add a job you found</h2>
      <p className="small muted">Saw something in the paper, on a store window, or online? Paste the whole posting and the app will check the fit and help you apply.</p>
      <label>Link to the posting <span className="hint">optional</span></label>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
      <label>The posting itself <span className="hint">copy and paste everything — title, duties, requirements, how to apply</span></label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} />
      <p><Btn className="primary" busyText="Reading the posting…" onClick={async () => { const r = await api<{ id: number }>('/jobs', { body: { url, text } }); onDone(r.id); }}>Add and check the fit</Btn></p>
    </div>
  );
}
