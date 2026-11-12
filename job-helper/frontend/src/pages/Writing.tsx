import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Btn, ErrorBox, Loading, Markdown, useLoad, useToast, when } from '../ui';

interface Doc { id: number; kind: string; title: string; filename: string | null; use_for_voice: number; created_at: string; chars: number; preview: string }
interface Voice { voice_guide: string; career_record: string; open_questions: string[]; learned_at: string | null; edits_learned: number }

const KINDS: Record<string, string> = { resume: 'Resume', cover_letter: 'Cover letter', email: 'Email', writing_sample: 'Other writing', reference: 'Reference letter', other: 'Other' };

function guessKind(name: string): string {
  const n = name.toLowerCase();
  if (/resume|résumé|cv/.test(n)) return 'resume';
  if (/cover/.test(n)) return 'cover_letter';
  if (/reference|recommend/.test(n)) return 'reference';
  if (/email|\.eml$/.test(n)) return 'email';
  return 'writing_sample';
}

async function fileToText(file: File): Promise<{ content?: string; pdf_base64?: string }> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { pdf_base64: btoa(bin) };
  }
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { content: r.value };
  }
  if (name.endsWith('.doc')) throw new Error(`${file.name}: old .doc files can’t be read — open it in Word and “Save As” .docx, or copy and paste the text.`);
  return { content: await file.text() };
}

export default function Writing() {
  const docs = useLoad<Doc[]>('/documents');
  const voice = useLoad<Voice>('/voice');
  const status = useLoad<{ gmail: { connected: boolean } }>('/status');
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState('');
  const [pasting, setPasting] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      setUploading(`Reading ${f.name}…`);
      try {
        const parsed = await fileToText(f);
        await api('/documents', { body: { ...parsed, kind: guessKind(f.name), title: f.name.replace(/\.[^.]+$/, ''), filename: f.name } });
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), true);
      }
    }
    setUploading('');
    docs.reload();
    toast('Added. When you’ve added everything, tap “Learn my voice”.');
  };

  return (
    <div>
      <h1>My Writing</h1>
      <p className="muted">Everything here teaches the app two things: the facts of your career, and how you sound when you write. The more real writing you add — especially emails and letters — the more the drafts will sound like you.</p>

      <div className="section"><h2>1. Your documents</h2></div>
      <div className="card"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
        <div className="row">
          <button className="primary" onClick={() => fileRef.current?.click()} disabled={!!uploading}>{uploading ? <><span className="spinner" /> {uploading}</> : '📄 Add files'}</button>
          <button onClick={() => setPasting(!pasting)}>📝 Paste text</button>
          {status.data?.gmail.connected && (
            <Btn busyText="Reading your sent mail…" onClick={async () => { const r = await api<{ imported: number }>('/voice/import-gmail', { method: 'POST' }); toast(`Added ${r.imported} of your sent emails`); docs.reload(); }}>
              📬 Learn from my sent Gmail
            </Btn>
          )}
          <span className="small muted">Word (.docx), PDF, or text files. You can also drag files here.</span>
        </div>
        <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.doc,.txt,.md,.eml,.rtf" style={{ display: 'none' }} onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        {pasting && <PasteDoc onDone={() => { setPasting(false); docs.reload(); }} />}
      </div>
      {docs.error && <ErrorBox error={docs.error} />}
      {!docs.data ? <Loading /> : docs.data.length === 0 ? <div className="card empty">Nothing yet. Start with your most recent resume.</div> : docs.data.map((d) => <DocRow key={d.id} d={d} reload={docs.reload} />)}

      <div className="section"><h2>2. What the app learned</h2></div>
      {voice.data && (
        <div className="card hl">
          <div className="row between">
            <div>
              {voice.data.learned_at ? <>Last learned {when(voice.data.learned_at)}. </> : <>Not learned yet. </>}
              {voice.data.edits_learned > 0 && <span className="muted">Also learning from {voice.data.edits_learned} change{voice.data.edits_learned === 1 ? '' : 's'} you’ve made to drafts.</span>}
            </div>
            <Btn className="primary big" disabled={!docs.data?.length} busyText="Reading everything… (a minute or two)" done="Done! Have a look below."
              onClick={async () => { await api('/voice/learn', { method: 'POST' }); voice.reload(); }}>
              🧠 {voice.data.learned_at ? 'Learn again' : 'Learn my voice'}
            </Btn>
          </div>
          {voice.data.open_questions.length > 0 && (
            <div className="notes" style={{ marginTop: '1rem' }}>
              <strong>A few questions that would make your applications stronger:</strong>
              <ul>{voice.data.open_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
              <span className="small">Add the answers to your career record below (tap Edit), or add a document that covers them.</span>
            </div>
          )}
        </div>
      )}
      {voice.data?.learned_at && (
        <div className="grid2">
          <VoiceBlock title="Your career record" hint="The only facts the app is allowed to use. Fix anything that’s wrong — your edits are kept." value={voice.data.career_record} field="career_record" reload={voice.reload} />
          <VoiceBlock title="How you write" hint="The style guide used for every letter and email." value={voice.data.voice_guide} field="voice_guide" reload={voice.reload} />
        </div>
      )}
    </div>
  );
}

