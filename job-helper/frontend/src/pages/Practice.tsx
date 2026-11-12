import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { Btn, ErrorBox, Loading, useLoad, useToast, when } from '../ui';
import './practice.css';

// ---------------------------------------------------------------- API shapes (worker/src/career.ts)

interface Msg { role: 'assistant' | 'user'; text: string }
interface Scorecard {
  overall: number; summary: string; strengths: string[]; improve: string[];
  better_lines: { you_said: string; try_instead: string }[]; next_drill: string;
}
interface SessionRow { id: number; scenario: string; application_id: number | null; scorecard: string | null; created_at: string }
interface PracticeHome { scenarios: Record<string, string>; sessions: SessionRow[] }
interface Session { id: number; scenario: string; application_id: number | null; messages: Msg[]; scorecard: Scorecard | null; created_at?: string }
interface AppRow { id: number; title: string; company: string; status: string }

const SCENARIO_INFO: Record<string, { icon: string; blurb: string; them: string }> = {
  cold_call: { icon: '📞', blurb: 'They weren’t expecting your call. Get their interest and earn a few minutes.', them: 'Busy buyer' },
  discovery: { icon: '🔍', blurb: 'Ask good questions and really listen to find out what they need.', them: 'Buyer' },
  objection: { icon: '🛡️', blurb: '“Too expensive.” “Not now.” Practice staying calm, curious, and helpful.', them: 'Skeptical buyer' },
  sell_me_this: { icon: '🖊️', blurb: 'The classic interview test. Tip: ask about them before you pitch.', them: 'Hiring manager' },
  hiring_manager: { icon: '🤝', blurb: 'A sales manager interviews you. Practice telling your story with confidence.', them: 'Hiring manager' },
};
const CLOSED_STATUSES = new Set(['rejected', 'closed', 'withdrawn', 'won']);
const PAUSE = 'pause';
const READ_KEY = 'nc_read_aloud';

function parseCard(s: string | null): Scorecard | null {
  if (!s) return null;
  try { return JSON.parse(s) as Scorecard; } catch { return null; }
}
function hashParams(): URLSearchParams {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}
const herTurns = (msgs: Msg[]) => msgs.filter((m) => m.role === 'user' && m.text.trim().toLowerCase() !== PAUSE).length;

// ---------------------------------------------------------------- voice helpers (progressive enhancement)

// The Web Speech API isn't in TypeScript's DOM types; this is the small slice we use.
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionCtor = new () => Recognition;
function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

function pickVoice(): SpeechSynthesisVoice | null {
  const all = window.speechSynthesis.getVoices();
  const us = all.filter((v) => v.lang?.toLowerCase().replace('_', '-') === 'en-us');
  const pool = us.length ? us : all.filter((v) => v.lang?.toLowerCase().startsWith('en'));
  const nice = /natural|google|samantha|aria|jenny|ava|allison|zira/i;
  return pool.find((v) => nice.test(v.name)) ?? pool.find((v) => v.default) ?? pool[0] ?? null;
}
function speak(text: string) {
  if (!canSpeak) return;
  const clean = text.replace(/\[([^\]]*)\]/g, ' Coach tip: $1. ').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  const v = pickVoice();
  if (v) u.voice = v;
  u.lang = v?.lang ?? 'en-US';
  u.rate = 0.97;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
function stopSpeaking() {
  if (canSpeak) window.speechSynthesis.cancel();
}

// ---------------------------------------------------------------- page

type View = { kind: 'home' } | { kind: 'chat'; s: Session } | { kind: 'score'; s: Session; card: Scorecard };

