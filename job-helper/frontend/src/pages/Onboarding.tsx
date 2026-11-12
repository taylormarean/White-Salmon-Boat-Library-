import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Me } from '../App';
import { Btn, useToast } from '../ui';
import { fileToText, guessKind } from './Writing';

interface Answers {
  recent_role?: string; years_experience?: string; skills?: string[]; tools?: string[]; desired_roles?: string[]; industries?: string[];
  work_arrangement?: string[]; location?: string; radius_miles?: number; base_min?: number; ote_min?: number; schedule?: string; start?: string;
  dealbreakers?: string; proud_of?: string; why_change?: string; strengths?: string; anything_else?: string; linkedin_url?: string;
  followups?: { question: string; answer: string }[];
}

const ROLE_IDEAS = ['Sales Development Representative', 'Business Development Representative', 'Account Executive', 'Account Manager', 'Customer Success Manager', 'Inside Sales Representative', 'Sales Operations', 'Office Manager', 'Customer Service', 'Bookkeeper'];
const INDUSTRY_IDEAS = ['Software / SaaS', 'Healthcare tech', 'Fintech', 'Education tech', 'Real estate tech', 'Hospitality', 'Healthcare', 'Nonprofit', 'Government'];
const SKILL_IDEAS = ['Customer service', 'Scheduling', 'Billing', 'Bookkeeping', 'Training people', 'Phones & follow-up', 'Problem solving', 'Organizing', 'Negotiating', 'Managing a team', 'Public speaking', 'Writing'];
const TOOL_IDEAS = ['Microsoft Office', 'Google Workspace', 'QuickBooks', 'Salesforce', 'HubSpot', 'Excel', 'Zoom', 'Slack'];

const STEPS = ['Welcome', 'Your documents', 'About you', 'The work you want', 'Learning about you', 'A few more questions', 'First search'] as const;

function Chips({ options, value, onChange, allowCustom = true }: { options: string[]; value: string[]; onChange: (v: string[]) => void; allowCustom?: boolean }) {
  const [custom, setCustom] = useState('');
  const all = [...new Set([...options, ...value])];
  return (
    <div>
      <div className="row" style={{ gap: '.4rem' }}>
        {all.map((o) => (
          <button key={o} type="button" className={`chip ${value.includes(o) ? 'on' : ''}`} onClick={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])}>{o}</button>
        ))}
      </div>
      {allowCustom && (
        <div className="row" style={{ marginTop: '.5rem' }}>
          <input className="grow" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Add your own…"
            onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) { e.preventDefault(); onChange([...value, custom.trim()]); setCustom(''); } }} />
          <button type="button" disabled={!custom.trim()} onClick={() => { onChange([...value, custom.trim()]); setCustom(''); }}>Add</button>
        </div>
      )}
    </div>
  );
}

