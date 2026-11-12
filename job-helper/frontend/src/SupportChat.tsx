import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, ApiError } from './api';
import { useToast } from './ui';
import { HelpRichText } from './pages/Help';
import { SUPPORT_EMAIL } from '../../shared/help-articles';
import './pages/help.css';

/**
 * The floating “💬 Help” button and chat panel (signed-in only). The conversation lives in
 * sessionStorage, so it survives moving between pages and reloads, and ends with the browser tab.
 * Anything can open it with `openSupportChat()` (or the `nc-open-support` window event).
 */

interface Msg {
  role: 'user' | 'assistant';
  text: string;
  id?: number | null;                     // support_messages row, for 👍/👎
  articles?: { slug: string; title: string }[];
  rating?: boolean;                       // true 👍, false 👎
  note?: boolean;                         // an error/limit notice — shown, never sent back to the assistant
}

const STORE = 'nc_support_chat';
const OPEN_EVENT = 'nc-open-support';
const SUGGESTIONS = [
  'How do I add my resume?',
  'Why are emails going to my own inbox?',
  'How does pricing work?',
  'How do I install the browser helper?',
];

export function openSupportChat(question?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { question } }));
}

function load(): Msg[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(STORE) ?? '[]');
    return Array.isArray(v) ? (v as Msg[]).filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string').slice(-40) : [];
  } catch {
    return [];
  }
}

/** Height of the app's bottom nav on phones (0 when there isn't one), so the button and panel sit above it. */
function useBottomNavHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const phone = window.matchMedia('(max-width: 760px)');
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const nav = document.querySelector<HTMLElement>('nav.nav');
      setH(phone.matches && nav && getComputedStyle(nav).position === 'fixed' ? Math.ceil(nav.getBoundingClientRect().height) : 0);
    };
    measure();
    const nav = document.querySelector<HTMLElement>('nav.nav');
    if (nav && 'ResizeObserver' in window) { ro = new ResizeObserver(measure); ro.observe(nav); }
    phone.addEventListener('change', measure);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); phone.removeEventListener('change', measure); window.removeEventListener('resize', measure); };
  }, []);
  return h;
}