export default function Practice() {
  const home = useLoad<PracticeHome>('/practice');
  const apps = useLoad<AppRow[]>('/applications');
  const toast = useToast();
  const [view, setView] = useState<View>({ kind: 'home' });
  const [appId, setAppId] = useState<string>(() => hashParams().get('app') ?? '');
  const [suggested] = useState<string | null>(() => hashParams().get('scenario'));
  const [readAloud, setReadAloudState] = useState(() => canSpeak && localStorage.getItem(READ_KEY) === '1');
  const setReadAloud = (on: boolean) => {
    setReadAloudState(on);
    localStorage.setItem(READ_KEY, on ? '1' : '0');
    if (!on) stopSpeaking();
  };

  // Voices load asynchronously in Chrome; touching getVoices() early primes the list.
  useEffect(() => {
    if (!canSpeak) return;
    window.speechSynthesis.getVoices();
    const prime = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', prime);
    return () => { window.speechSynthesis.removeEventListener?.('voiceschanged', prime); stopSpeaking(); };
  }, []);

  const openJobs = (apps.data ?? []).filter((a) => !CLOSED_STATUSES.has(a.status));
  const jobName = (id: number | null) => {
    const a = id ? (apps.data ?? []).find((x) => x.id === id) : null;
    return a ? `${a.title} at ${a.company}` : null;
  };
  const labels = home.data?.scenarios ?? {};
  const label = (k: string) => labels[k] ?? k.replace(/_/g, ' ');

  const start = async (scenario: string, application_id?: number | null) => {
    const r = await api<{ id: number; scenario: string; messages: Msg[] }>('/practice', { body: { scenario, application_id: application_id || undefined } });
    setView({ kind: 'chat', s: { id: r.id, scenario: r.scenario, application_id: application_id || null, messages: r.messages, scorecard: null } });
    window.scrollTo(0, 0);
    if (readAloud && r.messages[0]) speak(r.messages[0].text);
    home.reload();
  };
  const open = async (id: number) => {
    try {
      const s = await api<Session>(`/practice/${id}`);
      setView(s.scorecard ? { kind: 'score', s, card: s.scorecard } : { kind: 'chat', s });
      window.scrollTo(0, 0);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  };
  const backHome = () => { stopSpeaking(); setView({ kind: 'home' }); home.reload(); window.scrollTo(0, 0); };

  if (view.kind === 'chat') {
    return (
      <Chat key={view.s.id} s={view.s} title={label(view.s.scenario)} job={jobName(view.s.application_id)} readAloud={readAloud} setReadAloud={setReadAloud}
        onBack={backHome} onFinished={(s, card) => { stopSpeaking(); setView({ kind: 'score', s, card }); window.scrollTo(0, 0); home.reload(); }} />
    );
  }
  if (view.kind === 'score') {
    return (
      <ScoreView s={view.s} card={view.card} title={label(view.s.scenario)} job={jobName(view.s.application_id)}
        onAgain={() => start(view.s.scenario, view.s.application_id)} onOther={backHome} />
    );
  }

  return (
    <div>
      <h1>Practice</h1>
      <p className="pr-lede">Practice with a pretend buyer or interviewer. Type (or talk) like you would on a real call, then get friendly feedback on how you did.</p>
      <p><span className="pr-private">🔒 Nothing you say here is shared.</span></p>

      {home.error && <ErrorBox error={home.error} />}

      {openJobs.length > 0 && (
        <div className="card pr-job">
          <label htmlFor="pr-job" style={{ marginTop: 0 }}>
            Practice for a specific job <span className="hint">Optional — the pretend buyer will act like that company’s customer.</span>
          </label>
          <select id="pr-job" value={appId} onChange={(e) => setAppId(e.target.value)}>
            <option value="">No, just general practice</option>
            {openJobs.map((a) => <option key={a.id} value={a.id}>{a.title} at {a.company}</option>)}
          </select>
        </div>
      )}

      <div className="section"><h2>Pick what to practice</h2></div>
      {!home.data ? (!home.error && <Loading />) : (
        <div className="pr-scenarios">
          {Object.keys(labels).map((k) => {
            const info = SCENARIO_INFO[k];
            return (
              <div key={k} className={`card pr-scenario ${suggested === k ? 'hl' : ''}`}>
                <span className="pr-icon" aria-hidden>{info?.icon ?? '💬'}</span>
                <h3>{label(k)}</h3>
                <p>{info?.blurb ?? 'A short role-play to build your confidence.'}</p>
                <Btn className="primary big" busyText="Getting ready…" onClick={() => start(k, appId ? Number(appId) : null)}>Start ▶</Btn>
              </div>
            );
          })}
        </div>
      )}

      {home.data && home.data.sessions.length > 0 && (
        <>
          <div className="section"><h2>Your past practice</h2></div>
          {home.data.sessions.map((p) => {
            const card = parseCard(p.scorecard);
            const job = jobName(p.application_id);
            return (
              <button key={p.id} className="card pr-past" onClick={() => open(p.id)}>
                <span aria-hidden style={{ fontSize: '1.4rem' }}>{SCENARIO_INFO[p.scenario]?.icon ?? '💬'}</span>
                <span className="grow">
                  <strong>{label(p.scenario)}</strong>
                  <span className="small muted">{when(p.created_at)}{job ? ` · ${job}` : ''}</span>
                </span>
                <span className="pr-status">
                  {card ? <Stars n={card.overall} small /> : <span className="badge stretch">Not finished</span>}
                  <span className="pr-go">{card ? 'See' : 'Continue'} ›</span>
                </span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- conversation

function Chat({ s, title, job, readAloud, setReadAloud, onBack, onFinished }: {
  s: Session; title: string; job: string | null; readAloud: boolean; setReadAloud: (on: boolean) => void;
  onBack: () => void; onFinished: (s: Session, card: Scorecard) => void;
}) {
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>(s.messages);
  const [text, setText] = useState('');
  const [waiting, setWaiting] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const them = SCENARIO_INFO[s.scenario]?.them ?? 'Them';

  useEffect(() => {
    const b = boxRef.current;
    if (b) b.scrollTop = b.scrollHeight;
  }, [msgs, waiting]);

  const mic = useDictation((t) => setText(t), () => text);

  const send = async (raw: string) => {
    const t = raw.trim();
    if (!t || waiting) return;
    mic.stop();
    stopSpeaking();
    const before = msgs;
    setMsgs([...before, { role: 'user', text: t }]);
    setText('');
    setWaiting(true);
    try {
      const r = await api<{ reply: string; messages: Msg[] }>(`/practice/${s.id}/message`, { body: { text: t } });
      setMsgs(r.messages);
      if (readAloud) speak(r.reply);
    } catch (e) {
      setMsgs(before);
      if (t.toLowerCase() !== PAUSE) setText(t);
      toast(e instanceof Error ? e.message : String(e), true);
    } finally {
      setWaiting(false);
      inputRef.current?.focus();
    }
  };

  const turns = herTurns(msgs);
  const canFinish = turns >= 2 && !waiting;

  return (
    <div>
      <div className="pr-head">
        <button className="ghost" onClick={() => { mic.stop(); onBack(); }}>‹ All practice</button>
        <span className="pr-private small">🔒 Private practice</span>
      </div>
      <h1>{SCENARIO_INFO[s.scenario]?.icon} {title}</h1>
      {job && <p className="muted" style={{ marginTop: 0 }}>For: {job}</p>}
      <p className="small muted">They’ll stay in character — that’s the point! Answer like it’s real. If you freeze, tap <strong>Help, I’m stuck</strong> for a quick tip.</p>

      <div className="pr-chat" ref={boxRef} aria-live="polite">
        {msgs.map((m, i) => <Bubble key={i} m={m} them={them} />)}
        {waiting && (
          <div className="pr-msg them">
            <span className="pr-who">{them}</span>
            <span className="pr-bubble pr-typing" aria-label="They’re typing"><i /><i /><i /></span>
          </div>
        )}
      </div>

      <div className="pr-compose">
        <label htmlFor="pr-say" className="small" style={{ marginTop: 0 }}>Your turn {mic.listening && <span style={{ color: 'var(--bad)' }}>· 🎙️ Listening… tap the mic again when you’re done</span>}</label>
        <textarea id="pr-say" ref={inputRef} value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); }
          }}
          placeholder="Type what you’d say… (Enter sends, Shift+Enter for a new line)" />
        <div className="row">
          <button className="primary big" disabled={!text.trim() || waiting} onClick={() => send(text)}>Send ➤</button>
          {mic.supported && (
            <button className={`big pr-mic ${mic.listening ? 'on' : ''}`} onClick={() => mic.toggle()} disabled={waiting}
              aria-pressed={mic.listening} title={mic.listening ? 'Stop listening' : 'Talk instead of typing'}>
              🎤 {mic.listening ? 'Stop' : 'Talk'}
            </button>
          )}
          <button className="big" onClick={() => send(PAUSE)} disabled={waiting}>🆘 Help, I’m stuck</button>
        </div>
        <div className="row between" style={{ marginTop: '1rem' }}>
          {canSpeak ? (
            <label className="check pr-toggle">
              <input type="checkbox" checked={readAloud} onChange={(e) => { setReadAloud(e.target.checked); if (e.target.checked) { const last = [...msgs].reverse().find((m) => m.role === 'assistant'); if (last) speak(last.text); } }} />
              🔊 Read their lines aloud
            </label>
          ) : <span />}
          <Btn className="primary" disabled={!canFinish} title={canFinish ? '' : 'Say at least two things first'}
            busyText="Scoring your practice… (about 30 seconds)"
            onClick={async () => {
              mic.stop();
              const card = await api<Scorecard>(`/practice/${s.id}/finish`, { method: 'POST' });
              onFinished({ ...s, messages: msgs, scorecard: card }, card);
            }}>
            🏁 Finish &amp; get my scorecard
          </Btn>
        </div>
        {turns < 2 && <p className="small muted" style={{ textAlign: 'right' }}>Your scorecard unlocks after you’ve said {turns === 1 ? 'one more thing' : 'two things'}.</p>}
      </div>
    </div>
  );
}

/** Their lines may contain a coaching hint in [brackets] (after she says "pause"); show those differently. */
function withHints(text: string): ReactNode[] {
  return text.split(/(\[[^\]]+\])/g).filter(Boolean).map((part, i) =>
    part.startsWith('[') && part.endsWith(']') ? <span key={i} className="pr-hint">{part.slice(1, -1).trim()}</span> : <span key={i}>{part}</span>);
}

function Bubble({ m, them }: { m: Msg; them: string }) {
  if (m.role === 'user') {
    const pause = m.text.trim().toLowerCase() === PAUSE;
    return (
      <div className={`pr-msg me ${pause ? 'pause' : ''}`}>
        <span className="pr-who">You</span>
        <span className="pr-bubble">{pause ? '🆘 Asked for a tip' : m.text}</span>
      </div>
    );
  }
  return (
    <div className="pr-msg them">
      <span className="pr-who">{them}</span>
      <span className="pr-bubble">{withHints(m.text)}</span>
    </div>
  );
}

/** Dictation into the text box. Keeps whatever she had typed and adds what she says after it. */
function useDictation(setText: (t: string) => void, getText: () => string) {
  const Ctor = useRef(recognitionCtor()).current;
  const rec = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false);
  const toast = useToast();
  const textRef = useRef(getText);
  textRef.current = getText;

  const stop = useCallback(() => { rec.current?.stop(); }, []);
  useEffect(() => () => rec.current?.abort(), []);

  const toggle = useCallback(() => {
    if (!Ctor) return;
    if (rec.current) { rec.current.stop(); return; }
    const r = new Ctor();
    r.lang = 'en-US';
    r.continuous = true;
    r.interimResults = true;
    const base = textRef.current().trimEnd();
    let finals = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finals += res[0].transcript;
        else interim += res[0].transcript;
      }
      const spoken = (finals + interim).trim();
      setText([base, spoken].filter(Boolean).join(' '));
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Your browser didn’t let me use the microphone. Allow it in the address bar, or just type instead.', true);
      else if (e.error === 'no-speech') toast('I didn’t hear anything — try again a little closer to the mic.');
      else if (e.error !== 'aborted') toast('The microphone stopped. You can try again or type instead.', true);
    };
    r.onend = () => { rec.current = null; setListening(false); };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      setListening(false);
    }
  }, [Ctor, setText, toast]);

  return { supported: !!Ctor, listening, toggle, stop };
}

