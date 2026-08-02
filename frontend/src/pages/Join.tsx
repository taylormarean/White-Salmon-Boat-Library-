// Self-serve membership signup — replaces the in-person sign-up sheet + paper waiver.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, S } from '../theme';

const WAIVER_TEXT = `RELEASE OF LIABILITY, WAIVER OF CLAIMS & ASSUMPTION OF RISK

Whitewater paddling is inherently dangerous. Hazards include, but are not limited to: drowning, hypothermia, entrapment, collision with rocks or wood, changing river flows, and equipment failure. By signing below I acknowledge that:

1. I am voluntarily using equipment lent to me at no cost by the White Salmon Boat Library ("the Library") entirely at my own risk.
2. The Library does not provide instruction, guiding, trip planning, or supervision. I am solely responsible for judging whether a river section is within my ability.
3. I will wear a properly fitted PFD whenever I am on the water, and a helmet whenever appropriate for the craft and water.
4. I will not use Library gear while under the influence of drugs or alcohol — zero tolerance.
5. If I am new to whitewater paddling, I will only paddle with an experienced partner who can help me choose safe water and use the gear correctly.
6. I will inspect gear before use and report any damage honestly when I return it.
7. I release the White Salmon Boat Library, its volunteers, directors, and donors from any and all claims arising from my use of borrowed equipment, to the fullest extent permitted by law.

This waiver applies to every checkout I make while it remains on file.`;

export default function Join({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [info, setInfo] = useState<{ orientation_info: string } | null>(null);
  const [f, setF] = useState({
    name: '', email: '', password: '', phone: '',
    emergency_contact_name: '', emergency_contact_phone: '',
    experience_level: 'beginner', waiver_signature: '', waiver_accepted: false,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => { api.publicInfo().then(setInfo).catch(() => {}); }, []);

  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api.join(f);
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ ...S.card, maxWidth: 460, textAlign: 'center' }}>
          <div style={{ fontSize: 44 }}>🎉</div>
          <h1 style={S.h1}>Welcome to the library!</h1>
          <p style={{ color: C.textSecondary, marginBottom: 8 }}>
            Your membership and waiver are on file. Sign in to check out gear — you'll get the shed access code when you do.
          </p>
          {info?.orientation_info && <p style={{ color: C.textSecondary, fontSize: 14, marginBottom: 16 }}>{info.orientation_info}</p>}
          <button style={S.btn} onClick={onDone}>Sign in</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...S.page, padding: 20 }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <button onClick={onBack} style={{ ...S.btnGhost, marginBottom: 16 }}>← Back</button>
        <h1 style={S.h1}>Become a member</h1>
        <p style={{ color: C.textSecondary, marginBottom: 20 }}>
          Membership is free. Fill this out once, sign the waiver, and you can check out gear any time — the shed is open 24/7 for members.
        </p>
        <form onSubmit={submit}>
          <div style={{ ...S.card, marginBottom: 16 }}>
            <h2 style={S.h2}>About you</h2>
            <label style={S.label}>Full name</label>
            <input style={{ ...S.input, marginBottom: 12 }} value={f.name} onChange={(e) => set('name', e.target.value)} required />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label}>Email</label>
                <input style={S.input} type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required />
              </div>
              <div>
                <label style={S.label}>Phone</label>
                <input style={S.input} type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
              </div>
            </div>
            <label style={S.label}>Password (for signing in to check out gear)</label>
            <input style={{ ...S.input, marginBottom: 12 }} type="password" value={f.password} onChange={(e) => set('password', e.target.value)} minLength={6} required />
            <label style={S.label}>Whitewater experience</label>
            <select style={S.input} value={f.experience_level} onChange={(e) => set('experience_level', e.target.value)}>
              <option value="beginner">New to whitewater (I'll paddle with an experienced buddy)</option>
              <option value="intermediate">Intermediate — comfortable on class II–III</option>
              <option value="advanced">Advanced — class IV+</option>
            </select>
          </div>

          <div style={{ ...S.card, marginBottom: 16 }}>
            <h2 style={S.h2}>Emergency contact</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={S.label}>Name</label>
                <input style={S.input} value={f.emergency_contact_name} onChange={(e) => set('emergency_contact_name', e.target.value)} required />
              </div>
              <div>
                <label style={S.label}>Phone</label>
                <input style={S.input} type="tel" value={f.emergency_contact_phone} onChange={(e) => set('emergency_contact_phone', e.target.value)} required />
              </div>
            </div>
          </div>

          <div style={{ ...S.card, marginBottom: 16 }}>
            <h2 style={S.h2}>Liability waiver</h2>
            <pre style={{
              whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, color: C.textSecondary,
              maxHeight: 220, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 12,
            }}>{WAIVER_TEXT}</pre>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={f.waiver_accepted} onChange={(e) => set('waiver_accepted', e.target.checked)} required style={{ marginTop: 3 }} />
              <span>I have read and agree to the waiver, and to the library rules: PFD on the water, zero tolerance for drugs and alcohol with library gear, beginners paddle with a buddy.</span>
            </label>
            <label style={S.label}>Sign by typing your full legal name</label>
            <input style={S.input} value={f.waiver_signature} onChange={(e) => set('waiver_signature', e.target.value)} placeholder="Full legal name" required />
          </div>

          {error && <div style={{ color: C.red, fontSize: 14, marginBottom: 12 }}>{error}</div>}
          <button style={{ ...S.btn, width: '100%' }} disabled={busy}>{busy ? 'Creating membership…' : 'Join the library'}</button>
        </form>
      </div>
    </div>
  );
}
