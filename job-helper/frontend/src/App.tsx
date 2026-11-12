import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';
import Landing from './pages/Landing';
import Waitlist from './pages/Waitlist';
import Today from './pages/Today';
import Jobs from './pages/Jobs';
import JobDetail from './pages/JobDetail';
import Applications from './pages/Applications';
import ApplicationDetail from './pages/ApplicationDetail';
import Writing from './pages/Writing';
import Settings from './pages/Settings';
import Learning from './pages/Learning';
import Practice from './pages/Practice';
import Story from './pages/Story';
import Insights from './pages/Insights';
import Billing from './pages/Billing';
import Referrals from './pages/Referrals';
import Admin from './pages/Admin';
import InstallPrompt from './InstallPrompt';
import { useToast } from './ui';

export interface Me {
  user: { id: number; email: string; name: string; is_admin: boolean; referral_code: string };
  workspace: { id: number; name: string; email: string; plan: 'paid' | 'free'; balance_micro: number; status: string };
  workspaces: { id: number; name: string; email: string; own: boolean }[];
  is_owner: boolean;
  owner_email: string | null;
  gmail: { configured: boolean; connected: boolean; email: string | null; calendar: boolean };
  onboarding: { done: boolean; steps: Record<string, { ok: boolean; note: string }> };
  test_mode: string | null;
  alerts: { id: number; kind: string; message: string }[];
}

function useHash(): string {
  const [h, setH] = useState(window.location.hash || '#/');
  useEffect(() => {
    const on = () => {
      setH(window.location.hash || '#/');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return h;
}

type NavItem = { href: string; icon: string; label: string; mobile?: boolean; admin?: boolean };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Job search', items: [
    { href: '#/', icon: '☀️', label: 'Today', mobile: true },
    { href: '#/jobs', icon: '🔎', label: 'Jobs', mobile: true },
    { href: '#/applications', icon: '📋', label: 'Applications', mobile: true },
  ] },
  { group: 'Get ready', items: [
    { href: '#/practice', icon: '🎤', label: 'Practice', mobile: true },
    { href: '#/story', icon: '💬', label: 'My story & LinkedIn' },
    { href: '#/writing', icon: '✍️', label: 'My writing' },
    { href: '#/learning', icon: '🧠', label: 'What I’ve learned' },
    { href: '#/insights', icon: '📈', label: 'Progress' },
  ] },
  { group: 'Account', items: [
    { href: '#/billing', icon: '💳', label: 'Credit & billing' },
    { href: '#/referrals', icon: '🎁', label: 'Refer & earn' },
    { href: '#/settings', icon: '⚙️', label: 'Settings' },
    { href: '#/admin', icon: '📊', label: 'Admin', admin: true },
  ] },
];

