import { useEffect, useState, type FormEvent, type MouseEvent } from 'react';
import { api, googleSignInUrl, setToken } from '../api';
import './landing.css';

// Public home page for signed-out visitors: the problem, the solution, every feature, pricing, and sign-in.

const REF_KEY = 'nc_ref';
const SUPPORT = 'support@nextchapterjobhunter.com';
const HELP = '#/help';
const CREDIT_PACKS_USD = [10, 25, 50, 100]; // keep in sync with worker/src/stripe.ts

interface AuthConfig { google: boolean; dev_login: boolean; signup_open: boolean; payments: boolean }

const G = (
  <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

/** Same rules as the worker: letters and digits only, at most 12, stored uppercase. */
function cleanRef(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toUpperCase();
}

/** A referral code from ?ref=… in the address, or from the hash (#/?ref=… or #/login?ref=…). */
function refFromUrl(): string {
  const fromSearch = cleanRef(new URLSearchParams(window.location.search).get('ref'));
  if (fromSearch) return fromSearch;
  const hash = window.location.hash;
  const i = hash.indexOf('?');
  return i >= 0 ? cleanRef(new URLSearchParams(hash.slice(i + 1)).get('ref')) : '';
}

function readStoredRef(): string {
  try { return cleanRef(localStorage.getItem(REF_KEY)); } catch { return ''; }
}

/** Adds the referral code unless googleSignInUrl() already carried one (it reads nc_ref too). */
function withRef(url: string, ref: string): string {
  return ref && !/[?&]ref=/.test(url) ? `${url}${url.includes('?') ? '&' : '?'}ref=${encodeURIComponent(ref)}` : url;
}

/** In-page links. The app routes on the URL hash, so scroll instead of changing it. */
function jump(e: MouseEvent<HTMLAnchorElement>) {
  const id = e.currentTarget.getAttribute('href')?.slice(1);
  const el = id ? document.getElementById(id) : null;
  if (!el) return;
  e.preventDefault();
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  el.focus({ preventScroll: true });
}

const NAV: { href: string; label: string }[] = [
  { href: '#lp-problem', label: 'The problem' },
  { href: '#lp-how', label: 'How it works' },
  { href: '#lp-features', label: 'Features' },
  { href: '#lp-pricing', label: 'Pricing' },
];

const PROBLEMS: { icon: string; text: string }[] = [
  { icon: '🔎', text: 'Hundreds of postings, scattered across dozens of sites, and most of them aren’t a good fit.' },
  { icon: '📝', text: 'Every application wants its own tailored resume and cover letter. That’s hours, again and again.' },
  { icon: '📭', text: 'Most applications get no answer at all, and it’s hard not to take the silence personally.' },
  { icon: '⏰', text: 'Follow-ups slip through the cracks, and it’s easy to lose track of who you’ve heard from.' },
  { icon: '😬', text: 'Interviews arrive with little time to prepare or practice.' },
  { icon: '🔀', text: 'Changing careers (say, into tech sales) means telling a new story, and it can be hard to know where to start.' },
  { icon: '🚩', text: 'Job scams are everywhere, and they’re getting harder to spot.' },
];

const STEPS: { title: string; body: string }[] = [
  { title: 'Sign in with Google', body: 'One button. No forms, no passwords to remember.' },
  { title: 'It gets to know you', body: 'It reads your resume and some emails you’ve written, then asks a few questions, so it learns your experience and how you sound.' },
  { title: 'Fresh jobs every morning', body: 'It finds local and remote jobs that fit you. You give each one a 👍 or 👎, and it learns what you like.' },
  { title: 'Applications written for you', body: 'For every job you like, it writes a tailored resume and cover letter in your own words. Once you OK it, it sends from your Gmail.' },
  { title: 'It keeps things moving', body: 'It follows up, notices when employers write back, keeps track of every application, and helps you get ready for interviews.' },
];

const FEATURE_GROUPS: { id: string; icon: string; title: string; items: JSX.Element[] }[] = [
  {
    id: 'setup', icon: '🌱', title: 'Getting set up',
    items: [
      <><strong>Sign in with Google.</strong> One button connects your account and your Gmail.</>,
      <><strong>Guided onboarding.</strong> Upload your resume and documents, or let it find them in your Gmail.</>,
      <><strong>A few friendly questions</strong> about your skills, experience, the roles and industries you want, remote, hybrid, or in-person, how far you’ll travel, pay (base or OTE), schedule, and any dealbreakers. It asks follow-up questions when something’s unclear.</>,
      <><strong>Learns you.</strong> It builds your career record (the only facts it will ever use) and a guide to your writing voice.</>,
    ],
  },
  {
    id: 'find', icon: '🔎', title: 'Finding jobs',
    items: [
      <><strong>A fresh search every day</strong> across remote job boards, local listings, company career pages, and RSS feeds, plus an AI web scout that finds small-town and local jobs the big sites miss.</>,
      <><strong>A fit score from 0 to 100</strong> for every job, with the reasons it fits and any gaps.</>,
      <><strong>Scam detection.</strong> Postings that ask for money, gift cards, or bank details are flagged.</>,
      <><strong>Starts with tech sales</strong> (SDR/BDR, Account Executive, Account Manager, Customer Success), but works for any kind of job.</>,
      <><strong>Your 👍 or 👎 on every recommendation</strong> teaches it your taste. Block an employer and you’ll never see them again.</>,
    ],
  },
  {
    id: 'apply', icon: '✉️', title: 'Applying',
    items: [
      <><strong>Tailored for each job:</strong> resume, cover letter, email, and answers to form questions, all in your voice and using only real facts from your history.</>,
      <><strong>Download as PDF or Word</strong> whenever you need them.</>,
      <><strong>Email applications</strong> go out from your own Gmail, with files attached, after you OK them.</>,
      <><strong>Browser helper</strong> (a Chrome extension) fills in company application forms. You check it and press Submit yourself.</>,
      <><strong>First-week test mode</strong> sends everything to you first, so you can see exactly what employers will get.</>,
    ],
  },
  {
    id: 'follow', icon: '📬', title: 'Following through',
    items: [
      <><strong>Automatic follow-ups</strong> drafted when an employer goes quiet.</>,
      <><strong>Reads employer replies</strong> and files each one with the right application, even from no-reply hiring systems.</>,
      <><strong>Drafts your replies</strong>, offering interview times you’re actually free (from your Google Calendar).</>,
      <><strong>Tracks every application</strong> until you’re hired or it’s closed.</>,
    ],
  },
  {
    id: 'interview', icon: '🎤', title: 'Interviews & career change',
    items: [
      <><strong>Company research and red-flag checks</strong> before you apply.</>,
      <><strong>Interview prep sheets</strong> with likely questions, your own STAR stories, and good questions to ask.</>,
      <><strong>Practice role-plays with a scorecard</strong>: cold call, discovery call, objection handling, “sell me this,” and a hiring-manager interview. You can practice out loud by voice.</>,
      <><strong>Thank-you notes</strong> after every interview.</>,
      <><strong>Your career-change story</strong>, a rewritten LinkedIn headline, About section, and experience, plus certifications worth considering.</>,
      <><strong>Finds hiring managers</strong> and drafts short LinkedIn notes to them.</>,
      <><strong>Offer review</strong> and a polite negotiation email when an offer comes in.</>,
    ],
  },
  {
    id: 'loop', icon: '☀️', title: 'Staying in the loop',
    items: [
      <><strong>A morning email</strong> with your to-dos (one-tap 👍/👎 on new jobs) and what it did for you yesterday.</>,
      <><strong>An optional daily text</strong> and a <strong>weekly progress summary</strong>.</>,
      <><strong>Progress insights</strong> that show what’s working in your search.</>,
      <><strong>Learns from your feedback.</strong> A “What I’ve learned” page shows every lesson, and you can edit or delete any of them.</>,
      <><strong>Family helpers.</strong> Invite a son, daughter, or friend to lend a hand.</>,
      <><strong>Alerts</strong> if something breaks, so nothing silently stops working.</>,
    ],
  },
  {
    id: 'fair', icon: '🔒', title: 'Fair pricing & safety',
    items: [
      <><strong>Pay as you go</strong> at 2× our AI cost, with a monthly limit you choose.</>,
      <><strong>Refer friends</strong> and earn 50% of the profit from their usage.</>,
      <><strong>Limited Gmail permissions:</strong> send and read only. Nothing is ever deleted.</>,
      <><strong>Follows Google’s Limited Use rules</strong> for your Google data. We never sell your data.</>,
      <><strong>You approve everything by default.</strong> Autopilot is optional, and replies to real people always wait for you.</>,
    ],
  },
];

const FAQ: { q: string; a: JSX.Element }[] = [
  {
    q: 'Is my email safe?',
    a: <>Next Chapter asks Google for only two Gmail permissions: <strong>send</strong> and <strong>read</strong>. It can’t delete or change anything in your mailbox. By default, every email waits for your OK before it’s sent. Your Gmail connection is stored encrypted, and we never sell your data. See our <a href="/privacy.html">Privacy Policy</a>.</>,
  },
  {
    q: 'Does it apply for jobs for me?',
    a: <>For jobs you can apply to by email, it writes the application and sends it from your Gmail once you approve it. For jobs that use a website form, the browser helper fills the form in, but <strong>you</strong> look it over and press Submit. It only writes applications for jobs you gave a 👍.</>,
  },
  {
    q: 'What does the Gmail permission mean?',
    a: <>When you sign in, Google will ask whether Next Chapter may <strong>send email for you</strong> and <strong>read your email</strong>. Sending is how your applications and follow-ups go out from your own address. Reading is how it notices when an employer writes back, and how it finds your old resumes and learns your writing style. It can also add interviews to your Google Calendar and check when you’re free.</>,
  },
  {
    q: 'Can a family member help me?',
    a: <>Yes. You can invite helpers, like a son, daughter, or friend, from Settings. They sign in with their own Google account to see your search and lend a hand. Their Gmail is never touched.</>,
  },
  {
    q: 'How do I stop or cancel?',
    a: <>There’s no subscription, so there’s nothing to cancel. Just stop using it whenever you like. If you have unused credit, you can ask for a refund as described in our <a href="/terms.html">Terms</a>. To delete your account and data, email <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>.</>,
  },
  {
    q: 'Is it only for tech sales jobs?',
    a: <>It starts out tuned for tech sales roles (like account executive, customer success, and sales development), but you can point it at any kind of job in Settings: office, healthcare, retail, government, and more.</>,
  },
];

export default function Landing({ onSignedIn, error }: { onSignedIn: () => void; error?: string | null }) {
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [ref, setRef] = useState<string>(() => refFromUrl() || readStoredRef());
  const [err, setErr] = useState(error ?? '');
  const [devEmail, setDevEmail] = useState('');
  const [devBusy, setDevBusy] = useState(false);

  useEffect(() => { if (error) setErr(error); }, [error]);

  useEffect(() => {
    const fromUrl = refFromUrl();
    if (fromUrl) {
      try { localStorage.setItem(REF_KEY, fromUrl); } catch { /* storage blocked: the code still rides along this visit */ }
      setRef(fromUrl);
    }
    api<AuthConfig>('/auth/config').then(setCfg).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const ownerUrl = withRef(googleSignInUrl('owner'), ref);

  async function devSignIn(e: FormEvent) {
    e.preventDefault();
    setDevBusy(true);
    try {
      const r = await api<{ token: string }>('/auth/dev', { body: { email: devEmail, ref: ref || undefined } });
      setToken(r.token);
      onSignedIn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDevBusy(false);
    }
  }

  const SignInButton = ({ label }: { label: string }) => (
    <a className="btn big lp-google" href={ownerUrl}>
      {G} {label}
    </a>
  );

  return (
    <div className="lp">
      <a className="lp-skip" href="#lp-content" onClick={jump}>Skip to content</a>
      <header className="lp-top">
        <div className="lp-wrap lp-top-in">
          <a className="lp-logo" href="/" aria-label="Next Chapter home">
            <img src="/icons/icon.svg" alt="" width="32" height="32" />
            <span>Next Chapter</span>
          </a>
          <nav className="lp-nav" aria-label="Page sections">
            {NAV.map((n) => <a key={n.href} href={n.href} onClick={jump}>{n.label}</a>)}
            <a href={HELP}>Help</a>
          </nav>
          <a className="btn primary lp-signin" href={ownerUrl}>Sign in</a>
        </div>
      </header>

      <main id="lp-content" className="lp-main" tabIndex={-1}>
        {/* ---------- hero ---------- */}
        <section className="lp-hero" aria-labelledby="lp-hero-title">
          <div className="lp-wrap">
            <span className="badge good">🌱 Now in limited beta</span>
            <h1 id="lp-hero-title">A kind, tireless partner for your job search.</h1>
            <p className="lp-sub">
              Next Chapter finds jobs that suit you every morning, writes your resume and cover letters in your own words,
              sends them from your Gmail once you say OK, and keeps track of every reply. You stay in charge; it does the legwork.
            </p>

            {err && <div className="lp-error" role="alert"><strong>Something went wrong:</strong> {err}</div>}
            {ref && <p className="lp-invited" role="status">You were invited by a friend 🎉</p>}

            <SignInButton label="Get started with Google" />
            <p className="small muted lp-perm">
              Google will ask if Next Chapter may <strong>send email for you</strong> and <strong>read your email</strong>. Please allow both.
              That’s how it sends your applications and notices when employers write back. It never deletes anything.
            </p>
            {cfg && !cfg.google && <p className="small lp-warn">Google sign-in isn’t set up on the server yet.</p>}
            {cfg && !cfg.signup_open && <p className="small muted">New sign-ups are by invitation right now. If you already have an account, sign in above.</p>}
          </div>
        </section>

        {/* ---------- the problem ---------- */}
        <section className="lp-section" aria-labelledby="lp-problem">
          <div className="lp-wrap">
            <h2 id="lp-problem" tabIndex={-1}>Job hunting today is exhausting, and lonely</h2>
            <p className="lp-lead">If your search has worn you down, it’s not you. The process is simply built to be a grind:</p>
            <ul className="lp-problems">
              {PROBLEMS.map((p) => (
                <li key={p.text}><span className="lp-picon" aria-hidden="true">{p.icon}</span><span>{p.text}</span></li>
              ))}
            </ul>
            <p className="lp-lead">None of that says anything about what you have to offer. You just need some help carrying the load.</p>
          </div>
        </section>

        {/* ---------- the solution ---------- */}
        <section className="lp-section lp-solution" aria-labelledby="lp-solution">
          <div className="lp-wrap lp-narrow">
            <h2 id="lp-solution">Meet your job-search partner</h2>
            <p className="lp-lead">
              Next Chapter is an AI job-search partner that does the busywork for you, in <strong>your own voice</strong>, while
              <strong> you stay in control</strong>. It searches, sorts, writes, follows up, and keeps track. You decide which jobs
              to go after and approve everything before it’s sent.
            </p>
            <ul className="lp-promises">
              <li>✅ Only real facts from your own history. It never invents experience.</li>
              <li>✅ Nothing is sent without your OK, unless you choose autopilot.</li>
              <li>✅ It learns from every 👍, 👎, and edit, so it keeps getting better for you.</li>
            </ul>
          </div>
        </section>

        {/* ---------- how it works ---------- */}
        <section className="lp-section" aria-labelledby="lp-how">
          <div className="lp-wrap">
            <h2 id="lp-how" tabIndex={-1}>How it works</h2>
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="lp-num" aria-hidden="true">{i + 1}</span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------- features ---------- */}
        <section className="lp-section lp-alt" aria-labelledby="lp-features">
          <div className="lp-wrap">
            <h2 id="lp-features" tabIndex={-1}>Everything it does for you</h2>
            <p className="muted">Built by a son for his mom, so it’s made to be simple, whatever your age or line of work.</p>
            <div className="lp-groups">
              {FEATURE_GROUPS.map((g) => (
                <section key={g.id} className="card lp-group" aria-labelledby={`lp-f-${g.id}`}>
                  <h3 id={`lp-f-${g.id}`}><span className="lp-icon" aria-hidden="true">{g.icon}</span>{g.title}</h3>
                  <ul>
                    {g.items.map((it, i) => <li key={i}>{it}</li>)}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- pricing ---------- */}
        <section className="lp-section" aria-labelledby="lp-pricing">
          <div className="lp-wrap">
            <h2 id="lp-pricing" tabIndex={-1}>Simple, fair pricing</h2>
            <div className="card lp-price">
              <p className="lp-price-lead">
                <strong>Pay only for what the AI uses.</strong> We charge 2× our AI cost, with no subscription.
              </p>
              <p>
                Most people spend about <strong>$1–2 on an active search day</strong>, and much less on quiet days.
                That’s an estimate: AI costs vary with how much it writes and searches for you, and you can see what you’ve spent at any time.
              </p>
              <h3>Add credit when you need it</h3>
              <ul className="lp-packs" aria-label="Credit amounts">
                {CREDIT_PACKS_USD.map((n) => <li key={n}>${n}</li>)}
              </ul>
              <p className="small muted">
                Set a monthly spending cap and it will never go over. Unused credit can be refunded on request (see our <a href="/terms.html">Terms</a>).
                Card payments are handled securely by Stripe.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- referrals ---------- */}
        <section className="lp-section lp-alt" aria-labelledby="lp-refer">
          <div className="lp-wrap lp-narrow">
            <h2 id="lp-refer">Refer a friend</h2>
            <p>
              Know someone who’s looking for work? Share your personal invite link from Settings. When a friend you invite uses Next Chapter,
              you earn 50% of the profit from their usage, paid monthly to your bank through Stripe (after a 30-day hold, once you’ve earned at least $25).
              There’s no fee to join, nothing to sell, and only your friend’s own usage counts. Most referrals earn small amounts, and nothing
              is guaranteed. Details are in our <a href="/terms.html">Terms</a>.
            </p>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section className="lp-section" aria-labelledby="lp-faq">
          <div className="lp-wrap lp-narrow">
            <h2 id="lp-faq">Questions people ask</h2>
            <div className="lp-faq">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
            <p className="muted">More answers in the <a href={HELP}>Help center</a>.</p>
          </div>
        </section>

        {/* ---------- closing CTA + other sign-ins ---------- */}
        <section className="lp-section lp-cta" aria-labelledby="lp-ready">
          <div className="lp-wrap lp-narrow">
            <h2 id="lp-ready">Ready to start your next chapter?</h2>
            <SignInButton label="Get started with Google" />

            <div className="card lp-helper">
              <h3>Helping a family member?</h3>
              <p className="small muted">
                Sign in with your own Google account. Only your name and email address are shared; your Gmail is never touched.
                Ask the person you’re helping to invite you from their Settings.
              </p>
              <a className="btn" href={googleSignInUrl('helper')}>{G} Sign in as a helper</a>
            </div>

            {cfg?.dev_login && (
              <form className="card lp-dev" onSubmit={devSignIn}>
                <label htmlFor="lp-dev-email" className="small">Developer sign-in (local only)</label>
                <div className="row">
                  <input id="lp-dev-email" type="email" required autoComplete="email" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} placeholder="email" className="grow" />
                  <button type="submit" disabled={devBusy}>Go</button>
                </div>
              </form>
            )}
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap">
          <p className="lp-logo-small">🌱 Next Chapter</p>
          <nav aria-label="Help, legal, and contact">
            <a href={HELP}>Help center</a>
            <a href="/privacy.html">Privacy Policy</a>
            <a href="/terms.html">Terms of Service</a>
            <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>
          </nav>
          <p className="small muted">© {new Date().getFullYear()} Next Chapter. Next Chapter helps you apply; it can’t promise a job or an interview.</p>
        </div>
      </footer>
    </div>
  );
}