function PasteDoc({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState('email');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  return (
    <div style={{ marginTop: '1rem' }}>
      <div className="row">
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 'auto' }}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name it (e.g. “Email to my old boss”)" className="grow" />
      </div>
      <textarea style={{ marginTop: '.5rem' }} rows={8} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste the text here" />
      <p><Btn className="primary" disabled={!content.trim()} onClick={async () => { await api('/documents', { body: { kind, title: title || KINDS[kind], content } }); onDone(); }} done="Added">Add it</Btn></p>
    </div>
  );
}

function DocRow({ d, reload }: { d: Doc; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<string | null>(null);
  useEffect(() => {
    if (open && full === null) api<{ content: string }>(`/documents/${d.id}`).then((r) => setFull(r.content));
  }, [open, full, d.id]);
  return (
    <div className="card">
      <div className="row between">
        <div className="grow">
          <strong>{d.title}</strong> <span className="badge">{KINDS[d.kind] ?? d.kind}</span>
          <div className="small muted">added {when(d.created_at)} · {Math.round(d.chars / 5)} words</div>
        </div>
        <label className="check small" style={{ margin: 0 }}>
          <input type="checkbox" checked={!!d.use_for_voice} onChange={async (e) => { await api(`/documents/${d.id}`, { method: 'PATCH', body: { use_for_voice: e.target.checked } }); reload(); }} />
          Learn from this
        </label>
        <button className="ghost" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'View'}</button>
        <Btn className="ghost danger" onClick={async () => { if (confirm(`Delete “${d.title}”?`)) { await api(`/documents/${d.id}`, { method: 'DELETE' }); reload(); } }}>Delete</Btn>
      </div>
      {open && <pre className="mail small" style={{ marginTop: '.75rem', maxHeight: 400, overflow: 'auto' }}>{full ?? 'Loading…'}</pre>}
    </div>
  );
}

function VoiceBlock({ title, hint, value, field, reload }: { title: string; hint: string; value: string; field: string; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="card">
      <div className="row between"><h2>{title}</h2>{!editing && <button onClick={() => setEditing(true)}>✏️ Edit</button>}</div>
      <p className="small muted">{hint}</p>
      {editing ? (
        <>
          <textarea className="doc" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row" style={{ marginTop: '.5rem' }}>
            <Btn className="primary" done="Saved" onClick={async () => { await api('/voice', { method: 'PUT', body: { [field]: text } }); setEditing(false); reload(); }}>Save</Btn>
            <button onClick={() => { setText(value); setEditing(false); }}>Cancel</button>
          </div>
        </>
      ) : <div className="small" style={{ maxHeight: 520, overflow: 'auto' }}><Markdown text={value} /></div>}
    </div>
  );
}
