import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { Btn, ErrorBox, Loading, useLoad, useToast, when } from '../ui';
import './practice.css';

// ---------------------------------------------------------------- API shape (worker/src/career.ts → Story)

interface Story {
  pitch_30s: string;
  why_tech_sales: string;
  transferable_skills: { skill: string; evidence: string }[];
  resume_summary: string;
  linkedin_headline: string;
  linkedin_about: string;
  linkedin_experience: { role: string; bullets: string[] }[];
  certifications: { name: string; provider: string; why: string; effort: string }[];
  gaps: { gap: string; how_to_address: string }[];
  interview_answers: { question: string; answer: string }[];
  generated_at?: string;
}
type Field = Exclude<keyof Story, 'generated_at'>;

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older browsers / insecure origins: fall back to a hidden textarea.
    const t = document.createElement('textarea');
    t.value = text;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    if (!ok) throw new Error('Couldn’t copy — select the text and copy it by hand.');
  }
}

function CopyBtn({ text, label = '📋 Copy' }: { text: string; label?: string }) {
  return <Btn onClick={() => copyText(text)} done="Copied! Now paste it where you need it.">{label}</Btn>;
}

function CharCount({ n, max }: { n: number; max: number }) {
  return <span className={`st-count ${n > max ? 'over' : ''}`}>{n.toLocaleString()} / {max.toLocaleString()} characters{n > max ? ' — a little too long' : ''}</span>;
}

// ---------------------------------------------------------------- page

