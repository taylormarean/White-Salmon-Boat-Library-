import { useState } from 'react';
import { api } from '../api';
import { Btn, Loading, Markdown, useLoad, useToast } from '../ui';

interface Interview { id: number; starts_at: string | null; kind: string | null; interviewers: string | null; prep_md: string | null; calendar_event_id: string | null; status: string; notes: string | null }

/** Interviews for one application: schedule (→ calendar), prep sheet, "how did it go?" → thank-you note. */
export function Interviews({ appId, onChange }: { appId: number; onChange: () => void }) {
  const list = useLoad<{ interviews: Interview[]; calendar: boolean }>(`/interviews?application_id=${appId}`);
  const [free, setFree] = useState<string[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [when, setWhen] = useState('');
  const [kind, setKind] = useState('Phone screen');
  const [who, setWho] = useState('');
  const [doneFor, setDoneFor] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [emails, setEmails] = useState('');
  const [openPrep, setOpenPrep] = useState<number | null>(null);
  const toast = useToast();
  if (!list.data) return <Loading />;
  const items = list.data.interviews;

  return (
    <div>
      {!adding && (
        <div className="row" style={{ marginBottom: '1rem' }}>
          <button className="primary" onClick={() => setAdding(true)}>➕ I have an interview</button>
          <a className="btn" href="#/practice">🎤 Practice first</a>
        </div>
      )}
      {adding && (
        <div className="card hl">
          <h3>Tell me about the interview</h3>
          <div className="grid2">
            <div><label>When <span className="hint">leave blank if not scheduled yet</span></label><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
            <div><label>What kind</label>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {['Phone screen', 'Video interview', 'Hiring manager', 'Panel', 'Role-play / mock call', 'Final interview', 'In person'].map((k) => <option key={k}>{k}</option>)}
              </select></div>
          </div>
          <label>Who you’ll talk to <span className="hint">names and titles if you know them</span></label>
          <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="e.g. Sam Ortiz, Sales Manager" />
          <p className="small muted">{list.data.calendar ? '📅 I’ll add it to your Google Calendar with reminders.' : 'Connect Google Calendar in Settings and I’ll add interviews to it automatically.'}</p>
          <div className="row">
            <Btn className="primary" busyText="Researching the company and writing your prep sheet… (1–2 min)" onClick={async () => {
              await api(`/applications/${appId}/interviews`, { body: { starts_at: when ? new Date(when).toISOString() : undefined, kind, interviewers: who } });
              setAdding(false); setWhen(''); setWho(''); list.reload(); onChange();
            }}>Save and prepare me</Btn>
            <button onClick={() => setAdding(false)}>Cancel</button>
            {list.data.calendar && <Btn className="ghost" onClick={async () => setFree((await api<{ times: string[] }>('/calendar/suggest')).times)}>When am I free?</Btn>}
          </div>
          {free && <p className="small">You look free: {free.join(' · ') || 'no open slots found in the next week'}</p>}
        </div>
      )}
      {items.length === 0 && !adding && <div className="card empty">No interviews yet. When an employer wants to talk, tap “I have an interview” and I’ll prepare you.</div>}
      {items.map((i) => (
        <div key={i.id} className="card">
          <div className="row between">
            <div>
              <strong>{i.kind ?? 'Interview'}</strong>{i.interviewers ? ` with ${i.interviewers}` : ''}
              <div className="small muted">{i.starts_at ? new Date(i.starts_at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }) : 'Time not set'}{i.calendar_event_id ? ' · 📅 on your calendar' : ''}</div>
            </div>
            <span className={`badge ${i.status === 'done' ? 'won' : 'interviewing'}`}>{i.status === 'done' ? 'Done' : 'Coming up'}</span>
          </div>
          <div className="row" style={{ marginTop: '.6rem' }}>
            <button onClick={() => setOpenPrep(openPrep === i.id ? null : i.id)}>{openPrep === i.id ? 'Hide' : '📄 Open'} my prep sheet</button>
            {openPrep === i.id && <button onClick={() => window.print()}>🖨️ Print</button>}
            <Btn className="ghost" busyText="Rewriting…" onClick={async () => { await api(`/interviews/${i.id}/prep`, { method: 'POST' }); list.reload(); }}>Refresh prep</Btn>
            {i.status !== 'done' && <button className="ghost" onClick={() => { setDoneFor(i.id); setNotes(''); setEmails(''); }}>✅ I had it — how did it go?</button>}
          </div>
          {doneFor === i.id && (
            <div style={{ marginTop: '.75rem' }}>
              <label>A few notes about the conversation <span className="hint">what you talked about, anything you liked — I’ll use it in your thank-you note</span></label>
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              <label>Their email address(es) <span className="hint">for the thank-you note</span></label>
              <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="sam@company.com" />
              <div className="row" style={{ marginTop: '.5rem' }}>
                <Btn className="primary" busyText="Writing your thank-you note…" onClick={async () => { await api(`/interviews/${i.id}/done`, { body: { notes, emails } }); setDoneFor(null); toast('Thank-you note drafted — it’s at the top of this page, waiting for your OK.'); list.reload(); onChange(); }}>Write my thank-you note</Btn>
                <button onClick={() => setDoneFor(null)}>Cancel</button>
              </div>
            </div>
          )}
          {openPrep === i.id && i.prep_md && <div className="doc-preview" style={{ marginTop: '.75rem' }}><Markdown text={i.prep_md} /></div>}
        </div>
      ))}
    </div>
  );
}