/** Google sends people back to #/auth?token=… (or #/login?error=…, #/waitlist). Pick that up once. */
function takeAuthFromHash(): { error: string | null; gmailMissing: boolean; waitlist: boolean } {
  const [path, q] = (window.location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(q ?? '');
  if (path === '/auth' && params.get('token')) {
    setToken(params.get('token'));
    history.replaceState(null, '', `${window.location.pathname}#/`);
    return { error: null, gmailMissing: params.get('gmail') === 'missing', waitlist: false };
  }
  if (path === '/login' && params.get('error')) {
    history.replaceState(null, '', `${window.location.pathname}#/`);
    return { error: params.get('error'), gmailMissing: false, waitlist: false };
  }
  return { error: null, gmailMissing: false, waitlist: path === '/waitlist' };
}
const initial = takeAuthFromHash();

function money(micro: number): string {
  return `$${(micro / 1e6).toFixed(2)}`;
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [me, setMe] = useState<Me | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [more, setMore] = useState(false);
  const hash = useHash();
  const toast = useToast();

  useEffect(() => {
    const out = () => { setAuthed(false); setMe(null); };
    window.addEventListener('nc-logout', out);
    if (initial.gmailMissing) toast('You’re signed in, but Gmail wasn’t connected — you can connect it in Settings.', true);
    return () => window.removeEventListener('nc-logout', out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const loadMe = () => api<Me>('/me').then(setMe).catch(() => {});
  useEffect(() => { if (authed) loadMe(); }, [authed, hash]);
  useEffect(() => {
    if (!authed || !me?.onboarding.done) return;
    api<{ waiting: unknown[]; ready: unknown[]; to_vote: unknown[] }>('/home').then((h) => setWaiting(h.waiting.length + h.ready.length + h.to_vote.length)).catch(() => {});
  }, [authed, hash, me?.onboarding.done]);
  useEffect(() => setMore(false), [hash]);

  if (initial.waitlist && !authed) return <Waitlist />;
  if (!authed) return <Landing onSignedIn={() => setAuthed(true)} error={initial.error} />;

  const [path, query] = hash.slice(1).split('?');
  const parts = path.split('/').filter(Boolean);
  let page;
  if (parts[0] === 'jobs' && parts[1]) page = <JobDetail id={parts[1]} />;
  else if (parts[0] === 'jobs') page = <Jobs />;
  else if (parts[0] === 'applications' && parts[1]) page = <ApplicationDetail id={parts[1]} me={me} />;
  else if (parts[0] === 'applications') page = <Applications />;
  else if (parts[0] === 'writing') page = <Writing />;
  else if (parts[0] === 'learning') page = <Learning />;
  else if (parts[0] === 'practice') page = <Practice />;
  else if (parts[0] === 'story') page = <Story />;
  else if (parts[0] === 'insights') page = <Insights />;
  else if (parts[0] === 'billing') page = <Billing />;
  else if (parts[0] === 'referrals') page = <Referrals />;
  else if (parts[0] === 'admin') page = <Admin />;
  else if (parts[0] === 'settings') page = <Settings query={new URLSearchParams(query ?? '')} me={me} reloadMe={loadMe} />;
  else page = <Today me={me} reloadMe={loadMe} />;

  const section = '#/' + (parts[0] ?? '');
  const items = NAV.flatMap((g) => g.items).filter((i) => !i.admin || me?.user.is_admin);
  const link = (n: NavItem) => (
    <a key={n.href} href={n.href} className={section === n.href ? 'on' : ''}>
      <span className="icon">{n.icon}</span> <span className="lbl">{n.label}</span>
      {n.href === '#/' && waiting > 0 && <span className="count">{waiting}</span>}
    </a>
  );
  const switchTo = async (id: number) => {
    const r = await api<{ token: string }>('/workspace', { body: { id } });
    setToken(r.token);
    window.location.hash = '#/';
    window.location.reload();
  };

  return (
    <div className="shell">
      <nav className="nav">
        <div className="logo">🌱 Next Chapter</div>
        {me && me.workspaces.length > 1 && (
          <select className="ws" value={me.workspace.id} onChange={(e) => switchTo(Number(e.target.value))} aria-label="Whose job search">
            {me.workspaces.map((w) => <option key={w.id} value={w.id}>{w.own ? 'My job search' : `Helping ${w.name}`}</option>)}
          </select>
        )}
        <div className="desk">
          {NAV.map((g) => {
            const visible = g.items.filter((i) => !i.admin || me?.user.is_admin);
            return (
              <div key={g.group} className="grp">
                <div className="grp-title">{g.group}</div>
                {visible.map(link)}
              </div>
            );
          })}
        </div>
        <div className="mob">
          {items.filter((i) => i.mobile).map(link)}
          <a href="#more" className={more ? 'on' : ''} onClick={(e) => { e.preventDefault(); setMore(!more); }}><span className="icon">☰</span> <span className="lbl">More</span></a>
        </div>
        {more && (
          <div className="more-sheet" role="dialog" aria-label="More">
            {items.filter((i) => !i.mobile).map(link)}
            <button className="ghost" onClick={() => { setToken(null); setAuthed(false); setMe(null); }}>Sign out</button>
          </div>
        )}
        <div className="bottom">
          {me && me.workspace.plan === 'paid' && me.is_owner && <a href="#/billing" className="credit">💳 {money(me.workspace.balance_micro)} credit</a>}
          <div>{me?.user.name}</div>
          <button className="ghost small" onClick={() => { setToken(null); setAuthed(false); setMe(null); }}>Sign out</button>
        </div>
      </nav>
      <main>
        {me && !me.is_owner && <div className="banner info">👋 You’re helping <strong>{me.workspace.name}</strong> with their job search.</div>}
        {me?.alerts.map((a) => (
          <div key={a.id} className="banner warn">⚠️ {a.message} {a.kind === 'credit' && <a href="#/billing">Add credit</a>}{a.kind === 'gmail' && <a href="#/settings">Fix it</a>}</div>
        ))}
        {me?.test_mode && me.onboarding.done && (
          <div className="banner test">🧪 <strong>Test week</strong> — emails go to your own inbox instead of employers until {new Date(me.test_mode).toLocaleDateString()}. <a href="#/settings">Turn off when you’re ready</a></div>
        )}
        {me?.onboarding.done && <InstallPrompt />}
        {page}
      </main>
    </div>
  );
}
