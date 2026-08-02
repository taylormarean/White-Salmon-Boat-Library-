import { useState } from 'react';
import { api } from '../api';
import { setAuth, type AuthUser } from '../auth';
import { C, S } from '../theme';

export default function Login({ onLogin, onJoin, onPolicies }: {
  onLogin: (u: AuthUser) => void; onJoin: () => void; onPolicies: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const res = await api.login(email, password);
      setAuth(res.token, res.user);
      onLogin(res.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

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
