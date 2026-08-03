// Navigation shell — frosted-glass sticky nav, mobile slide-down menu,
// page-enter transitions, role-gated nav groups (fleet-app App.tsx pattern).

import { useEffect, useState } from 'react';
import { C, S, R, FONT, injectGlobalStyles } from './theme';
import { getAuthUser, clearAuth, isStaff, type AuthUser } from './auth';
import { IS_DEMO } from './api';
import { resetDemo } from './demo/demoApi';
import ReviewNotes from './demo/ReviewNotes';
import Login from './pages/Login';
import Join from './pages/Join';
import SelfCheckout from './pages/SelfCheckout';
import MyGear from './pages/MyGear';
import Policies from './pages/Policies';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Members from './pages/Members';
import Checkouts from './pages/Checkouts';
import Calendar from './pages/Calendar';
import Shifts from './pages/Shifts';
import Incidents from './pages/Incidents';
import AdminUsers from './pages/AdminUsers';
import Settings from './pages/Settings';

type Page =
  | 'login' | 'join' | 'checkout' | 'mygear' | 'policies' | 'shifts'
  | 'dashboard' | 'inventory' | 'members' | 'checkouts' | 'calendar' | 'incidents' | 'admin' | 'settings';

const MEMBER_NAV: { page: Page; label: string }[] = [
  { page: 'checkout', label: 'Check Out' },
  { page: 'mygear', label: 'My Gear' },
  { page: 'shifts', label: 'Volunteer' },
  { page: 'policies', label: 'Policies' },
];

const STAFF_NAV: { page: Page; label: string }[] = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'inventory', label: 'Inventory' },
  { page: 'members', label: 'Members' },
  { page: 'checkouts', label: 'Checkouts' },
  { page: 'calendar', label: 'Calendar' },
  { page: 'shifts', label: 'Schedule' },
  { page: 'incidents', label: 'Incidents' },
];

const ADMIN_NAV: { page: Page; label: string }[] = [
  { page: 'admin', label: 'Users' },
  { page: 'settings', label: 'Settings' },
];

function pageFromHash(): Page {
  const h = window.location.hash.replace('#/', '').replace('#', '');
  const valid: Page[] = ['login', 'join', 'checkout', 'mygear', 'policies', 'shifts', 'dashboard', 'inventory', 'members', 'checkouts', 'calendar', 'incidents', 'admin', 'settings'];
  return (valid as string[]).includes(h) ? (h as Page) : 'login';
}

function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '30%', flexShrink: 0,
      background: `linear-gradient(135deg, #14A0AC, ${C.accent})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.55, boxShadow: '0 2px 6px rgba(14,124,134,0.3)',
    }}>🛶</div>
  );
}

export default function App() {
  useEffect(injectGlobalStyles, []);

  const [user, setUser] = useState<AuthUser | null>(getAuthUser());
  const [page, setPage] = useState<Page>(pageFromHash());
  const [pageKey, setPageKey] = useState(0);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 780);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onHash = () => { setPage(pageFromHash()); setPageKey((k) => k + 1); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 780);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => { if (!isMobile) setMenuOpen(false); }, [isMobile]);

  const nav = (p: Page) => {
    window.location.hash = `#/${p}`;
    setPage(p);
    setPageKey((k) => k + 1);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onLogin = (u: AuthUser) => {
    setUser(u);
    nav(isStaff(u) ? 'dashboard' : 'checkout');
  };
  const onLogout = () => { clearAuth(); setUser(null); nav('login'); };

  // Unauthenticated surface: login, join, policies
  if (!user && !['join', 'policies'].includes(page)) {
    return <>{IS_DEMO && <ReviewNotes />}<Login onLogin={onLogin} onJoin={() => nav('join')} onPolicies={() => nav('policies')} /></>;
  }
  if (!user && page === 'join') return <>{IS_DEMO && <ReviewNotes />}<Join onDone={() => nav('login')} onBack={() => nav('login')} /></>;
  if (!user && page === 'policies') return (
    <div style={S.page}>
      <TopBar user={null} page={page} nav={nav} onLogout={onLogout} isMobile={isMobile} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
      <div key={pageKey} className="page-enter"><Policies /></div>
    </div>
  );

  const staff = isStaff(user);
  const admin = user?.role === 'admin';

  // Route guard: members can't open staff pages
  const staffPages: Page[] = ['dashboard', 'inventory', 'members', 'checkouts', 'calendar', 'incidents'];
  const adminPages: Page[] = ['admin', 'settings'];
  let effective = page;
  if (!staff && staffPages.includes(page)) effective = 'checkout';
  if (!admin && adminPages.includes(page)) effective = staff ? 'dashboard' : 'checkout';
  if (effective === 'login' || effective === 'join') effective = staff ? 'dashboard' : 'checkout';

  return (
    <div style={S.page}>
      {IS_DEMO && <DemoRibbon />}
      {IS_DEMO && <ReviewNotes />}
      <TopBar user={user} page={effective} nav={nav} onLogout={onLogout} isMobile={isMobile} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
      <main key={pageKey} className="page-enter" style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px 80px' }}>
        {effective === 'checkout' && <SelfCheckout onDone={() => nav('mygear')} />}
        {effective === 'mygear' && <MyGear />}
        {effective === 'policies' && <Policies />}
        {effective === 'shifts' && <Shifts staff={staff} />}
        {effective === 'dashboard' && staff && <Dashboard nav={(p) => nav(p as Page)} />}
        {effective === 'inventory' && staff && <Inventory />}
        {effective === 'members' && staff && <Members />}
        {effective === 'checkouts' && staff && <Checkouts />}
        {effective === 'calendar' && staff && <Calendar />}
        {effective === 'incidents' && staff && <Incidents />}
        {effective === 'admin' && admin && <AdminUsers />}
        {effective === 'settings' && admin && <Settings />}
      </main>
    </div>
  );
}