// ---------------------------------------------------------------- scorecard

const CHEER = ['', 'Every practice makes the next one easier.', 'Good practice — you’re building the muscle.', 'A solid start!', 'Really good work!', 'Excellent — you’re ready for the real thing!'];

function Stars({ n, small = false }: { n: number; small?: boolean }) {
  const v = Math.max(0, Math.min(5, Math.round(n || 0)));
  return (
    <span className="pr-stars" style={small ? { fontSize: '1.1rem', letterSpacing: 0 } : undefined} role="img" aria-label={`${v} out of 5 stars`}>
      {'★'.repeat(v)}<span className="off">{'★'.repeat(5 - v)}</span>
    </span>
  );
}

function ScoreView({ s, card, title, job, onAgain, onOther }: {
  s: Session; card: Scorecard; title: string; job: string | null; onAgain: () => Promise<unknown>; onOther: () => void;
}) {
  const them = SCENARIO_INFO[s.scenario]?.them ?? 'Them';
  const v = Math.max(1, Math.min(5, Math.round(card.overall || 0)));
  return (
    <div>
      <div className="pr-head">
        <button className="ghost" onClick={onOther}>‹ All practice</button>
        {s.created_at && <span className="small muted">Practiced {when(s.created_at)}</span>}
      </div>
      <h1>Your scorecard</h1>
      <p className="muted" style={{ marginTop: 0 }}>{SCENARIO_INFO[s.scenario]?.icon} {title}{job ? ` · ${job}` : ''}</p>

      <div className="card hl">
        <div className="pr-score-top">
          <Stars n={card.overall} />
          <h2>{CHEER[v]}</h2>
        </div>
        <p style={{ fontSize: '1.05rem', marginBottom: 0 }}>{card.summary}</p>
      </div>

      <div className="grid2 pr-grid">
        {card.strengths?.length > 0 && (
          <div className="card">
            <h3>👏 What went well</h3>
            <ul className="pr-list">{card.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
        {card.improve?.length > 0 && (
          <div className="card">
            <h3>🎯 Things to work on</h3>
            <ul className="pr-list">{card.improve.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
      </div>

      {card.better_lines?.length > 0 && (
        <div className="card">
          <h3>💬 Instead of… try…</h3>
          {card.better_lines.map((b, i) => (
            <div key={i} className="pr-pair">
              <div><span className="lbl">Instead of</span><span className="said">“{b.you_said}”</span></div>
              <div><span className="lbl">Try</span><span className="try">“{b.try_instead}”</span></div>
            </div>
          ))}
        </div>
      )}

      {card.next_drill && (
        <div className="pr-drill" style={{ marginBottom: '1rem' }}>
          <strong>🏋️ Next time, practice this:</strong> {card.next_drill}
        </div>
      )}

      <div className="row" style={{ margin: '1.25rem 0' }}>
        <Btn className="primary big" busyText="Getting ready…" onClick={onAgain}>🔁 Practice again</Btn>
        <button className="big" onClick={onOther}>Try a different scenario</button>
      </div>

      {s.messages.length > 0 && (
        <details>
          <summary>Look back at the conversation</summary>
          <div className="pr-chat done" style={{ marginTop: '.75rem' }}>
            {s.messages.map((m, i) => <Bubble key={i} m={m} them={them} />)}
          </div>
        </details>
      )}
    </div>
  );
}