interface OfferReview {
  summary: string; components: Record<string, string>; market_range: string; how_it_compares: string; strengths: string[]; concerns: string[];
  questions_to_ask: string[]; counter: { ask: string; rationale: string }; notes_for_her: string; details: string; reviewed_at: string;
}

/** Paste the offer → plain-language review, market comparison, questions, and a negotiation email draft. */
export function Offer({ appId, onChange }: { appId: number; onChange: () => void }) {
  const r = useLoad<OfferReview | null>(`/applications/${appId}/offer`);
  const [details, setDetails] = useState('');
  if (r.loading && !r.data) return <Loading />;
  const o = r.data;
  return (
    <div>
      <div className="card">
        <h3>{o ? 'Got a new version of the offer?' : 'Got an offer? 🎉'}</h3>
        <p className="small muted">Paste the offer letter or type what they told you — base pay, commission or bonus, benefits, start date. I’ll compare it to the market, tell you what to ask, and draft a polite negotiation email (it waits for your OK).</p>
        <textarea rows={5} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Base $60,000, on-target earnings $95,000, 10% commission uncapped, health insurance, 401k match 3%, start Dec 1…" />
        <p><Btn className="primary" disabled={details.trim().length < 20} busyText="Reviewing the offer… (about a minute)" onClick={async () => { await api(`/applications/${appId}/offer`, { body: { details } }); setDetails(''); r.reload(); onChange(); }}>Review my offer</Btn></p>
      </div>
      {o && (
        <div className="card hl">
          <h2>Your offer, in plain words</h2>
          <p>{o.summary}</p>
          <div className="grid2 small">
            {Object.entries(o.components).filter(([, v]) => v).map(([k, v]) => <div key={k}><strong>{k.replace(/_/g, ' ')}:</strong> {v}</div>)}
          </div>
          <p><strong>Typical pay for this role:</strong> {o.market_range}</p>
          <p><strong>How yours compares:</strong> {o.how_it_compares}</p>
          <div className="grid2">
            <div><h3>👍 Good</h3><ul>{o.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            <div><h3>🤔 Ask about</h3><ul>{o.concerns.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          </div>
          <h3>Questions to ask before you say yes</h3>
          <ul>{o.questions_to_ask.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <div className="notes"><strong>What I’d ask for:</strong> {o.counter.ask} — {o.counter.rationale}{o.notes_for_her ? <><br />💡 {o.notes_for_her}</> : null}</div>
          <p className="small muted" style={{ marginTop: '.75rem' }}>Your negotiation email is drafted at the top of this page, waiting for your OK. Only send it if you want to negotiate.</p>
        </div>
      )}
    </div>
  );
}
