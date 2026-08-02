import { useState } from 'react';
import { api, IS_DEMO } from '../api';
import { setAuth, type AuthUser } from '../auth';
import { C, S } from '../theme';

const DEMO_LOGINS = [
  { label: '👤 Member — Sam (beginner)', email: 'sam.demo@example.com', password: 'paddle123' },
  { label: '👤 Member — Maya (has gear out)', email: 'maya.demo@example.com', password: 'paddle123' },
  { label: '🔑 Staff — Library Admin', email: 'admin@wsbl.demo', password: 'demo' },
];

export default function Login({ onLogin, onJoin, onPolicies }: {
  onLogin: (u: AuthUser) => void; onJoin: () => void; onPolicies: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const doLogin = async (u: string, p: string) => {
    setError(''); setBusy(true);
    try {
      const res = await api.login(u, p);
      setAuth(res.token, res.user);
      onLogin(res.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => { e.preventDefault(); doLogin(email, password); };

  return (
    <div style={{
      ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      background: `radial-gradient(900px 500px at 50% -10%, rgba(14,124,134,0.16), transparent), radial-gradient(700px 400px at 90% 110%, rgba(20,160,172,0.1), transparent), ${C.bg}`,
    }}>
      <div className="page-enter" style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <div style={{
            width: 68, height: 68, borderRadius: '30%', margin: '0 auto 14px',
            background: `linear-gradient(135deg, #14A0AC, ${C.accent})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36,
            boxShadow: '0 6px 20px rgba(14,124,134,0.35)',
          }}>🛶</div>
          <h1 style={{ ...S.h1, marginBottom: 6 }}>White Salmon Boat Library</h1>
          <p style={{ color: C.textSecondary, fontSize: 15, margin: 0, letterSpacing: '-0.01em' }}>
            Free community whitewater gear.<br />Check yourself in, grab your boat, go paddle.
          </p>
        </div>
        <form onSubmit={submit} style={{ ...S.card, padding: 26 }}>
          <label style={S.label}>Email</label>
          <input style={{ ...S.input, marginBottom: 14 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          <label style={S.label}>Password</label>
          <input style={{ ...S.input, marginBottom: 18 }} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          {error && <div style={{ color: C.red, fontSize: 14, marginBottom: 12 }}>{error}</div>}
          <button style={{ ...S.btn, width: '100%' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        {IS_DEMO && (
          <div style={{ ...S.card, marginTop: 16, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, textAlign: 'center' }}>
              Demo — one-click sign in
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {DEMO_LOGINS.map((d) => (
                <button key={d.email} onClick={() => doLogin(d.email, d.password)} disabled={busy}
                  style={{ ...S.btnGhost, width: '100%', justifyContent: 'flex-start' }}>{d.label}</button>
              ))}
            </div>
          </div>
        )}
        <div style={{ textAlign: 'center', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={onJoin} style={{ ...S.btnGhost, width: '100%' }}>New here? Become a member — it's free</button>
          <button onClick={onPolicies} style={{ background: 'none', border: 'none', color: C.textSecondary, fontSize: 13, cursor: 'pointer', padding: 6 }}>
            Library policies &amp; safety rules
          </button>
        </div>
      </div>
    </div>
  );
}
