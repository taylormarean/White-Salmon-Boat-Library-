import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';
import Login from './pages/Login';
import Today from './pages/Today';
import Jobs from './pages/Jobs';
import JobDetail from './pages/JobDetail';
import Applications from './pages/Applications';
import ApplicationDetail from './pages/ApplicationDetail';
import Writing from './pages/Writing';
import Settings from './pages/Settings';
import { useToast } from './ui';

export interface Me {
  user: { id: number; email: string; name: string };
  is_owner: boolean;
  owner_email: string | null;
  gmail: { configured: boolean; connected: boolean; email: string | null };
  onboarding: { done: boolean; steps: Record<string, { ok: boolean; note: string }> };
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

const NAV = [
  { href: '#/', icon: '☀️', label: 'Today' },
  { href: '#/jobs', icon: '🔎', label: 'Jobs' },
  { href: '#/applications', icon: '📋', label: 'Applications' },
  { href: '#/writing', icon: '✍️', label: 'My Writing' },
  { href: '#/settings', icon: '⚙️', label: 'Settings' },
];

/** Google sends her back to #/auth?token=… (or #/login?error=…). Pick that up once, then clean the address bar. */
function takeAuthFromHash(): { error: string | null; gmailMissing: boolean } {
  const [path, q] = (window.location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(q ?? '');
  if (path === '/auth' && params.get('token')) {
    setToken(params.get('token'));
    history.replaceState(null, '', `${window.location.pathname}#/`);
    return { error: null, gmailMissing: params.get('gmail') === 'missing' };
  }
  if (path === '/login' && params.get('error')) {
    history.replaceState(null, '', `${window.location.pathname}#/`);
    return { error: params.get('error'), gmailMissing: false };
  }
  return { error: null, gmailMissing: false };
}
const initial = takeAuthFromHash();

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [me, setMe] = useState<Me | null>(null);
  const [waiting, setWaiting] = useState(0);
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
  useEffect(() => { if (authed) loadMe(); }, [authed]);
  useEffect(() => {
    if (!authed) return;
    api<{ waiting: unknown[]; ready: unknown[] }>('/home').then((h) => setWaiting(h.waiting.length + h.ready.length)).catch(() => {});
  }, [authed, hash]);

  if (!authed) return <Login onIn={() => setAuthed(true)} error={initial.error} />;

  const [path, query] = hash.slice(1).split('?');
  const parts = path.split('/').filter(Boolean);
  let page;
  if (parts[0] === 'jobs' && parts[1]) page = <JobDetail id={parts[1]} />;
  else if (parts[0] === 'jobs') page = <Jobs />;
  else if (parts[0] === 'applications' && parts[1]) page = <ApplicationDetail id={parts[1]} />;
  else if (parts[0] === 'applications') page = <Applications />;
  else if (parts[0] === 'writing') page = <Writing />;
  else if (parts[0] === 'settings') page = <Settings query={new URLSearchParams(query ?? '')} me={me} />;
  else page = <Today me={me} reloadMe={loadMe} />;

  const section = '#/' + (parts[0] ?? '');
  return (
    <div className="shell">
      <nav className="nav">
        <div className="logo">🌱 Next Chapter</div>
        {NAV.map((n) => (
          <a key={n.href} href={n.href} className={section === n.href ? 'on' : ''}>
            <span className="icon">{n.icon}</span> {n.label}
            {n.href === '#/' && waiting > 0 && <span className="count">{waiting}</span>}
          </a>
        ))}
        <div className="bottom">
          {me?.user.name}
          <br />
          <button className="ghost small" onClick={() => { setToken(null); setAuthed(false); setMe(null); }}>Sign out</button>
        </div>
      </nav>
      <main>{page}</main>
    </div>
  );
}
