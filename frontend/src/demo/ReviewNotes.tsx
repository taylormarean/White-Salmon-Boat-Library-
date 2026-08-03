// Client review notes for the app demo (IS_DEMO only): tap anything, leave a
// note; notes collect into an exportable summary the client sends back for
// implementation. App text is functional UI, so the app is note-only — the
// static site and user guide additionally support edit-in-place.

import { useEffect, useState } from 'react';
import { C, S, R, SHADOW, FONT } from '../theme';

const KEY = 'wsbl_review_app';

interface Note { page: string; context: string; note: string; ts: string }

function load(): Note[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
function persist(notes: Note[]) { localStorage.setItem(KEY, JSON.stringify(notes)); }

function pageName(): string {
  const h = window.location.hash.replace('#/', '') || 'login';
  return h.charAt(0).toUpperCase() + h.slice(1);
}

export default function ReviewNotes() {
  const [notes, setNotes] = useState<Note[]>(load);
  const [arming, setArming] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [pending, setPending] = useState<{ context: string; x: number; y: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!arming) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-rev-ui]')) return;
      e.preventDefault(); e.stopPropagation();
      const context = (t.innerText || t.getAttribute('placeholder') || t.tagName).trim().slice(0, 90);
      setPending({ context, x: Math.min(e.clientX, window.innerWidth - 360), y: Math.min(e.clientY, window.innerHeight - 220) });
      setDraft('');
      setArming(false);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [arming]);

  const saveNote = () => {
    if (!draft.trim() || !pending) return;
    const next = [...notes, { page: pageName(), context: pending.context, note: draft.trim(), ts: new Date().toLocaleString() }];
    setNotes(next); persist(next); setPending(null);
  };

  const summary = () => {
    const lines = [`# Review feedback — WSBL app demo`, `_${new Date().toLocaleString()}_`, ''];
    if (notes.length === 0) lines.push('(no notes yet)');
    notes.forEach((n, i) => lines.push(`${i + 1}. **[${n.page}]** on “${n.context}”: ${n.note}`));
    return lines.join('\n');
  };

  const copy = () => {
    const text = summary();
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => window.prompt('Copy this:', text));
  };

  const download = () => {
    const a = document.createElement('a');
    a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(summary());
    a.download = 'wsbl-app-feedback.txt';
    a.click();
  };

  const remove = (i: number) => { const next = notes.filter((_, j) => j !== i); setNotes(next); persist(next); };

  const pill: React.CSSProperties = {
    border: 'none', borderRadius: 999, padding: '10px 16px', fontSize: 13.5, fontWeight: 600,
    cursor: 'pointer', boxShadow: SHADOW.elevated, fontFamily: FONT,
  };

  return (
    <div data-rev-ui style={{ fontFamily: FONT }}>
      {arming && (
        <div data-rev-ui style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9998, textAlign: 'center',
          background: C.accent, color: '#fff', padding: '8px 16px', fontSize: 13.5, fontWeight: 600,
        }}>Tap anything to leave a note about it</div>
      )}
      <div style={{ position: 'fixed', bottom: 18, left: 18, zIndex: 9999, display: 'flex', gap: 8 }}>
        <button style={{ ...pill, background: arming ? C.accent : C.text, color: '#fff' }}
          onClick={() => { setArming(!arming); setPending(null); }}>
          {arming ? '❌ Cancel' : '📝 Add note'}
        </button>
        <button style={{ ...pill, background: '#fff', color: C.text }} onClick={() => setTrayOpen(!trayOpen)}>
          Review ({notes.length})
        </button>
      </div>

      {pending && (
        <div data-rev-ui style={{
          position: 'fixed', left: Math.max(10, pending.x), top: Math.max(10, pending.y), zIndex: 10000,
          width: 'min(340px, calc(100vw - 40px))', background: '#fff', borderRadius: R.lg,
          boxShadow: SHADOW.modal, padding: 14,
        }}>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginBottom: 8 }}>
            On: “{pending.context}” · {pageName()}
          </div>
          <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder="What should change here?"
            style={{ ...S.input, minHeight: 70, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button style={{ ...S.btnGhost, padding: '6px 14px', fontSize: 12.5 }} onClick={() => setPending(null)}>Cancel</button>
            <button style={{ ...S.btn, padding: '6px 14px', fontSize: 12.5, opacity: draft.trim() ? 1 : 0.5 }} disabled={!draft.trim()} onClick={saveNote}>Save note</button>
          </div>
        </div>
      )}

      {trayOpen && (
        <div data-rev-ui style={{
          position: 'fixed', bottom: 70, left: 18, zIndex: 9999,
          width: 'min(420px, calc(100vw - 36px))', maxHeight: '65vh', overflowY: 'auto',
          background: '#fff', borderRadius: R.lg, boxShadow: SHADOW.modal, padding: 18, fontSize: 13.5,
        }}>
          <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>Review feedback</h3>
          {notes.length === 0 && <p style={{ color: C.textSecondary }}>Nothing yet. Hit 📝 Add note, then tap anything in the app to comment on it.</p>}
          {notes.map((n, i) => (
            <div key={i} style={{ borderBottom: `1px solid ${C.divider}`, padding: '8px 0' }}>
              <button onClick={() => remove(i)} style={{ float: 'right', background: 'none', border: 'none', color: C.red, cursor: 'pointer', fontSize: 12 }}>remove</button>
              <span style={{ color: C.accent, fontWeight: 700, fontSize: 11.5, textTransform: 'uppercase' }}>{n.page}</span>
              {' '}on “{n.context.slice(0, 50)}”<br />{n.note}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button style={{ ...S.btn, padding: '8px 12px', fontSize: 12.5 }} onClick={copy}>{copied ? 'Copied ✓' : 'Copy summary'}</button>
            <button style={{ ...S.btnGhost, padding: '8px 12px', fontSize: 12.5 }} onClick={download}>Download</button>
            <button style={{ ...S.btnGhost, padding: '8px 12px', fontSize: 12.5 }} onClick={() => { if (window.confirm('Clear all notes?')) { setNotes([]); persist([]); } }}>Clear all</button>
          </div>
        </div>
      )}
    </div>
  );
}
