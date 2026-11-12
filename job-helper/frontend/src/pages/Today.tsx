import { api } from '../api';
import { Btn, ErrorBox, Fit, Loading, MessageCard, meta, MODE, StatusBadge, useLoad, when, type OutboxItem } from '../ui';

interface Home {
  waiting: OutboxItem[];
  ready: { id: number; title: string; company: string; fit_score: number; location: string; work_mode: string; apply_method: string; ai_notes: string }[];
  matches: { id: number; title: string; company: string; location: string; work_mode: string; salary: string; fit_score: number; fit_label: string; fit_summary: string }[];
  replies: { id: number; application_id: number; summary: string; title: string; company: string; created_at: string; type: string }[];
  active: { id: number; status: string; title: string; company: string; last_contact_at: string; follow_up_count: number }[];
  last_search: { at: string; added: number; scored: number } | null;
  prefs: { name: string; home_location: string; target_roles: string[] };
}
interface Status { ai: boolean; gmail: { configured: boolean; connected: boolean }; documents: number; has_career_record: boolean }

function hello(name: string) {
  const h = new Date().getHours();
  const first = name.split(' ')[0];
  return `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}${first ? `, ${first}` : ''}!`;
}

export default function Today({ name }: { name: string }) {
  const home = useLoad<Home>('/home');
  const status = useLoad<Status>('/status');
  if (home.error) return <ErrorBox error={home.error} />;
  if (!home.data || !status.data) return <Loading />;
  const h = home.data;
  const s = status.data;
  const reload = () => { home.reload(); status.reload(); };

  const setup = [
    { done: s.documents > 0, text: 'Add your resume and a few letters or emails you’ve written', href: '#/writing' },
    { done: s.has_career_record, text: 'Let the app learn your voice', href: '#/writing' },
    { done: !!h.prefs.home_location && h.prefs.target_roles.length > 0, text: 'Tell it where you live and what kind of work you want', href: '#/settings' },
    { done: s.gmail.connected, text: 'Connect your Gmail so it can send applications and watch for replies', href: '#/settings' },
  ];
  const todo = setup.filter((x) => !x.done);
  const nothingToDo = !h.waiting.length && !h.ready.length;

  return (
    <div>
      <div className="row between">
        <div>
          <h1>{hello(name)}</h1>
          <p className="muted">{nothingToDo ? 'Nothing needs you right now.' : 'Here’s what needs you today.'}
            {h.last_search && <> Last job search: {when(h.last_search.at)}.</>}</p>
        </div>
        <Btn className="primary" busyText="Searching — this can take a few minutes…" done="Search finished"
          onClick={async () => { await api('/search', { method: 'POST' }); reload(); }}>🔎 Look for new jobs now</Btn>
      </div>

      {todo.length > 0 && (
        <div className="card warn">
          <h2>Getting started</h2>
          {setup.map((x, i) => (
            <div key={i} className="check">{x.done ? '✅' : '⬜️'} {x.done ? <span className="muted">{x.text}</span> : <a href={x.href}>{x.text}</a>}</div>
          ))}
        </div>
      )}

      {h.replies.length > 0 && (
        <>
          <div className="section"><h2>News from employers</h2></div>
          {h.replies.slice(0, 4).map((r) => (
            <a key={r.id} className="mini" href={`#/applications/${r.application_id}`}>
              <strong>{r.company}</strong> <span className="muted small">· {r.title} · {when(r.created_at)}</span>
              <div>{r.summary}</div>
            </a>
          ))}
        </>
      )}

      {h.ready.length > 0 && (
        <>
          <div className="section"><h2>Applications ready for you</h2><span className="muted small">Look them over, then send</span></div>
          {h.ready.map((a) => (
            <a key={a.id} className="mini row" href={`#/applications/${a.id}`}>
              <Fit score={a.fit_score} label={a.fit_score >= 85 ? 'great' : a.fit_score >= 70 ? 'good' : 'stretch'} />
              <div className="grow">
                <strong>{a.title}</strong> — {a.company}
                <div className="small muted">{meta(MODE[a.work_mode], a.location, a.apply_method === 'email' ? 'Apply by email' : a.apply_method === 'in_person' ? 'Apply in person' : 'Apply on their website')}</div>
              </div>
              <span className="btn primary">Review →</span>
            </a>
          ))}
        </>
      )}

      {h.waiting.length > 0 && (
        <>
          <div className="section"><h2>Messages waiting for your OK</h2></div>
          {h.waiting.map((m) => <MessageCard key={m.id} m={m} onChange={reload} />)}
        </>
      )}

      <div className="section"><h2>Good new matches</h2><a href="#/jobs" className="small">See all jobs →</a></div>
      {h.matches.length === 0 ? <div className="card empty">No new strong matches yet. The app searches every morning.</div> : h.matches.map((j) => (
        <a key={j.id} className="mini row" href={`#/jobs/${j.id}`}>
          <Fit score={j.fit_score} label={j.fit_label} />
          <div className="grow">
            <strong>{j.title}</strong> — {j.company}
            <div className="small muted">{meta(MODE[j.work_mode], j.location, j.salary)}</div>
            <div className="small">{j.fit_summary}</div>
          </div>
        </a>
      ))}

      {h.active.length > 0 && (
        <>
          <div className="section"><h2>In progress</h2><a href="#/applications" className="small">All applications →</a></div>
          {h.active.slice(0, 6).map((a) => (
            <a key={a.id} className="mini row" href={`#/applications/${a.id}`}>
              <div className="grow"><strong>{a.title}</strong> — {a.company}</div>
              <span className="small muted">last contact {when(a.last_contact_at)}</span>
              <StatusBadge s={a.status} />
            </a>
          ))}
        </>
      )}
    </div>
  );
}
