import { useState } from 'react';
import { api } from '../api';
import { Btn, ErrorBox, FeedbackBox, Loading, useLoad, when } from '../ui';

interface Lessons { writing: string[]; job_search: string[]; process: string[]; updated_at: string | null }
interface Data {
  lessons: Lessons;
  last_learning: { at: string; reply: string; changes: string[]; feedback: number; votes: number } | null;
  recent_feedback: { id: number; sentiment: string; about: string; text: string; created_at: string }[];
  votes: { up: number | null; down: number | null } | null;
}

const SECTIONS: { key: keyof Omit<Lessons, 'updated_at'>; title: string; hint: string }[] = [
  { key: 'job_search', title: '🔎 Which jobs to show you', hint: 'Used every time I check whether a job fits and when I search the web for you.' },
  { key: 'writing', title: '✍️ How to write for you', hint: 'Used for every resume, cover letter, and email.' },
  { key: 'process', title: '⚙️ How to work with you', hint: 'Everything else.' },
];
const ABOUT: Record<string, string> = { general: 'In general', resume: 'A resume', cover_letter: 'A cover letter', email: 'An email', follow_up: 'A follow-up', reply: 'A reply', job_search: 'Job search', digest: 'Reply to the morning email', application: 'A draft' };

export default function Learning() {
  const { data, error, reload } = useLoad<Data>('/lessons');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const save = (patch: Partial<Lessons>) => api('/lessons', { method: 'PUT', body: { ...data.lessons, ...patch } }).then(reload);

  return (
    <div>
      <h1>What I’ve learned about you</h1>
      <p className="muted">
        Everything you tell me — your 👍 and 👎 on jobs, your notes on drafts, and replies to the morning email — gets turned into the lessons below.
        I follow them every time I search, check a job, or write something for you. Remove anything that’s wrong.
      </p>

      <FeedbackBox about="general" onDone={reload} />

      <div className="row small muted" style={{ margin: '.25rem 0 1rem', gap: '1.25rem' }}>
        <span>👍 {data.votes?.up ?? 0} job{data.votes?.up === 1 ? '' : 's'} liked</span>
        <span>👎 {data.votes?.down ?? 0} job{data.votes?.down === 1 ? '' : 's'} passed on</span>
        {data.lessons.updated_at && <span>Last updated {when(data.lessons.updated_at)}</span>}
      </div>

      {data.last_learning && (
        <div className="notes" style={{ background: 'var(--brand-soft)', marginBottom: '1rem' }}>
          🧠 <strong>Most recently:</strong> {data.last_learning.reply}
          {data.last_learning.changes.length > 0 && <ul className="small" style={{ margin: '.3rem 0 0' }}>{data.last_learning.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
        </div>
      )}

      <div className="grid2">
        {SECTIONS.map((s) => <LessonList key={s.key} title={s.title} hint={s.hint} items={data.lessons[s.key]} onSave={(items) => save({ [s.key]: items })} />)}
      </div>

      {data.recent_feedback.length > 0 && (
        <>
          <div className="section"><h2>What you’ve told me</h2></div>
          <div className="card">
            {data.recent_feedback.map((f) => (
              <div key={f.id} className="lesson">
                <span>{f.sentiment === 'good' ? '👍' : f.sentiment === 'bad' ? '👎' : '💬'}</span>
                <div className="grow">{f.text}<div className="small muted">{ABOUT[f.about] ?? f.about} · {when(f.created_at)}</div></div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LessonList({ title, hint, items, onSave }: { title: string; hint: string; items: string[]; onSave: (items: string[]) => Promise<unknown> }) {
  const [adding, setAdding] = useState('');
  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="small muted">{hint}</p>
      {items.length === 0 && <p className="small muted"><em>Nothing yet.</em></p>}
      {items.map((l, i) => (
        <div key={i} className="lesson">
          <span className="grow">{l}</span>
          <Btn className="ghost danger small" title="Remove this lesson" onClick={() => onSave(items.filter((_, j) => j !== i))}>✕</Btn>
        </div>
      ))}
      <div className="row" style={{ marginTop: '.6rem' }}>
        <input className="grow" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add one yourself…" />
        <Btn disabled={!adding.trim()} onClick={async () => { await onSave([...items, adding.trim()]); setAdding(''); }}>Add</Btn>
      </div>
    </div>
  );
}
