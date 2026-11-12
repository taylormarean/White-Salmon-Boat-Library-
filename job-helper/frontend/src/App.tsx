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

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [name, setName] = useState('');
  const [waiting, setWaiting] = useState(0);
  const hash = useHash();

  useEffect(() => {
    const out = () => setAuthed(false);
    window.addEventListener('nc-logout', out);
    return () => window.removeEventListener('nc-logout', out);
  }, []);
  useEffect(() => {
    if (!authed) return;
    api<{ user: { name: string } }>('/me').then((r) => setName(r.user.name)).catch(() => {});
  }, [authed]);
  useEffect(() => {
    if (!authed) return;
    api<{ waiting: unknown[]; ready: unknown[] }>('/home').then((h) => setWaiting(h.waiting.length + h.ready.length)).catch(() => {});
  }, [authed, hash]);

  if (!authed) return <Login onIn={() => setAuthed(true)} />;

  const [path, query] = hash.slice(1).split('?');
  const parts = path.split('/').filter(Boolean);
  let page;
  if (parts[0] === 'jobs' && parts[1]) page = <JobDetail id={parts[1]} />;
  else if (parts[0] === 'jobs') page = <Jobs />;
  else if (parts[0] === 'applications' && parts[1]) page = <ApplicationDetail id={parts[1]} />;
  else if (parts[0] === 'applications') page = <Applications />;
  else if (parts[0] === 'writing') page = <Writing />;
  else if (parts[0] === 'settings') page = <Settings query={new URLSearchParams(query ?? '')} />;
  else page = <Today name={name} />;

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
          {name}
          <br />
          <button className="ghost small" onClick={() => { setToken(null); setAuthed(false); }}>Sign out</button>
        </div>
      </nav>
      <main>{page}</main>
    </div>
  );
}
