import { useState } from 'react';
import { api, setToken } from '../api';

export default function Login({ onIn }: { onIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="login card">
      <h1>🌱 Next Chapter</h1>
      <p className="muted">Your job search helper. Sign in to see today’s matches.</p>
      <form onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr('');
        try {
          const r = await api<{ token: string }>('/login', { body: { email, password } });
          setToken(r.token);
          onIn();
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}>
        <label>Email</label>
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Password</label>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <p style={{ color: 'var(--bad)' }}>{err}</p>}
        <p><button className="primary big" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</button></p>
      </form>
    </div>
  );
}