export default function Story() {
  const load = useLoad<Story | null>('/story');
  const toast = useToast();
  const [story, setStory] = useState<Story | null>(null);
  useEffect(() => { if (load.data) setStory(load.data); }, [load.data]);

  const generate = async () => {
    const s = await api<Story>('/story/generate', { method: 'POST' });
    setStory(s);
    window.scrollTo(0, 0);
  };
  const save = async <K extends Field>(field: K, value: Story[K]) => {
    await api('/story', { method: 'PUT', body: { [field]: value } });
    setStory((cur) => (cur ? { ...cur, [field]: value } : cur));
  };

  if (load.error) return <div><h1>My Story</h1><ErrorBox error={load.error} /></div>;
  if (load.loading && !story) return <div><h1>My Story</h1><Loading /></div>;

  if (!story) {
    return (
      <div>
        <h1>My Story</h1>
        <div className="card hl st-empty">
          <div style={{ fontSize: '2.5rem' }} aria-hidden>🧭</div>
          <h2>Your career-change story</h2>
          <p>Hiring managers will ask “why this move?” — let’s get your story straight, and refresh your LinkedIn to match.</p>
          <p className="muted small">I’ll write a 30-second introduction, an honest answer to “why this move,” the skills you’re bringing with you, a new LinkedIn headline and About section, and answers to common interview questions — all from your real experience in <a href="#/writing">My Writing</a>. You can change anything afterward.</p>
          <Btn className="primary big" busyText="Writing your story… this takes about a minute" done="Here’s your story! Read it over and change anything that doesn’t sound like you." onClick={generate}>
            ✨ Write my story
          </Btn>
        </div>
      </div>
    );
  }

  const s = story;
  return (
    <div>
      <div className="row between">
        <h1>My Story</h1>
        <Btn className="ghost" busyText="Rewriting… about a minute"
          onClick={async () => {
            if (!window.confirm('Write a fresh version of your whole story?\n\nThis replaces everything on this page, including any changes you made.')) return;
            await generate();
            toast('Fresh version ready.');
          }}>
          🔄 Rewrite it
        </Btn>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        One clear story you can use everywhere — in interviews, applications, and on LinkedIn. Tap <strong>Edit</strong> on anything that doesn’t sound like you.
        {s.generated_at && <> <span className="small">Written {when(s.generated_at)}.</span></>}
      </p>

      {/* ---- the story */}
      <div className="st-group">
        <h2>🗣️ Your story</h2>
        <TextBlock title="Your 30-second introduction" hint="For “Tell me about yourself.” Practice it out loud until it feels natural." value={s.pitch_30s} onSave={(v) => save('pitch_30s', v)} />
        <TextBlock title="Why this move?" hint="Your honest answer to “Why are you changing careers?”" value={s.why_tech_sales} onSave={(v) => save('why_tech_sales', v)} />
        <ListBlock title="Skills you’re bringing with you" hint="What you already do well, and the proof."
          items={s.transferable_skills} blank={{ skill: '', evidence: '' }}
          fields={[{ key: 'skill', label: 'Skill' }, { key: 'evidence', label: 'Proof from your experience', long: true }]}
          copy={(xs) => xs.map((x) => `• ${x.skill}: ${x.evidence}`).join('\n')}
          render={(x) => <><h4>{x.skill}</h4><p className="muted">{x.evidence}</p></>}
          onSave={(v) => save('transferable_skills', v)} />
        <TextBlock title="Resume summary" hint="The few lines at the top of your resume." value={s.resume_summary} onSave={(v) => save('resume_summary', v)} />
      </div>

      {/* ---- LinkedIn */}
      <div className="st-group">
        <h2>💼 Your LinkedIn</h2>
        <div className="st-tip">
          <strong>💡 How to update your LinkedIn:</strong> open{' '}
          <a href="https://www.linkedin.com/in/me/" target="_blank" rel="noreferrer">linkedin.com/in/me</a>{' '}
          → tap the ✏️ pencil to <strong>Edit intro</strong> (that’s your headline) → then <strong>About</strong> → then each job under <strong>Experience</strong>.
          Copy each piece below and paste it in.
        </div>
        <TextBlock title="Headline" hint="The line under your name." value={s.linkedin_headline} max={220} rows={3} onSave={(v) => save('linkedin_headline', v)} />
        <TextBlock title="About" hint="The “About” section of your profile." value={s.linkedin_about} max={2600} rows={14} onSave={(v) => save('linkedin_about', v)} />
        <ExperienceBlock roles={s.linkedin_experience} onSave={(v) => save('linkedin_experience', v)} />
      </div>

      {/* ---- getting ready */}
      <div className="st-group">
        <h2>🎯 Getting ready</h2>
        <ListBlock title="Certifications to consider" hint="Optional, but they show you’re serious about the move."
          note="Check the provider’s site for current details — programs and prices change."
          items={s.certifications} blank={{ name: '', provider: '', why: '', effort: '' }}
          fields={[{ key: 'name', label: 'Name' }, { key: 'provider', label: 'Who offers it' }, { key: 'why', label: 'Why it helps', long: true }, { key: 'effort', label: 'Time and cost' }]}
          copy={(xs) => xs.map((x) => `${x.name} (${x.provider}) — ${x.why} [${x.effort}]`).join('\n')}
          render={(x) => <><h4>{x.name} <span className="muted small">· {x.provider}</span></h4><p>{x.why}</p><p className="small muted">⏱️ {x.effort}</p></>}
          onSave={(v) => save('certifications', v)} />
        <ListBlock title="Possible worries — and how to answer them" hint="What a hiring manager might wonder about, and an honest way to address it."
          items={s.gaps} blank={{ gap: '', how_to_address: '' }}
          fields={[{ key: 'gap', label: 'The worry' }, { key: 'how_to_address', label: 'How to address it', long: true }]}
          copy={(xs) => xs.map((x) => `${x.gap}\n→ ${x.how_to_address}`).join('\n\n')}
          render={(x) => <><h4>🤔 {x.gap}</h4><p>👉 {x.how_to_address}</p></>}
          onSave={(v) => save('gaps', v)} />
        <ListBlock title="Practice answers" hint="Strong answers to questions you’re likely to hear. Read them, then say them in your own words."
          items={s.interview_answers} blank={{ question: '', answer: '' }}
          fields={[{ key: 'question', label: 'Question' }, { key: 'answer', label: 'Your answer', long: true }]}
          copy={(xs) => xs.map((x) => `Q: ${x.question}\nA: ${x.answer}`).join('\n\n')}
          render={(x) => <><h4>“{x.question}”</h4><p className="st-text">{x.answer}</p></>}
          footer={<a className="btn" href="#/practice?scenario=hiring_manager">🎤 Practice this out loud</a>}
          onSave={(v) => save('interview_answers', v)} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one text section

function TextBlock({ title, hint, value, onSave, max, rows = 6 }: {
  title: string; hint?: string; value: string; onSave: (v: string) => Promise<void>; max?: number; rows?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  return (
    <div className="card st-block">
      <div className="st-title">
        <div className="grow">
          <h3>{title}</h3>
          {hint && <div className="small muted">{hint}</div>}
        </div>
        {!editing && (
          <div className="row" style={{ gap: '.5rem' }}>
            <CopyBtn text={value} />
            <button onClick={() => setEditing(true)}>✏️ Edit</button>
          </div>
        )}
      </div>
      {editing ? (
        <>
          <textarea value={draft} rows={rows} onChange={(e) => setDraft(e.target.value)} aria-label={title} />
          {max && <CharCount n={draft.length} max={max} />}
          <div className="row" style={{ marginTop: '.6rem' }}>
            <Btn className="primary" done="Saved" onClick={async () => { await onSave(draft.trim()); setEditing(false); }}>Save</Btn>
            <button onClick={() => { setDraft(value); setEditing(false); }}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <div className="st-text">{value || <em className="muted">Nothing here yet — tap Edit to add it.</em>}</div>
          {max && <div style={{ marginTop: '.4rem' }}><CharCount n={value.length} max={max} /></div>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- a list of small records (skills, certifications, gaps, answers)

function ListBlock<T extends Record<string, string>>({ title, hint, note, items, blank, fields, render, copy, onSave, footer }: {
  title: string; hint?: string; note?: string; items: T[]; blank: T;
  fields: { key: keyof T & string; label: string; long?: boolean }[];
  render: (x: T) => ReactNode; copy: (xs: T[]) => string; onSave: (v: T[]) => Promise<void>; footer?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T[]>(items);
  const list = items ?? [];
  const set = (i: number, k: keyof T, v: string) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="card st-block">
      <div className="st-title">
        <div className="grow">
          <h3>{title}</h3>
          {hint && <div className="small muted">{hint}</div>}
        </div>
        {!editing && (
          <div className="row" style={{ gap: '.5rem' }}>
            {list.length > 0 && <CopyBtn text={copy(list)} />}
            <button onClick={() => { setDraft(list.map((x) => ({ ...x }))); setEditing(true); }}>✏️ Edit</button>
          </div>
        )}
      </div>
      {note && <p className="small notes" style={{ margin: '.3rem 0 .6rem' }}>ℹ️ {note}</p>}
      {editing ? (
        <>
          {draft.map((x, i) => (
            <div key={i} className="st-edit-item">
              {fields.map((f) => (
                <div key={f.key}>
                  <label>{f.label}</label>
                  {f.long
                    ? <textarea rows={3} style={{ minHeight: '5rem' }} value={x[f.key] ?? ''} onChange={(e) => set(i, f.key, e.target.value)} />
                    : <input value={x[f.key] ?? ''} onChange={(e) => set(i, f.key, e.target.value)} />}
                </div>
              ))}
              <button className="ghost danger small" style={{ marginTop: '.4rem' }} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>🗑️ Remove this one</button>
            </div>
          ))}
          <div className="row" style={{ marginTop: '.4rem' }}>
            <button onClick={() => setDraft((d) => [...d, { ...blank }])}>➕ Add one</button>
            <Btn className="primary" done="Saved"
              onClick={async () => {
                const cleaned = draft
                  .map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, String(v ?? '').trim()])) as T)
                  .filter((x) => Object.values(x).some((v) => v));
                await onSave(cleaned);
                setEditing(false);
              }}>
              Save
            </Btn>
            <button onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </>
      ) : list.length === 0 ? (
        <p className="muted"><em>Nothing here yet — tap Edit to add some.</em></p>
      ) : (
        list.map((x, i) => <div key={i} className="st-item">{render(x)}</div>)
      )}
      {footer && !editing && <div style={{ marginTop: '.75rem' }}>{footer}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- LinkedIn experience bullets, per role

function ExperienceBlock({ roles, onSave }: { roles: Story['linkedin_experience']; onSave: (v: Story['linkedin_experience']) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ role: string; bullets: string }[]>([]);
  const list = roles ?? [];
  const asText = (b: string[]) => b.map((x) => `• ${x}`).join('\n');
  return (
    <div className="card st-block">
      <div className="st-title">
        <div className="grow">
          <h3>Experience — new bullet points for each job</h3>
          <div className="small muted">On LinkedIn, open each job under Experience, tap ✏️, and paste these into the description.</div>
        </div>
        {!editing && <button onClick={() => { setDraft(list.map((r) => ({ role: r.role, bullets: r.bullets.join('\n') }))); setEditing(true); }}>✏️ Edit</button>}
      </div>
      {editing ? (
        <>
          {draft.map((r, i) => (
            <div key={i} className="st-edit-item">
              <label>Job</label>
              <input value={r.role} onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
              <label>Bullet points <span className="hint">One per line.</span></label>
              <textarea rows={6} value={r.bullets} onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, bullets: e.target.value } : x)))} />
              <button className="ghost danger small" style={{ marginTop: '.4rem' }} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>🗑️ Remove this job</button>
            </div>
          ))}
          <div className="row" style={{ marginTop: '.4rem' }}>
            <button onClick={() => setDraft((d) => [...d, { role: '', bullets: '' }])}>➕ Add a job</button>
            <Btn className="primary" done="Saved"
              onClick={async () => {
                const cleaned = draft
                  .map((r) => ({ role: r.role.trim(), bullets: r.bullets.split('\n').map((b) => b.replace(/^\s*[•*-]\s*/, '').trim()).filter(Boolean) }))
                  .filter((r) => r.role || r.bullets.length);
                await onSave(cleaned);
                setEditing(false);
              }}>
              Save
            </Btn>
            <button onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </>
      ) : list.length === 0 ? (
        <p className="muted"><em>Nothing here yet — tap Edit to add a job.</em></p>
      ) : (
        list.map((r, i) => (
          <div key={i} className="st-role">
            <div className="row between">
              <h4 style={{ margin: 0 }}>{r.role}</h4>
              <CopyBtn text={asText(r.bullets)} label="📋 Copy all" />
            </div>
            <ul>{r.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>
          </div>
        ))
      )}
    </div>
  );
}