/** First-run setup: documents → questions about her → AI reads it all → follow-up questions → first search. */
export default function Onboarding({ me, onDone }: { me: Me; onDone: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Answers>({ desired_roles: ROLE_IDEAS.slice(0, 3), work_arrangement: ['remote'], radius_miles: 30 });
  const [docs, setDocs] = useState<{ title: string }[]>([]);
  const [progress, setProgress] = useState<Record<string, { ok: boolean; note: string } | 'running'>>({});
  const [followups, setFollowups] = useState<{ question: string; answer: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Answers>) => setA((x) => ({ ...x, ...patch }));
  const needsCredit = me.workspace.plan === 'paid' && me.workspace.balance_micro <= 0;

  useEffect(() => {
    api<{ answers: Answers }>('/profile-answers').then((r) => { if (Object.keys(r.answers).length) setA((x) => ({ ...x, ...r.answers })); }).catch(() => {});
    api<{ title: string }[]>('/documents').then(setDocs).catch(() => {});
  }, []);

  const runStep = async (key: string) => {
    setProgress((p) => ({ ...p, [key]: 'running' }));
    try {
      const st = await api<{ steps: Record<string, { ok: boolean; note: string }> }>(`/onboard/${key}`, { method: 'POST' });
      setProgress((p) => ({ ...p, [key]: st.steps[key] }));
    } catch (e) {
      setProgress((p) => ({ ...p, [key]: { ok: false, note: e instanceof Error ? e.message : String(e) } }));
    }
  };
  const save = () => api('/profile-answers', { method: 'PUT', body: a });

  const upload = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      try {
        await api('/documents', { body: { ...(await fileToText(f)), kind: guessKind(f.name), title: f.name.replace(/\.[^.]+$/, ''), filename: f.name } });
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), true);
      }
    }
    setDocs(await api('/documents'));
  };

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(0, s - 1));
  const status = (k: string) => {
    const p = progress[k];
    if (!p) return null;
    if (p === 'running') return <span className="small"><span className="spinner" /> working…</span>;
    return <span className="small">{p.ok ? '✅' : '⚠️'} {p.note}</span>;
  };

  return (
    <div className="card hl" style={{ maxWidth: 820 }}>
      <div className="small muted">Step {step + 1} of {STEPS.length} · {STEPS[step]}</div>
      <div style={{ height: 6, background: 'var(--line)', borderRadius: 99, margin: '.4rem 0 1rem' }}>
        <div style={{ height: 6, width: `${((step + 1) / STEPS.length) * 100}%`, background: 'var(--brand)', borderRadius: 99 }} />
      </div>

      {step === 0 && (
        <>
          <h1>Welcome{me.user.name ? `, ${me.user.name.split(' ')[0]}` : ''}! 🌱</h1>
          <p>Let’s set things up so every job I show you — and every letter I write — fits <em>you</em>. It takes about 10 minutes:</p>
          <ol>
            <li>Your resume and some things you’ve written</li>
            <li>A few questions about your experience and the work you want</li>
            <li>I read everything and ask a couple of follow-up questions</li>
            <li>Then I go find your first jobs</li>
          </ol>
          {needsCredit && <div className="notes small">You’ll need a little credit for step 3 (the AI reading). You can add it when we get there — the questions are free.</div>}
          <div className="row" style={{ marginTop: '1rem' }}><button className="primary big" onClick={next}>Let’s go →</button></div>
        </>
      )}

      {step === 1 && (
        <>
          <h2>Your documents</h2>
          <p>Your resume matters most. Cover letters and emails you’ve written help me sound like you.</p>
          {me.gmail.connected ? (
            <div className="card">
              <strong>📬 Look in my Gmail</strong>
              <p className="small muted">I’ll read emails you’ve sent (to learn how you write) and find resumes or cover letters you’ve emailed before. Nothing is changed or sent.</p>
              <div className="row">
                <Btn className="primary" onClick={async () => { await runStep('emails'); await runStep('documents'); setDocs(await api('/documents')); }}>Look in my Gmail</Btn>
                {status('emails')} {status('documents')}
              </div>
            </div>
          ) : (
            <div className="notes small">Gmail isn’t connected, so add your resume below. (You can connect Gmail later in Settings.)</div>
          )}
          <div className="card" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
            <strong>📄 Add files</strong> <span className="small muted">Word, PDF, or text — or drag them here</span>
            <div className="row" style={{ marginTop: '.5rem' }}>
              <Btn onClick={async () => fileRef.current?.click()}>Choose files</Btn>
              <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.md" style={{ display: 'none' }} onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
            </div>
          </div>
          {docs.length > 0 && <p className="small">✅ {docs.length} document{docs.length === 1 ? '' : 's'} so far{docs.length <= 4 ? `: ${docs.map((d) => d.title).join(', ')}` : ''}</p>}
          <div className="row between" style={{ marginTop: '1rem' }}>
            <button className="ghost" onClick={back}>← Back</button>
            <button className="primary big" onClick={next}>{docs.length ? 'Next →' : 'Skip for now →'}</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h2>About you</h2>
          <div className="grid2">
            <div><label>Your most recent job title</label><input value={a.recent_role ?? ''} onChange={(e) => set({ recent_role: e.target.value })} placeholder="e.g. Office Manager" /></div>
            <div><label>Years of work experience</label>
              <select value={a.years_experience ?? ''} onChange={(e) => set({ years_experience: e.target.value })}>
                <option value="">Choose…</option>{['Under 2', '2–5', '5–10', '10–20', '20+'].map((x) => <option key={x}>{x}</option>)}
              </select></div>
          </div>
          <label>What are you good at? <span className="hint">tap all that fit, or add your own</span></label>
          <Chips options={SKILL_IDEAS} value={a.skills ?? []} onChange={(v) => set({ skills: v })} />
          <label>Software you know</label>
          <Chips options={TOOL_IDEAS} value={a.tools ?? []} onChange={(v) => set({ tools: v })} />
          <label>Something you’re proud of at work <span className="hint">a story with a result — numbers help (“cut no-shows by a third”)</span></label>
          <textarea rows={3} value={a.proud_of ?? ''} onChange={(e) => set({ proud_of: e.target.value })} />
          <label>What do people say you’re best at?</label>
          <textarea rows={2} value={a.strengths ?? ''} onChange={(e) => set({ strengths: e.target.value })} />
          <label>LinkedIn profile link <span className="hint">optional</span></label>
          <input value={a.linkedin_url ?? ''} onChange={(e) => set({ linkedin_url: e.target.value })} placeholder="https://www.linkedin.com/in/…" />
          <div className="row between" style={{ marginTop: '1rem' }}>
            <button className="ghost" onClick={back}>← Back</button>
            <Btn className="primary big" onClick={async () => { await save(); next(); }}>Next →</Btn>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <h2>The work you want</h2>
          <label>Kinds of jobs <span className="hint">I start with tech sales roles — change these to anything you like</span></label>
          <Chips options={ROLE_IDEAS} value={a.desired_roles ?? []} onChange={(v) => set({ desired_roles: v })} />
          <label>Industries that interest you</label>
          <Chips options={INDUSTRY_IDEAS} value={a.industries ?? []} onChange={(v) => set({ industries: v })} />
          <label>Where do you want to work?</label>
          <div className="row">
            {[['remote', '🏠 From home'], ['hybrid', '🔀 Hybrid'], ['onsite', '📍 In person']].map(([k, v]) => (
              <label key={k} className="check" style={{ margin: 0 }}>
                <input type="checkbox" checked={(a.work_arrangement ?? []).includes(k)} onChange={(e) => set({ work_arrangement: e.target.checked ? [...(a.work_arrangement ?? []), k] : (a.work_arrangement ?? []).filter((x) => x !== k) })} /> {v}
              </label>
            ))}
          </div>
          <div className="grid2">
            <div><label>Your town <span className="hint">“City, ST”</span></label><input value={a.location ?? ''} onChange={(e) => set({ location: e.target.value })} placeholder="White Salmon, WA" /></div>
            <div><label>How far will you drive? <span className="hint">miles</span></label><input type="number" value={a.radius_miles ?? 30} onChange={(e) => set({ radius_miles: Number(e.target.value) })} /></div>
            <div><label>Lowest base pay you’d take <span className="hint">per year — $20/hr ≈ $41,600</span></label><input type="number" value={a.base_min ?? ''} onChange={(e) => set({ base_min: e.target.value ? Number(e.target.value) : undefined })} /></div>
            <div><label>Target total pay with commission <span className="hint">sales “OTE” — optional</span></label><input type="number" value={a.ote_min ?? ''} onChange={(e) => set({ ote_min: e.target.value ? Number(e.target.value) : undefined })} /></div>
            <div><label>Schedule</label>
              <select value={a.schedule ?? ''} onChange={(e) => set({ schedule: e.target.value })}>
                <option value="">Either is fine</option><option>Full-time</option><option>Part-time</option>
              </select></div>
            <div><label>When could you start?</label><input value={a.start ?? ''} onChange={(e) => set({ start: e.target.value })} placeholder="e.g. Right away / after Jan 1" /></div>
          </div>
          <label>Why this next chapter? <span className="hint">in your own words — why this kind of work, why now</span></label>
          <textarea rows={3} value={a.why_change ?? ''} onChange={(e) => set({ why_change: e.target.value })} />
          <label>Dealbreakers <span className="hint">anything you won’t do — e.g. “no weekends”, “no cold calling all day”</span></label>
          <textarea rows={2} value={a.dealbreakers ?? ''} onChange={(e) => set({ dealbreakers: e.target.value })} />
          <label>Anything else I should know?</label>
          <textarea rows={2} value={a.anything_else ?? ''} onChange={(e) => set({ anything_else: e.target.value })} />
          <div className="row between" style={{ marginTop: '1rem' }}>
            <button className="ghost" onClick={back}>← Back</button>
            <Btn className="primary big" disabled={!(a.desired_roles ?? []).length} onClick={async () => { await save(); next(); }}>Next →</Btn>
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <h2>Learning about you</h2>
          <p>Now I’ll read your documents and answers to build your career record and learn how you write. This takes a minute or two.</p>
          {needsCredit && !progress.learn && (
            <div className="notes">This step uses the AI, so your account needs a little credit first. <a href="#/billing">Add credit</a> (you pay 2× our AI cost — usually about $1–2 on an active day), then come back here.</div>
          )}
          <div className="row">
            <Btn className="primary big" disabled={progress.learn === 'running'} busyText="Reading everything…"
              onClick={async () => { await runStep('learn'); const r = await api<{ followup_questions: string[] }>('/profile-answers'); setFollowups(r.followup_questions.map((q) => ({ question: q, answer: (a.followups ?? []).find((f) => f.question === q)?.answer ?? '' }))); }}>
              {progress.learn ? 'Try again' : 'Start'}
            </Btn>
            {status('learn')}
          </div>
          <div className="row between" style={{ marginTop: '1rem' }}>
            <button className="ghost" onClick={back}>← Back</button>
            <button className="primary big" disabled={progress.learn === 'running'} onClick={next}>{progress.learn && progress.learn !== 'running' && progress.learn.ok ? 'Next →' : 'Skip for now →'}</button>
          </div>
        </>
      )}

      {step === 5 && (
        <>
          <h2>A few more questions</h2>
          {followups.length === 0 ? <p className="muted">No follow-up questions — you’re all set.</p> : (
            <>
              <p>I read your documents and have a few questions that would make your applications stronger. Answer any you can — skip the rest.</p>
              {followups.map((f, i) => (
                <div key={i}>
                  <label>{f.question}</label>
                  <textarea rows={2} value={f.answer} onChange={(e) => setFollowups(followups.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} />
                </div>
              ))}
            </>
          )}
          <div className="row between" style={{ marginTop: '1rem' }}>
            <button className="ghost" onClick={back}>← Back</button>
            <Btn className="primary big" onClick={async () => { if (followups.length) await api('/profile-answers', { method: 'PUT', body: { followups } }); next(); }}>Next →</Btn>
          </div>
        </>
      )}

      {step === 6 && (
        <>
          <h2>Your first search</h2>
          <p>I’ll look through job boards and the web for jobs that match everything you told me. After this, I’ll search every morning and email you what I find — you just 👍 or 👎 each one.</p>
          <div className="row">
            <Btn className="primary big" disabled={progress.search === 'running'} busyText="Searching — a few minutes…" onClick={() => runStep('search')}>{progress.search ? 'Search again' : 'Find my first jobs'}</Btn>
            {status('search')}
          </div>
          <div className="notes small" style={{ marginTop: '1rem' }}>
            🧪 <strong>Test week:</strong> for your first 7 days, anything I “send” goes to your own inbox instead of employers, so you can see exactly what they’d get. Turn it off in Settings whenever you’re ready.
          </div>
          <div className="row between" style={{ marginTop: '1rem' }}>
            <button className="ghost" onClick={back}>← Back</button>
            <Btn className="primary big" onClick={async () => { await api('/onboard-skip', { method: 'POST' }); onDone(); }}>Go to my dashboard →</Btn>
          </div>
        </>
      )}
    </div>
  );
}
