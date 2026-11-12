import { useEffect, useState } from 'react';
import { api, download } from '../api';
import { Btn, ErrorBox, FeedbackBox, Loading, Markdown, MessageCard, meta, MODE, STATUS, StatusBadge, useLoad, useToast, when, type OutboxItem } from '../ui';

interface Event { id: number; type: string; summary: string; detail: string | null; created_at: string }
interface AppFull {
  id: number; status: string; apply_method: 'email' | 'web' | 'in_person'; contact_email: string | null;
  resume_md: string | null; cover_letter_md: string | null; email_subject: string | null; email_body: string | null;
  form_answers: { question: string; answer: string }[]; ai_notes: string | null; notes: string | null;
  submitted_at: string | null; last_contact_at: string | null; follow_up_count: number; closed_reason: string | null;
  job: { id: number; title: string; company: string; location: string; work_mode: string; url: string; apply_url: string | null; fit_score: number | null };
  events: Event[]; outbox: OutboxItem[];
}

type Tab = 'resume' | 'cover' | 'email' | 'answers' | 'history';

export default function ApplicationDetail({ id }: { id: string }) {
  const { data: a, error, reload } = useLoad<AppFull>(`/applications/${id}`);
  const [tab, setTab] = useState<Tab>('resume');
  if (error) return <ErrorBox error={error} />;
  if (!a) return <Loading />;
  const pending = a.outbox.filter((m) => m.status === 'pending' || m.status === 'failed');

  return (
    <div>
      <a href="#/applications" className="small no-print">← All applications</a>
      <div className="row between" style={{ marginTop: '.5rem' }}>
        <div>
          <h1>{a.job.title}</h1>
          <div className="muted">{meta(a.job.company, MODE[a.job.work_mode], a.job.location)} · <a href={`#/jobs/${a.job.id}`}>job details</a></div>
        </div>
        <div className="row no-print">
          <StatusBadge s={a.status} />
          <select value={a.status} style={{ width: 'auto' }} aria-label="Change status" onChange={async (e) => {
            await api(`/applications/${a.id}`, { method: 'PATCH', body: { status: e.target.value } });
            reload();
          }}>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      <NextStep a={a} reload={reload} />

      {pending.map((m) => <MessageCard key={m.id} m={m} onChange={reload} showJob={false} />)}

      {a.ai_notes && ['drafting', 'ready'].includes(a.status) && <div className="notes no-print" style={{ marginBottom: '1rem' }}>💡 <strong>Before you send:</strong> {a.ai_notes}</div>}

      <div className="tabs no-print">
        {([['resume', 'Resume'], ['cover', 'Cover letter'], ['email', 'Email'], ['answers', 'Application questions'], ['history', `History (${a.events.length})`]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'resume' && <DocEditor a={a} field="resume_md" kind="resume" reload={reload} />}
      {tab === 'cover' && <DocEditor a={a} field="cover_letter_md" kind="cover" reload={reload} />}
      {tab === 'email' && <EmailEditor a={a} reload={reload} />}
      {tab === 'answers' && <Answers a={a} reload={reload} />}
      {tab === 'history' && <History a={a} reload={reload} />}

      {(tab === 'resume' || tab === 'cover' || tab === 'email') && (
        <div className="no-print" style={{ marginTop: '1.25rem' }}>
          <FeedbackBox
            key={tab}
            about={tab === 'cover' ? 'cover_letter' : tab}
            applicationId={a.id}
            prompt={`How’s this ${tab === 'cover' ? 'cover letter' : tab}?`}
            context={`${a.job.title} at ${a.job.company}:\n${(tab === 'resume' ? a.resume_md : tab === 'cover' ? a.cover_letter_md : a.email_body) ?? ''}`.slice(0, 2400)}
          />
          <p className="small muted" style={{ marginTop: '-.5rem' }}>What you tell me here changes every future application, not just this one.</p>
        </div>
      )}
      {tab !== 'history' && ['drafting', 'ready'].includes(a.status) && <Redraft a={a} reload={reload} />}
    </div>
  );
}

function NextStep({ a, reload }: { a: AppFull; reload: () => void }) {
  const [email, setEmail] = useState(a.contact_email ?? '');
  const toast = useToast();
  useEffect(() => setEmail(a.contact_email ?? ''), [a.contact_email]);
  const apply = a.job.apply_url || a.job.url;

  if (a.status === 'ready' || a.status === 'drafting') {
    if (a.apply_method === 'email') {
      return (
        <div className="card hl no-print">
          <h2>Ready to send ✉️</h2>
          <p>Look over the resume, cover letter, and email below. When you’re happy, the app sends it from your Gmail with both documents attached as Word files.</p>
          <label>Send to</label>
          <div className="row">
            <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ maxWidth: 360 }} />
            {email !== (a.contact_email ?? '') && <Btn onClick={async () => { await api(`/applications/${a.id}`, { method: 'PATCH', body: { contact_email: email } }); reload(); }} done="Saved">Save</Btn>}
          </div>
          <div className="row" style={{ marginTop: '1rem' }}>
            <Btn className="primary big" busyText="Sending…" done="Application sent! 🎉" disabled={!a.contact_email}
              onClick={async () => { await api(`/applications/${a.id}/send`, { method: 'POST' }); reload(); }}>Send my application</Btn>
            <button className="ghost" onClick={async () => { await api(`/applications/${a.id}`, { method: 'PATCH', body: { apply_method: 'web' } }); reload(); }}>I’ll apply on their website instead</button>
          </div>
        </div>
      );
    }
    return (
      <div className="card hl no-print">
        <h2>{a.apply_method === 'in_person' ? 'Ready to drop off 🚶‍♀️' : 'Ready to apply on their website 💻'}</h2>
        <ol>
          <li>Download your resume and cover letter: {' '}
            <button className="ghost" onClick={() => download(`/applications/${a.id}/docx/resume`, 'Resume.docx').catch((e) => toast(e.message, true))}>Resume (Word)</button>
            <button className="ghost" onClick={() => download(`/applications/${a.id}/docx/cover`, 'Cover_Letter.docx').catch((e) => toast(e.message, true))}>Cover letter (Word)</button>
            {a.apply_method === 'in_person' && <span className="small muted"> — or open a tab below and press Print.</span>}
          </li>
          {a.apply_method === 'web' ? (
            <>
              <li>{apply ? <a href={apply} target="_blank" rel="noreferrer">Open their application page ↗</a> : 'Open their application page'} and upload the two files.</li>
              <li>If the form asks questions, copy the answers from the <strong>Application questions</strong> tab.</li>
            </>
          ) : <li>Bring them in — a short friendly hello goes a long way.</li>}
          <li>Come back and tap the button below so the app can start following up.</li>
        </ol>
        <div className="row">
          <Btn className="primary big" done="Marked as applied — I’ll keep track from here."
            onClick={async () => { await api(`/applications/${a.id}/mark-submitted`, { body: { how: a.apply_method === 'in_person' ? 'Dropped off in person' : 'Applied on their website' } }); reload(); }}>✅ I submitted it</Btn>
          {a.contact_email || email ? null : (
            <span className="small muted">Tip: if you know an email for the hiring manager, add it in the Email tab so follow-ups can go out automatically.</span>
          )}
        </div>
      </div>
    );
  }
  if (a.status === 'submitted' || a.status === 'following_up') {
    return <div className="card no-print"><strong>Waiting to hear back.</strong> Applied {when(a.submitted_at)}, last contact {when(a.last_contact_at)}. {a.follow_up_count ? `${a.follow_up_count} follow-up${a.follow_up_count > 1 ? 's' : ''} sent. ` : ''}The app will draft a polite follow-up if they stay quiet, and watches your inbox for their reply.</div>;
  }
  if (a.status === 'interviewing') return <div className="card no-print"><strong>You’re talking with them — wonderful!</strong> If things go quiet after an interview, the app will draft a friendly check-in for you.</div>;
  if (a.status === 'offer') return <div className="card no-print"><strong>🎉 You have an offer!</strong> When you accept, set the status to “Hired”.</div>;
  if (a.status === 'won') return <div className="card no-print"><strong>🎉 Congratulations!</strong></div>;
  return <div className="card no-print muted">This application is closed{a.closed_reason ? `: ${a.closed_reason}` : ''}.</div>;
}