function DemoRibbon() {
  return (
    <div style={{
      background: `linear-gradient(90deg, ${C.accent}, #14A0AC)`, color: '#fff',
      padding: '7px 16px', fontSize: 12.5, fontWeight: 600, textAlign: 'center', fontFamily: FONT,
      display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
    }}>
      <span>DEMO — everything works; data lives only in this browser.</span>
      <button
        onClick={() => { resetDemo(); clearAuth(); window.location.hash = ''; window.location.reload(); }}
        style={{
          background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)',
          padding: '3px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
        }}>Reset demo data</button>
    </div>
  );
}

function TopBar({ user, page, nav, onLogout, isMobile, menuOpen, setMenuOpen }: {
  user: AuthUser | null; page: Page; nav: (p: Page) => void; onLogout: () => void;
  isMobile: boolean; menuOpen: boolean; setMenuOpen: (v: boolean) => void;
}) {
  const staff = isStaff(user);
  const admin = user?.role === 'admin';
  const items = user
    ? (staff
        ? [...STAFF_NAV, ...(admin ? ADMIN_NAV : []), { page: 'policies' as Page, label: 'Policies' }]
        : MEMBER_NAV)
    : [{ page: 'policies' as Page, label: 'Policies' }];

  const navBtn = (i: { page: Page; label: string }, mobile = false) => {
    const active = page === i.page;
    return (
      <button key={i.page} onClick={() => nav(i.page)} style={{
        padding: mobile ? '12px 16px' : '6px 12px',
        fontSize: mobile ? 15 : 13, fontWeight: active ? 600 : 500,
        border: 'none', borderRadius: R.sm, cursor: 'pointer', fontFamily: FONT,
        letterSpacing: '-0.01em', textAlign: 'left' as const,
        width: mobile ? '100%' : undefined,
        background: active ? C.navActiveBg : 'transparent',
        color: active ? C.navActive : C.navText,
      }}>{i.label}</button>
    );
  };

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 100,
      background: C.navBg,
      backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      borderBottom: `1px solid ${C.navBorder}`, fontFamily: FONT,
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 20px', display: 'flex', alignItems: 'center', gap: 14, height: 54 }}>
        <div onClick={() => nav(user ? (staff ? 'dashboard' : 'checkout') : 'login')}
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flexShrink: 0 }}>
          <LogoMark />
          <span style={{ fontWeight: 650, fontSize: 15, letterSpacing: '-0.02em', color: C.text, whiteSpace: 'nowrap' }}>
            {isMobile ? 'Boat Library' : 'White Salmon Boat Library'}
          </span>
        </div>

        {!isMobile && (
          <>
            <nav style={{ display: 'flex', gap: 2, flex: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
              {items.map((i) => navBtn(i))}
            </nav>
            {user ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 13, color: C.textSecondary, whiteSpace: 'nowrap' }}>{user.name}</span>
                <button onClick={onLogout} style={{ ...S.btnGhost, padding: '5px 12px', fontSize: 13 }}>Sign out</button>
              </div>
            ) : (
              <button onClick={() => nav('login')} style={{ ...S.btn, padding: '6px 16px', fontSize: 13, marginLeft: 'auto' }}>Sign in</button>
            )}
          </>
        )}

        {isMobile && (
          <button onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu" style={{
            marginLeft: 'auto', width: 38, height: 38, borderRadius: R.sm, border: `1px solid ${C.border}`,
            background: 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              {menuOpen
                ? <path d="M3 3L13 13M13 3L3 13" stroke={C.text} strokeWidth="1.8" strokeLinecap="round" />
                : <path d="M2 4H14M2 8H14M2 12H14" stroke={C.text} strokeWidth="1.8" strokeLinecap="round" />}
            </svg>
          </button>
        )}
      </div>

      {isMobile && menuOpen && (
        <div className="menu-enter" style={{
          borderTop: `1px solid ${C.divider}`, padding: '10px 16px 16px',
          display: 'flex', flexDirection: 'column', gap: 2,
          background: 'rgba(244,247,247,0.97)',
        }}>
          {items.map((i) => navBtn(i, true))}
          <div style={{ borderTop: `1px solid ${C.divider}`, marginTop: 8, paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {user ? (
              <>
                <span style={{ fontSize: 13, color: C.textSecondary }}>{user.name} · {user.role}</span>
                <button onClick={onLogout} style={{ ...S.btnGhost, padding: '6px 14px', fontSize: 13 }}>Sign out</button>
              </>
            ) : (
              <button onClick={() => nav('login')} style={{ ...S.btn, width: '100%' }}>Sign in</button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
