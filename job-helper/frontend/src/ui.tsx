import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

// ---------------------------------------------------------------- toast

const ToastCtx = createContext<(msg: string, err?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; err: boolean } | null>(null);
  const show = useCallback((msg: string, err = false) => {
    setT({ msg, err });
    setTimeout(() => setT(null), err ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={`toast ${t.err ? 'err' : ''}`} role="status">{t.msg}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------- data loading

export function useLoad<T>(path: string | null, deps: unknown[] = []): { data: T | null; error: string | null; reload: () => void; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    api<T>(path).then((d) => live && (setData(d), setError(null))).catch((e) => live && setError(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, n, ...deps]);
  return { data, error, reload: () => setN((x) => x + 1), loading };
}

/** A button that shows a spinner while its async action runs and reports errors. */
export function Btn({ onClick, children, className = '', busyText, done, disabled, title }: {
  onClick: () => Promise<unknown> | unknown; children: ReactNode; className?: string; busyText?: string; done?: string; disabled?: boolean; title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <button className={className} disabled={busy || disabled} title={title} onClick={async () => {
      setBusy(true);
      try {
        await onClick();
        if (done) toast(done);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), true);
      } finally {
        setBusy(false);
      }
    }}>
      {busy ? <><span className="spinner" /> {busyText ?? 'Working…'}</> : children}
    </button>
  );
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return <div className="empty"><span className="spinner" /> {text}</div>;
}

export function ErrorBox({ error }: { error: string }) {
  return <div className="card warn">⚠️ {error}</div>;
}

// ---------------------------------------------------------------- labels

export const STATUS: Record<string, string> = {
  drafting: 'Drafting', ready: 'Ready for you', submitted: 'Applied', following_up: 'Following up', interviewing: 'Interviewing',
  offer: 'Offer!', won: 'Hired 🎉', rejected: 'Not selected', closed: 'Closed', withdrawn: 'Withdrawn',
};
export function StatusBadge({ s }: { s: string }) {
  return <span className={`badge ${s}`}>{STATUS[s] ?? s}</span>;
}
export const FIT_WORD: Record<string, string> = { great: 'Great fit', good: 'Good fit', stretch: 'Stretch', poor: 'Poor fit', caution: 'Be careful' };
export function Fit({ score, label }: { score: number | null; label: string | null }) {
  return <div className={`fit ${label ?? ''}`} title={label ? FIT_WORD[label] : 'Not checked yet'}>{score ?? '–'}</div>;
}
export const MODE: Record<string, string> = { remote: '🏠 Remote', onsite: '📍 In person', hybrid: '🔀 Hybrid', unknown: '' };

/** "📍 In person · Hood River, OR · $24/hr" — skips empty parts. */
export function meta(...parts: (string | null | undefined | false)[]): string {
  const kept = parts.filter((p): p is string => !!p && !!p.trim());
  // "🏠 Remote · Remote (US)" → "🏠 Remote (US)"
  const remoteLoc = kept.find((p) => /^remote\b/i.test(p));
  return kept
    .filter((p) => !(remoteLoc && p === MODE.remote))
    .map((p) => (remoteLoc && p === remoteLoc ? `🏠 ${p}` : p))
    .join(' · ');
}

export function when(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 0) return d.toLocaleDateString();
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------- markdown (resume subset, escaped)

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>));
}
export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(<p key={out.length}>{inline(para.join(' '))}</p>);
    if (list.length) out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    para = [];
    list = [];
  };
  for (const line of text.split('\n')) {
    const t = line.trimEnd();
    if (!t.trim()) { flush(); continue; }
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flush();
      const H = (`h${h[1].length}`) as 'h1' | 'h2' | 'h3';
      out.push(<H key={out.length}>{inline(h[2])}</H>);
      continue;
    }
    const b = t.match(/^\s*[-*•]\s+(.*)$/);
    if (b) {
      if (para.length) { const p = para; para = []; out.push(<p key={out.length}>{inline(p.join(' '))}</p>); }
      list.push(b[1]);
      continue;
    }
    if (list.length) flush();
    para.push(t);
  }
  flush();
  return <>{out}</>;
}

// ---------------------------------------------------------------- one outgoing message (outbox row)