export default function SupportChat() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(load);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const launcher = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const navH = useBottomNavHeight();

  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-40))); } catch { /* storage full or blocked */ }
  }, [msgs]);

  // Focus: into the box when it opens, back to the button when it closes.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else if (wasOpen.current) launcher.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, sending, open]);

  // Opened from elsewhere (the help center's “Ask our assistant” button).
  useEffect(() => {
    const on = (e: Event) => {
      const q = (e as CustomEvent<{ question?: string }>).detail?.question;
      setOpen(true);
      if (q) setInput(q);
    };
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);

  // Esc closes, from anywhere on the page.
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [open]);

  const send = useCallback(async (text: string) => {
    const q = text.trim().slice(0, 2000);
    if (!q || sending) return;
    const next: Msg[] = [...msgs, { role: 'user', text: q }];
    setMsgs(next);
    setInput('');
    setSending(true);
    try {
      const history = next.filter((m) => !m.note).slice(-12).map((m) => ({ role: m.role, text: m.text }));
      const r = await api<{ id: number | null; reply: string; articles: { slug: string; title: string }[] }>('/support/chat', { body: { messages: history } });
      setMsgs((cur) => [...cur, { role: 'assistant', text: r.reply, id: r.id, articles: r.articles }]);
    } catch (e) {
      const msg = e instanceof ApiError || e instanceof Error ? e.message : String(e);
      setMsgs((cur) => [...cur, { role: 'assistant', note: true, text: msg || 'Sorry — something went wrong. Please try again.' }]);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [msgs, sending]);

  const rate = async (i: number, helpful: boolean) => {
    const m = msgs[i];
    if (!m?.id || m.rating === helpful) return;
    setMsgs((cur) => cur.map((x, j) => (j === i ? { ...x, rating: helpful } : x)));
    try {
      await api('/support/feedback', { body: { id: m.id, helpful } });
      toast(helpful ? 'Thanks — glad that helped!' : `Thanks for telling us. You can also email ${SUPPORT_EMAIL}.`);
    } catch (e) {
      setMsgs((cur) => cur.map((x, j) => (j === i ? { ...x, rating: undefined } : x)));
      toast(e instanceof Error ? e.message : String(e), true);
    }
  };

  // On a phone the panel covers the page: following an in-app link closes it so you can see the screen.
  const onNavigate = () => { if (window.matchMedia('(max-width: 760px)').matches) setOpen(false); };
  const asked = msgs.some((m) => m.role === 'user');
  const place = { '--sc-nav': `${navH}px` } as CSSProperties;

  return (
    <>
      {!open && (
        <button ref={launcher} type="button" className="sc-launch" style={place} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={false}>
          <span aria-hidden>💬</span> Help
        </button>
      )}
      {open && (
        <div className="sc-panel" style={place} role="dialog" aria-modal="false" aria-labelledby="sc-title">
          <div className="sc-head">
            <h2 id="sc-title"><span aria-hidden>💬</span> Next Chapter help</h2>
            <div className="sc-head-actions">
              {msgs.length > 0 && <button type="button" className="ghost small" onClick={() => { setMsgs([]); inputRef.current?.focus(); }}>Start over</button>}
              <button type="button" className="sc-close" onClick={() => setOpen(false)} aria-label="Close help chat">✕</button>
            </div>
          </div>

          <div ref={listRef} className="sc-list" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation">
            <div className="sc-msg assistant">
              <div className="sc-bubble">
                <p>Hi! 👋 I’m the Next Chapter assistant. Ask me anything about using the app — I’ll walk you through it step by step.</p>
                {!asked && (
                  <div className="sc-chips" role="group" aria-label="Suggested questions">
                    {SUGGESTIONS.map((s) => <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={sending}>{s}</button>)}
                  </div>
                )}
              </div>
            </div>

            {msgs.map((m, i) => (
              <div key={i} className={`sc-msg ${m.role} ${m.note ? 'note' : ''}`}>
                <span className="hc-sr">{m.role === 'user' ? 'You said:' : 'Assistant:'}</span>
                <div className="sc-bubble">
                  {m.role === 'user' || m.note ? <p>{m.text}</p> : <HelpRichText text={m.text} onNavigate={onNavigate} compact />}
                  {m.role === 'assistant' && !m.note && m.articles?.some((a) => !m.text.includes(`#/help/${a.slug})`)) && (
                    <div className="sc-more">
                      <span className="small muted">Read more:</span>
                      <ul>{m.articles.filter((a) => /^[a-z0-9-]+$/.test(a.slug) && !m.text.includes(`#/help/${a.slug})`)).map((a) => <li key={a.slug}><a href={`#/help/${a.slug}`} onClick={onNavigate}>{a.title}</a></li>)}</ul>
                    </div>
                  )}
                  {m.note && <p className="small"><a href={`mailto:${SUPPORT_EMAIL}`}>Email support</a> · <a href="#/help" onClick={onNavigate}>Browse help articles</a></p>}
                </div>
                {m.role === 'assistant' && !m.note && m.id ? (
                  <div className="sc-rate" role="group" aria-label="Was this answer helpful?">
                    <button type="button" className={`sc-rate-btn ${m.rating === true ? 'on' : ''}`} aria-pressed={m.rating === true} aria-label="Helpful" title="Helpful" onClick={() => rate(i, true)}>👍</button>
                    <button type="button" className={`sc-rate-btn ${m.rating === false ? 'on' : ''}`} aria-pressed={m.rating === false} aria-label="Not helpful" title="Not helpful" onClick={() => rate(i, false)}>👎</button>
                  </div>
                ) : null}
              </div>
            ))}

            {sending && (
              <div className="sc-msg assistant">
                <div className="sc-bubble sc-typing" role="status">
                  <span className="hc-sr">The assistant is typing…</span>
                  <i aria-hidden /><i aria-hidden /><i aria-hidden />
                </div>
              </div>
            )}
          </div>

          <form className="sc-form" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <label htmlFor="sc-input" className="hc-sr">Your question</label>
            <textarea id="sc-input" ref={inputRef} rows={2} maxLength={2000} value={input} placeholder="Type your question…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); } }} />
            <button type="submit" className="primary" disabled={sending || !input.trim()}>Send</button>
          </form>
          <div className="sc-foot small">
            <span className="muted">Please don’t share passwords or card numbers.</span>
            <a href={`mailto:${SUPPORT_EMAIL}`}>✉️ Email support</a>
          </div>
        </div>
      )}
    </>
  );
}
