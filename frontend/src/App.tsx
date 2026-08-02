// Navigation shell — hash-routed, role-gated nav groups (fleet-app App.tsx pattern).

import { useEffect, useState } from 'react';
import { C, S, FONT } from './theme';
import { getAuthUser, clearAuth, isStaff, type AuthUser } from './auth';
import Login from './pages/Login';
import Join from './pages/Join';
import SelfCheckout from './pages/SelfCheckout';
import MyGear from './pages/MyGear';
import Policies from './pages/Policies';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Members from './pages/Members';
import Checkouts from './pages/Checkouts';
import Shifts from './pages/Shifts';
import Incidents from './pages/Incidents';
import AdminUsers from './pages/AdminUsers';
import Settings from './pages/Settings';

type Page =
  | 'login' | 'join' | 'checkout' | 'mygear' | 'policies' | 'shifts'
  | 'dashboard' | 'inventory' | 'members' | 'checkouts' | 'incidents' | 'admin' | 'settings';

const MEMBER_NAV: { page: Page; label: string }[] = [
  { page: 'checkout', label: 'Check Out Gear' },
  { page: 'mygear', label: 'My Gear' },
  { page: 'shifts', label: 'Volunteer' },
  { page: 'policies', label: 'Policies' },
];

const STAFF_NAV: { page: Page; label: string }[] = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'inventory', label: 'Inventory' },
  { page: 'members', label: 'Members' },
  { page: 'checkouts', label: 'Checkouts' },
  { page: 'shifts', label: 'Schedule' },
  { page: 'incidents', label: 'Incidents' },
  { page: 'policies', label: 'Policies' },
];

const ADMIN_NAV: { page: Page; label: string }[] = [
  { page: 'admin', label: 'Users' },
  { page: 'settings', label: 'Settings' },
];

function pageFromHash(): Page {
  const h = window.location.hash.replace('#/', '').replace('#', '');
  const valid: Page[] = ['login', 'join', 'checkout', 'mygear', 'policies', 'shifts', 'dashboard', 'inventory', 'members', 'checkouts', 'incidents', 'admin', 'settings'];
  return (valid as string[]).includes(h) ? (h as Page) : 'login';
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(getAuthUser());
  const [page, setPage] = useState<Page>(pageFromHash());

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const nav = (p: Page) => { window.location.hash = `#/${p}`; setPage(p); };

  const onLogin = (u: AuthUser) => {
    setUser(u);
    nav(isStaff(u) ? 'dashboard' : 'checkout');
  };
  const onLogout = () => { clearAuth(); setUser(null); nav('login'); };

  // Unauthenticated surface: login, join, policies, browse-only checkout page
  if (!user && !['join', 'policies'].includes(page)) {
    return <Login onLogin={onLogin} onJoin={() => nav('join')} onPolicies={() => nav('policies')} />;
  }
  if (!user && page === 'join') return <Join onDone={() => nav('login')} onBack={() => nav('login')} />;
  if (!user && page === 'policies') return (
    <div style={S.page}><TopBar user={null} page={page} nav={nav} onLogout={onLogout} /><Policies /></div>
  );

  const staff = isStaff(user);
  const admin = user?.role === 'admin';

  // Route guard: members can't open staff pages
  const staffPages: Page[] = ['dashboard', 'inventory', 'members', 'checkouts', 'incidents'];
  const adminPages: Page[] = ['admin', 'settings'];
  let effective = page;
  if (!staff && staffPages.includes(page)) effective = 'checkout';
  if (!admin && adminPages.includes(page)) effective = staff ? 'dashboard' : 'checkout';
  if (effective === 'login') effective = staff ? 'dashboard' : 'checkout';

  return (
    <div style={S.page}>
      <TopBar user={user} page={effective} nav={nav} onLogout={onLogout} />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 60px' }}>
        {effective === 'checkout' && <SelfCheckout onDone={() => nav('mygear')} />}
        {effective === 'mygear' && <MyGear />}
        {effective === 'policies' && <Policies />}
        {effective === 'shifts' && <Shifts staff={staff} />}
        {effective === 'dashboard' && staff && <Dashboard nav={(p) => nav(p as Page)} />}
        {effective === 'inventory' && staff && <Inventory />}
        {effective === 'members' && staff && <Members />}
        {effective === 'checkouts' && staff && <Checkouts />}
        {effective === 'incidents' && staff && <Incidents />}
        {effective === 'admin' && admin && <AdminUsers />}
        {effective === 'settings' && admin && <Settings />}
      </main>
    </div>
  );
}

function TopBar({ user, page, nav, onLogout }: {
  user: AuthUser | null; page: Page; nav: (p: Page) => void; onLogout: () => void;
}) {
  const staff = isStaff(user);
  const admin = user?.role === 'admin';
  const items = user
    ? (staff ? [...STAFF_NAV, ...(admin ? ADMIN_NAV : [])] : MEMBER_NAV)
    : [{ page: 'policies' as Page, label: 'Policies' }];

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 10, background: C.navBg, backdropFilter: 'blur(12px)',
      borderBottom: `1px solid ${C.border}`, fontFamily: FONT,
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
          🛶 White Salmon Boat Library
        </div>
        <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
          {items.map((i) => (
            <button key={i.page} onClick={() => nav(i.page)} style={{
              padding: '7px 12px', fontSize: 14, fontWeight: 500, border: 'none', borderRadius: 8, cursor: 'pointer',
              background: page === i.page ? C.accentTint : 'transparent',
              color: page === i.page ? C.accent : C.textSecondary,
            }}>{i.label}</button>
          ))}
        </nav>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: C.textSecondary }}>{user.name} · {user.role}</span>
            <button onClick={onLogout} style={{ ...S.btnGhost, padding: '6px 12px', fontSize: 13 }}>Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}
