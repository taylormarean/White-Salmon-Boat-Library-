import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  HELP_ARTICLES, HELP_CATEGORIES, SUPPORT_EMAIL, getArticle, linksIn, parseBlocks, parseInline, safeHref, searchArticles, type HelpArticle,
} from '../../../shared/help-articles';
import './help.css';

// ---------------------------------------------------------------- safe rendering of the markdown subset (no HTML)

const EMAIL_RE = new RegExp(`(${SUPPORT_EMAIL.replace(/[.]/g, '\\.')})`);

function textWithEmail(text: string, key: string): ReactNode[] {
  return text.split(EMAIL_RE).map((part, i) => (part === SUPPORT_EMAIL ? <a key={`${key}-${i}`} href={`mailto:${SUPPORT_EMAIL}`}>{part}</a> : <span key={`${key}-${i}`}>{part}</span>));
}

/** One line: **bold** and [links]. Only in-app (#/…) and https links become clickable; anything else stays text. */
export function HelpInline({ text, onNavigate }: { text: string; onNavigate?: (href: string) => void }) {
  return (
    <>
      {parseInline(text).map((t, i) => {
        if (t.type === 'bold') return <strong key={i}>{textWithEmail(t.text, String(i))}</strong>;
        if (t.type === 'link') {
          const href = safeHref(t.href);
          if (!href) return <span key={i}>{t.text}</span>;
          return href.startsWith('#/')
            ? <a key={i} href={href} onClick={() => onNavigate?.(href)}>{t.text}</a>
            : <a key={i} href={href} target="_blank" rel="noopener noreferrer">{t.text} <span aria-hidden>↗</span><span className="hc-sr"> (opens in a new tab)</span></a>;
        }
        return <span key={i}>{textWithEmail(t.text, String(i))}</span>;
      })}
    </>
  );
}

/** Headings, paragraphs, bullet and numbered lists. `compact` (the chat) shows headings as bold lines. */
export function HelpRichText({ text, onNavigate, compact = false }: { text: string; onNavigate?: (href: string) => void; compact?: boolean }) {
  return (
    <>
      {parseBlocks(text).map((b, i) => {
        if (b.type === 'h2') return compact ? <p key={i}><strong><HelpInline text={b.text} onNavigate={onNavigate} /></strong></p> : <h2 key={i}><HelpInline text={b.text} onNavigate={onNavigate} /></h2>;
        if (b.type === 'h3') return compact ? <p key={i}><strong><HelpInline text={b.text} onNavigate={onNavigate} /></strong></p> : <h3 key={i}><HelpInline text={b.text} onNavigate={onNavigate} /></h3>;
        if (b.type === 'ul') return <ul key={i}>{b.items.map((it, j) => <li key={j}><HelpInline text={it} onNavigate={onNavigate} /></li>)}</ul>;
        if (b.type === 'ol') return <ol key={i}>{b.items.map((it, j) => <li key={j}><HelpInline text={it} onNavigate={onNavigate} /></li>)}</ol>;
        return <p key={i}><HelpInline text={b.text} onNavigate={onNavigate} /></p>;
      })}
    </>
  );
}

// ---------------------------------------------------------------- page

/** Opens the 💬 Help chat (SupportChat listens for this event; kept here to avoid a circular import). */
function openSupportChat(question?: string) {
  window.dispatchEvent(new CustomEvent('nc-open-support', { detail: { question } }));
}

const CATEGORY_ICON: Record<string, string> = {
  'Getting started': '🌱', 'Finding jobs': '🔎', Applying: '✍️', 'After you apply': '📬', 'Your story': '💬', 'Your account': '💳', Troubleshooting: '🛠️',
};

export default function Help({ slug, signedIn }: { slug?: string; signedIn: boolean }) {
  const article = slug ? getArticle(slug) : undefined;
  useEffect(() => {
    const before = document.title;
    document.title = article ? `${article.title} — Next Chapter help` : 'Help center — Next Chapter';
    return () => { document.title = before; };
  }, [article]);

  return (
    <div className={`hc ${signedIn ? '' : 'hc-public'}`}>
      {!signedIn && (
        <header className="hc-top">
          <a href="#/" className="hc-logo">🌱 Next Chapter</a>
          <a href="#/" className="btn primary">Sign in</a>
        </header>
      )}
      {slug ? (article ? <ArticleView a={article} signedIn={signedIn} /> : <NotFound />) : <HelpHome signedIn={signedIn} />}
    </div>
  );
}