function DocEditor({ a, field, kind, reload }: { a: AppFull; field: 'resume_md' | 'cover_letter_md'; kind: 'resume' | 'cover'; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(a[field] ?? '');
  const toast = useToast();
  useEffect(() => setText(a[field] ?? ''), [a, field]);
  if (!a[field]) return <div className="card empty">Not written yet.</div>;
  return (
    <div>
      <div className="row no-print" style={{ marginBottom: '.75rem' }}>
        {editing ? (
          <>
            <Btn className="primary" done="Saved — the app will remember how you like it" onClick={async () => { await api(`/applications/${a.id}`, { method: 'PATCH', body: { [field]: text } }); setEditing(false); reload(); }}>Save changes</Btn>
            <button onClick={() => { setText(a[field] ?? ''); setEditing(false); }}>Cancel</button>
            <span className="small muted">Simple formatting: “# ” for your name, “## ” for a section, “- ” for a bullet, **bold**.</span>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)}>✏️ Edit</button>
            <button onClick={() => download(`/applications/${a.id}/docx/${kind}`, `${kind}.docx`).catch((e) => toast(e.message, true))}>⬇️ Download Word file</button>
            <button onClick={() => window.print()}>🖨️ Print / save as PDF</button>
          </>
        )}
      </div>
      {editing ? <textarea className="doc" value={text} onChange={(e) => setText(e.target.value)} /> : <div className="doc-preview"><Markdown text={a[field]!} /></div>}
    </div>
  );
}

function EmailEditor({ a, reload }: { a: AppFull; reload: () => void }) {
  const [subject, setSubject] = useState(a.email_subject ?? '');
  const [body, setBody] = useState(a.email_body ?? '');
  const [to, setTo] = useState(a.contact_email ?? '');
  const dirty = subject !== (a.email_subject ?? '') || body !== (a.email_body ?? '') || to !== (a.contact_email ?? '');
  return (
    <div className="card">
      <p className="small muted">{a.apply_method === 'email' ? 'This is the email that carries your resume and cover letter.' : 'You apply on their website, so this is a short note you could send to someone at the company.'}</p>
      <label>Employer’s email <span className="hint">used for the application and for follow-ups</span></label>
      <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="hiring@company.com" />
      <label>Subject</label>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} />
      <label>Message</label>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} />
      <p><Btn className="primary" disabled={!dirty} done="Saved" onClick={async () => { await api(`/applications/${a.id}`, { method: 'PATCH', body: { email_subject: subject, email_body: body, contact_email: to } }); reload(); }}>Save</Btn></p>
    </div>
  );
}

