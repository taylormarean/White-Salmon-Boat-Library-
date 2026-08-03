// Self-serve membership signup — replaces the in-person sign-up sheet + paper waiver.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, S } from '../theme';

// ⚠ DRAFT WAIVER — written to match the library's published policies, but it is
// NOT the library's official waiver. Before launch, replace this constant with
// the exact text of the paper waiver used at the shed (get it from the library
// or their attorney), then bump the waiver_version setting so every member
// re-signs the official version at their next checkout.
const WAIVER_TEXT = `RELEASE OF LIABILITY, WAIVER OF CLAIMS & ASSUMPTION OF RISK

Whitewater paddling is inherently dangerous. Hazards include, but are not limited to: drowning, hypothermia, entrapment, collision with rocks or wood, changing river flows, and equipment failure. By signing below I acknowledge that:

1. I am voluntarily using equipment lent to me at no cost by the White Salmon Boat Library ("the Library") entirely at my own risk.
2. The Library does not provide instruction, guiding, trip planning, or supervision. I am solely responsible for judging whether a river section is within my ability.
3. I will wear a suitable PFD whenever I am on the water, and a helmet whenever appropriate for the craft and water.
4. I will not use Library gear while under the influence of drugs or alcohol — zero tolerance for drug and alcohol use when on the river with library gear.
5. I will boat within my personal skill level and will never use Library equipment on Class V whitewater. If I am new to the sport, I will only go with another person who can help me choose safe river sections and instruct me on proper use of the gear.
6. It is my duty to inspect all of my own gear for defects before use. I will report any damage honestly when I return gear, and follow the Library's gear-care rules (torn, ripped, or broken gear goes in the repair bin; damaged gear is reported and set aside).
7. Library gear is intended for local use. If gear is leaving a 100-mile radius of the library, I will tell the Library where the gear is going.
8. I will not share my access code with anyone, and I will abide by the Library's community standards, including its anti-discrimination policy and zero tolerance for harassment.
9. I release the White Salmon Boat Library, its volunteers, directors, and donors from any and all claims arising from my use of borrowed equipment, to the fullest extent permitted by law.

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
            {import.meta.env.VITE_DEMO === '1' && (
              <p style={{ fontSize: 12.5, color: C.yellow, marginBottom: 10 }}>
                Demo note: draft waiver text — the library's official waiver drops in before launch.
              </p>
            )}
            <pre style={{
              whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, color: C.textSecondary,
              maxHeight: 220, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 12,
            }}>{WAIVER_TEXT}</pre>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={f.waiver_accepted} onChange={(e) => set('waiver_accepted', e.target.checked)} required style={{ marginTop: 3 }} />
              <span>I have read and agree to the waiver and to all White Salmon Boat Library policies, including the rental-period, gear-care, safety, and community-standards rules.</span>
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