function HelpHome({ signedIn }: { signedIn: boolean }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => (q.trim() ? searchArticles(q, 8) : []), [q]);
  const searching = q.trim().length > 0;

  return (
    <div>
      <h1>Help center</h1>
      <p className="muted">Answers to common questions about Next Chapter, in plain words.</p>

      <form role="search" className="hc-search" onSubmit={(e) => { e.preventDefault(); if (results[0]) window.location.hash = `#/help/${results[0].slug}`; }}>
        <label htmlFor="hc-q" className="hc-sr">Search the help center</label>
        <span className="hc-search-icon" aria-hidden>🔎</span>
        <input id="hc-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. “add my resume” or “pricing”" autoComplete="off"
          aria-describedby="hc-count" />
      </form>
      <div id="hc-count" className="hc-sr" aria-live="polite">{searching ? `${results.length} article${results.length === 1 ? '' : 's'} found` : ''}</div>

      {searching ? (
        <div className="hc-results">
          {results.length === 0 ? (
            <div className="card empty">No articles match “{q.trim()}”. Try other words, or ask below.</div>
          ) : results.map((a) => <ArticleLink key={a.slug} a={a} showCategory />)}
        </div>
      ) : (
        <div className="hc-cats">
          {HELP_CATEGORIES.map((c) => {
            const items = HELP_ARTICLES.filter((a) => a.category === c);
            if (!items.length) return null;
            return (
              <section key={c} className="card hc-cat" aria-labelledby={`hc-cat-${c}`}>
                <h2 id={`hc-cat-${c}`}><span aria-hidden>{CATEGORY_ICON[c] ?? '📄'}</span> {c}</h2>
                <ul>{items.map((a) => <li key={a.slug}><a href={`#/help/${a.slug}`}>{a.title}</a></li>)}</ul>
              </section>
            );
          })}
        </div>
      )}

      <StillStuck signedIn={signedIn} question={q.trim()} />
    </div>
  );
}

function ArticleLink({ a, showCategory = false }: { a: HelpArticle; showCategory?: boolean }) {
  return (
    <a className="mini hc-link" href={`#/help/${a.slug}`}>
      <strong>{a.title}</strong>
      {showCategory && <span className="small muted"> · {a.category}</span>}
      <div className="small muted">{a.summary}</div>
    </a>
  );
}

function ArticleView({ a, signedIn }: { a: HelpArticle; signedIn: boolean }) {
  const [vote, setVote] = useState<'yes' | 'no' | null>(null);
  useEffect(() => setVote(null), [a.slug]);
  const related = useMemo(() => {
    // Articles this one links to first, then similar ones from the same section, then anything similar.
    const linked = linksIn(a.body).filter((h) => h.startsWith('#/help/')).map((h) => getArticle(h.slice(7))).filter((x): x is HelpArticle => !!x);
    const similar = searchArticles(`${a.title} ${a.keywords.slice(0, 4).join(' ')}`, 8);
    const sameSection = similar.filter((x) => x.category === a.category);
    const all = [...linked, ...sameSection, ...HELP_ARTICLES.filter((x) => x.category === a.category), ...similar].filter((x) => x.slug !== a.slug);
    return [...new Map(all.map((x) => [x.slug, x])).values()].slice(0, 4);
  }, [a]);

  return (
    <article>
      <nav aria-label="Breadcrumb" className="small"><a href="#/help">← Help center</a> <span className="muted">· {a.category}</span></nav>
      <h1 className="hc-title">{a.title}</h1>
      <p className="hc-lede">{a.summary}</p>
      <div className="card hc-body"><HelpRichText text={a.body} /></div>

      <div className="hc-vote" role="group" aria-label="Was this article helpful?">
        {vote === null ? (
          <>
            <span>Did this answer your question?</span>
            <button className="chip" onClick={() => setVote('yes')}>👍 Yes</button>
            <button className="chip" onClick={() => setVote('no')}>👎 Not really</button>
          </>
        ) : vote === 'yes' ? (
          <span role="status">Glad it helped! 🌱</span>
        ) : (
          <span role="status">Sorry about that. {signedIn ? 'Ask our assistant or email us below — we’ll sort it out.' : 'Email us below — we’ll sort it out.'}</span>
        )}
      </div>

      {related.length > 0 && (
        <>
          <div className="section"><h2>Related articles</h2></div>
          <div className="hc-related">{related.map((r) => <ArticleLink key={r.slug} a={r} />)}</div>
        </>
      )}

      <StillStuck signedIn={signedIn} question="" />
    </article>
  );
}

function StillStuck({ signedIn, question }: { signedIn: boolean; question: string }) {
  return (
    <div className="card hc-stuck">
      <h2>Still stuck?</h2>
      {signedIn ? (
        <>
          <p>Our assistant knows every article here and can walk you through it step by step. It’s free to use.</p>
          <div className="row">
            <button className="primary" onClick={() => openSupportChat(question || undefined)}>💬 Ask our assistant</button>
            <a className="btn" href={`mailto:${SUPPORT_EMAIL}`}>✉️ Email support</a>
          </div>
        </>
      ) : (
        <>
          <p>Sign in to ask our assistant, or email us. A person reads every message.</p>
          <div className="row">
            <a className="btn primary" href="#/">Sign in to ask our assistant</a>
            <a className="btn" href={`mailto:${SUPPORT_EMAIL}`}>✉️ Email support</a>
          </div>
        </>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>Email: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Please never send passwords or card numbers.</p>
    </div>
  );
}

function NotFound() {
  return (
    <div>
      <a href="#/help" className="small">← Help center</a>
      <h1 className="hc-title">We couldn’t find that article</h1>
      <p>It may have moved. Try searching the <a href="#/help">help center</a>.</p>
    </div>
  );
}