function Answers({ a, reload }: { a: AppFull; reload: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState(a.form_answers);
  useEffect(() => setItems(a.form_answers), [a.form_answers]);
  if (!items.length) return <div className="card empty">No suggested answers for this one.</div>;
  return (
    <div>
      <p className="small muted">Answers to questions their application form is likely to ask — copy and paste them, or adjust as you like.</p>
      {items.map((qa, i) => (
        <div key={i} className="card">
          <h3>{qa.question}</h3>
          <textarea value={qa.answer} rows={4} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} />
          <div className="row" style={{ marginTop: '.5rem' }}>
            <button onClick={() => navigator.clipboard.writeText(qa.answer).then(() => toast('Copied — now paste it into their form'))}>📋 Copy</button>
            {qa.answer !== a.form_answers[i]?.answer && <Btn done="Saved" onClick={async () => { await api(`/applications/${a.id}`, { method: 'PATCH', body: { form_answers: items } }); reload(); }}>Save</Btn>}
          </div>
        </div>
      ))}
    </div>
  );
}

function History({ a, reload }: { a: AppFull; reload: () => void }) {
  const [note, setNote] = useState('');
  const sent = a.outbox.filter((m) => m.status === 'sent');
  return (
    <div className="grid2">
      <div className="card">
        <h2>What’s happened</h2>
        <div className="row" style={{ marginBottom: '1rem' }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (e.g. “Called and left a message for Sue”)" />
          <Btn disabled={!note.trim()} onClick={async () => { await api(`/applications/${a.id}/note`, { body: { text: note } }); setNote(''); reload(); }}>Add</Btn>
        </div>
        <ul className="timeline">
          {a.events.map((e) => {
            const d = e.type === 'reply' && e.detail ? JSON.parse(e.detail) as { from: string; subject: string; body: string; key_details: string } : null;
            return (
              <li key={e.id} className={e.type}>
                <div>{e.summary}</div>
                <div className="small muted">{new Date(e.created_at.replace(' ', 'T') + 'Z').toLocaleString()}</div>
                {d && (
                  <details>
                    <summary className="small">Read their email</summary>
                    {d.key_details && <p className="small"><strong>Details:</strong> {d.key_details}</p>}
                    <pre className="mail small">From: {d.from}{'\n'}Subject: {d.subject}{'\n\n'}{d.body}</pre>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <h2>Emails sent</h2>
        {sent.length === 0 ? <div className="card empty">None yet.</div> : sent.map((m) => <MessageCard key={m.id} m={m} onChange={reload} showJob={false} />)}
      </div>
    </div>
  );
}

function Redraft({ a, reload }: { a: AppFull; reload: () => void }) {
  const [fb, setFb] = useState('');
  return (
    <div className="card no-print" style={{ marginTop: '1.25rem' }}>
      <h3>Want changes?</h3>
      <p className="small muted">Tell it what to change in plain words and it will rewrite the resume, cover letter, and email. For example: “Mention my volunteer work at the food bank” or “Make the letter shorter and warmer.”</p>
      <textarea rows={3} value={fb} onChange={(e) => setFb(e.target.value)} />
      <p><Btn className="primary" disabled={!fb.trim()} busyText="Rewriting… (about a minute)" done="Rewritten"
        onClick={async () => { await api(`/applications/${a.id}/redraft`, { body: { feedback: fb } }); setFb(''); reload(); }}>Rewrite it</Btn></p>
    </div>
  );
}
