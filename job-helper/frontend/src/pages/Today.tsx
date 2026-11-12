import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Me } from '../App';
import { Btn, ErrorBox, FeedbackBox, Fit, Loading, MessageCard, meta, MODE, StatusBadge, useLoad, VoteButtons, when, type OutboxItem } from '../ui';

interface Home {
  waiting: OutboxItem[];
  ready: { id: number; title: string; company: string; fit_score: number; location: string; work_mode: string; apply_method: string; ai_notes: string }[];
  to_vote: { id: number; title: string; company: string; location: string; work_mode: string; salary: string; fit_score: number; fit_label: string; fit_summary: string; url: string | null }[];
  last_learning: { at: string; reply: string; changes: string[] } | null;
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

const STEPS: { key: string; label: string }[] = [
  { key: 'emails', label: 'Reading emails you’ve written, to learn how you sound' },
  { key: 'documents', label: 'Looking in your email for resumes and cover letters' },
  { key: 'learn', label: 'Learning your work history and writing style' },
  { key: 'search', label: 'Looking for jobs near you and online' },
];

/** First sign-in: set everything up from her Gmail, one visible step at a time. */
function Setup({ me, onDone }: { me: Me; onDone: () => void }) {
  const [results, setResults] = useState<Record<string, { ok: boolean; note: string }>>(me.onboarding.steps);
  const [current, setCurrent] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const ran = useRef(false);
  const canStart = me.gmail.connected;

  const go = async () => {
    if (ran.current) return;
    ran.current = true;
    setStarted(true);
    for (const s of STEPS) {
      if (results[s.key]?.ok) continue;
      setCurrent(s.key);
      try {
        const st = await api<{ steps: Record<string, { ok: boolean; note: string }> }>(`/onboard/${s.key}`, { method: 'POST' });
        setResults({ ...st.steps });
      } catch (e) {
        setResults((r) => ({ ...r, [s.key]: { ok: false, note: e instanceof Error ? e.message : String(e) } }));
      }
    }
    setCurrent(null);
  };
  useEffect(() => { if (canStart) go(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [canStart]);
  const finished = started && current === null;

  return (
    <div className="card hl">
      <h1>Welcome{me.user.name ? `, ${me.user.name.split(' ')[0]}` : ''}! 🌱</h1>
      {!canStart ? (
        me.is_owner ? (
          <>
            <p>To set everything up for you, Next Chapter needs permission to use your Gmail — that’s how it learns how you write, finds your old resumes, and sends applications for you.</p>
            <div className="row">
              <Btn className="primary big" onClick={async () => { const r = await api<{ url: string }>('/google/start'); window.location.href = r.url; }}>Connect my Gmail</Btn>
              <Btn className="ghost" onClick={async () => { await api('/onboard-skip', { method: 'POST' }); onDone(); }}>I’ll add my resume myself</Btn>
            </div>
          </>
        ) : (
          <>
            <p>You’re signed in as a helper. When <strong>{me.owner_email}</strong> signs in with Google, the app will set itself up from her email. You can also add her resume on the My Writing page.</p>
            <Btn className="ghost" onClick={async () => { await api('/onboard-skip', { method: 'POST' }); onDone(); }}>OK</Btn>
          </>
        )
      ) : (
        <>
          <p>I’m getting things ready for you. This takes a few minutes — you can watch, or come back later.</p>
          {STEPS.map((s) => {
            const r = results[s.key];
            return (
              <div key={s.key} className="check" style={{ alignItems: 'flex-start' }}>
                <span style={{ width: '1.5rem' }}>{current === s.key ? <span className="spinner" /> : r ? (r.ok ? '✅' : '⚠️') : '⬜️'}</span>
                <div>
                  <div style={{ fontWeight: current === s.key ? 700 : 500 }}>{s.label}</div>
                  {r && <div className="small muted">{r.note}</div>}
                </div>
              </div>
            );
          })}
          {finished && (
            <div className="row" style={{ marginTop: '1rem' }}>
              <button className="primary big" onClick={onDone}>See what I found →</button>
              {!results.learn?.ok && <a className="btn" href="#/writing">Add my resume</a>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Today({ me, reloadMe }: { me: Me | null; reloadMe: () => void }) {
  const home = useLoad<Home>('/home');
  const status = useLoad<Status>('/status');
  const name = me?.user.name ?? '';
  if (me && !me.onboarding.done) return <Setup me={me} onDone={() => { api('/onboard-skip', { method: 'POST' }).finally(() => { reloadMe(); home.reload(); status.reload(); }); }} />;
  if (home.error) return <ErrorBox error={home.error} />;
  if (!home.data || !status.data) return <Loading />;
  const h = home.data;
  const s = status.data;
  const reload = () => { home.reload(); status.reload(); };

  const setup = [
    { done: s.documents > 0, text: 'Add your resume and a few letters or emails you’ve written', href: '#/writing' },
    { done: s.has_career_record, text: 'Let the app learn your voice', href: '#/writing' },
    { done: !!h.prefs.home_location && h.prefs.target_roles.length > 0, text: 'Tell it where you live and what kind of work you want', href: '#/settings' },
    { done: s.gmail.connected, text: 'Connect Gmail so it can send applications and watch for replies', href: '#/settings' },
  ];
  const todo = setup.filter((x) => !x.done);
  const nothingToDo = !h.waiting.length && !h.ready.length && !h.to_vote.length;
  const learnedRecently = h.last_learning && Date.now() - new Date(h.last_learning.at).getTime() < 2 * 86_400_000;

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

      <div className="section">
        <h2>{h.to_vote.length ? `Vote on ${h.to_vote.length} new job${h.to_vote.length === 1 ? '' : 's'}` : 'New jobs'}</h2>
        <span className="muted small">👍 or 👎 each one — that’s how I learn what to look for</span>
      </div>
      {h.to_vote.length === 0 ? <div className="card empty">You’re all caught up. I search every morning and will email you when there’s something new.</div> : h.to_vote.map((j) => (
        <div key={j.id} className="card row" style={{ alignItems: 'flex-start' }}>
          <Fit score={j.fit_score} label={j.fit_label} />
          <div className="grow">
            <a href={`#/jobs/${j.id}`} style={{ color: 'inherit', textDecoration: 'none' }}><h3>{j.title}</h3></a>
            <div className="small muted">{meta(j.company, MODE[j.work_mode], j.location, j.salary)}</div>
            <p className="small">{j.fit_summary} <a href={`#/jobs/${j.id}`}>details</a></p>
            <VoteButtons jobId={j.id} vote={null} onVoted={reload} />
          </div>
        </div>
      ))}

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

      {learnedRecently && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <strong>🧠 What I learned from you lately:</strong> {h.last_learning!.reply}
          {h.last_learning!.changes.length > 0 && <ul className="small">{h.last_learning!.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
          <a href="#/learning" className="small">Everything I’ve learned →</a>
        </div>
      )}
      <div style={{ marginTop: '1.5rem' }}><FeedbackBox about="general" /></div>
    </div>
  );
}