export interface OutboxItem {
  id: number; application_id: number | null; kind: string; to_email: string | null; subject: string; body: string; status: string;
  error: string | null; notes_for_her: string | null; title?: string; company?: string; sent_at?: string | null; created_at: string; approved_by?: string | null;
}
const KIND: Record<string, string> = { application: 'Application email', follow_up: 'Follow-up', reply: 'Reply', thank_you: 'Thank-you note' };

export function MessageCard({ m, onChange, showJob = true }: { m: OutboxItem; onChange: () => void; showJob?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [to, setTo] = useState(m.to_email ?? '');
  const [subject, setSubject] = useState(m.subject);
  const [body, setBody] = useState(m.body);
  const save = () => api(`/outbox/${m.id}`, { method: 'PATCH', body: { to_email: to, subject, body } });
  const open = m.status === 'pending' || m.status === 'failed';
  return (
    <div className={`card ${open ? 'hl' : ''}`}>
      <div className="row between">
        <div>
          <strong>{KIND[m.kind] ?? m.kind}</strong>
          {showJob && m.company && <> · {m.title} at {m.company} {m.application_id && <a href={`#/applications/${m.application_id}`} className="small">open</a>}</>}
        </div>
        <span className={`badge ${m.status === 'failed' ? 'rejected' : m.status === 'sent' ? 'won' : ''}`}>
          {m.status === 'pending' ? 'Waiting for your OK' : m.status === 'sent' ? `Sent ${when(m.sent_at)}${m.error === 'Done by hand' ? ' (by you)' : ''}` : m.status}
        </span>
      </div>
      {m.status === 'failed' && m.error && <p className="small" style={{ color: 'var(--bad)' }}>Couldn’t send: {m.error}</p>}
      {m.notes_for_her && open && <div className="notes small" style={{ margin: '.6rem 0' }}>💡 {m.notes_for_her}</div>}
      {editing ? (
        <div>
          <label>To</label>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" />
          <label>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          <label>Message</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} />
        </div>
      ) : (
        <>
          <p className="small muted" style={{ margin: '.5rem 0 .25rem' }}>To: {m.to_email || <em>no email address yet</em>} · Subject: {m.subject}</p>
          <pre className="mail">{m.body}</pre>
        </>
      )}
      {open && !editing && (m.kind === 'follow_up' || m.kind === 'reply') && (
        <details style={{ marginTop: '.6rem' }}>
          <summary className="small">Tell me how this draft was</summary>
          <div style={{ marginTop: '.5rem' }}><FeedbackBox compact about={m.kind} applicationId={m.application_id ?? undefined} prompt="This message:" context={`${m.subject}\n${m.body}`} /></div>
        </details>
      )}
      {open && (
        <div className="row" style={{ marginTop: '.75rem' }}>
          {editing ? (
            <>
              <Btn className="primary" onClick={async () => { await save(); setEditing(false); onChange(); }} done="Saved">Save changes</Btn>
              <button onClick={() => setEditing(false)}>Cancel</button>
            </>
          ) : (
            <>
              <Btn className="primary big" disabled={!m.to_email} title={m.to_email ? '' : 'Add an email address first'} busyText="Sending…" done="Sent!"
                onClick={async () => { await api(`/outbox/${m.id}/approve`, { method: 'POST' }); onChange(); }}>✉️ Looks good — send it</Btn>
              <button onClick={() => setEditing(true)}>✏️ Edit</button>
              <Btn onClick={async () => { await api(`/outbox/${m.id}/done`, { method: 'POST' }); onChange(); }} done="Marked as done">I did this myself</Btn>
              <Btn className="ghost danger" onClick={async () => { await api(`/outbox/${m.id}/cancel`, { method: 'POST' }); onChange(); }}>Don’t send</Btn>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 👍 / 👎 on a job (required for every recommendation)

const UP: Record<string, string> = { role: 'The kind of work I want', company: 'Great company', pay: 'Good pay', remote: 'Location / remote works', other: 'Something else' };
const DOWN: Record<string, string> = {
  not_my_kind: 'Not the kind of work I want', too_senior: 'Needs skills I don’t have', too_junior: 'Too junior', pay: 'Pay too low',
  location: 'Too far / wrong location', company: 'Don’t want this company', schedule: 'Hours don’t work', other: 'Something else',
};

export function VoteButtons({ jobId, vote, onVoted, big = false }: { jobId: number; vote: number | null; onVoted: () => void; big?: boolean }) {
  const [mine, setMine] = useState<number | null>(vote);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const toast = useToast();
  const cast = async (v: 1 | -1, r?: string, n?: string) => {
    const res = await api<{ blockedCompany: string | null; withdrew: boolean }>(`/jobs/${jobId}/vote`, { body: { vote: v, reason: r, note: n } });
    setMine(v);
    if (res.blockedCompany) toast(`Got it — no more jobs from ${res.blockedCompany}.`);
    return res;
  };
  if (asking && mine) {
    const reasons = mine > 0 ? UP : DOWN;
    return (
      <div className="vote-why">
        <div className="small"><strong>{mine > 0 ? '👍 Thanks! What do you like about it?' : '👎 Got it. What’s wrong with it?'}</strong> <span className="muted">optional — it helps me learn</span></div>
        <div className="row" style={{ gap: '.4rem', margin: '.5rem 0' }}>
          {Object.entries(reasons).map(([k, v]) => (
            <button key={k} className={`chip ${reason === k ? 'on' : ''}`} onClick={() => setReason(reason === k ? '' : k)}>{v}</button>
          ))}
        </div>
        <div className="row">
          <input className="grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything else? (optional)" />
          <Btn className="primary" onClick={async () => { if (reason || note.trim()) await cast(mine as 1 | -1, reason || undefined, note.trim() || undefined); setAsking(false); onVoted(); }}>Done</Btn>
        </div>
      </div>
    );
  }
  return (
    <div className="row" style={{ gap: '.5rem' }}>
      <Btn className={`vote up ${mine === 1 ? 'on' : ''} ${big ? 'big' : ''}`} onClick={async () => { await cast(1); setReason(''); setAsking(true); }}>👍 I like it</Btn>
      <Btn className={`vote down ${mine === -1 ? 'on' : ''} ${big ? 'big' : ''}`} onClick={async () => { await cast(-1); setReason(''); setAsking(true); }}>👎 Not for me</Btn>
    </div>
  );
}

// ---------------------------------------------------------------- "How did I do?" feedback

export function FeedbackBox({ about = 'general', applicationId, context, prompt, onDone, compact = false }: {
  about?: string; applicationId?: number; context?: string; prompt?: string; onDone?: () => void; compact?: boolean;
}) {
  const [sentiment, setSentiment] = useState<'good' | 'bad' | null>(null);
  const [text, setText] = useState('');
  const [reply, setReply] = useState<{ reply: string; changes: string[] } | null>(null);
  if (reply) {
    return (
      <div className="notes" style={{ background: 'var(--brand-soft)' }}>
        🧠 {reply.reply}
        {reply.changes.length > 0 && <ul className="small" style={{ margin: '.4rem 0 0' }}>{reply.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
        <div><button className="ghost small" onClick={() => { setReply(null); setSentiment(null); setText(''); }}>Tell me something else</button></div>
      </div>
    );
  }
  return (
    <div className={compact ? '' : 'card'}>
      <div className="row" style={{ gap: '.5rem' }}>
        <span className={compact ? 'small' : ''}><strong>{prompt ?? 'How am I doing?'}</strong></span>
        <button className={`chip ${sentiment === 'good' ? 'on' : ''}`} onClick={() => setSentiment('good')}>👍 Did well</button>
        <button className={`chip ${sentiment === 'bad' ? 'on' : ''}`} onClick={() => setSentiment('bad')}>👎 Needs work</button>
      </div>
      {sentiment && (
        <div style={{ marginTop: '.6rem' }}>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={sentiment === 'good' ? 'What did you like? (optional)' : 'What should I do differently? e.g. “Too formal”, “Stop sending jobs that need a degree”'} />
          <div className="row" style={{ marginTop: '.5rem' }}>
            <Btn className="primary" busyText="Learning…" disabled={sentiment === 'bad' && !text.trim()}
              onClick={async () => { setReply(await api('/feedback', { body: { sentiment, about, application_id: applicationId, context, text } })); onDone?.(); }}>
              Send
            </Btn>
            <button className="ghost" onClick={() => setSentiment(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
