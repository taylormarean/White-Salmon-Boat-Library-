// The self-serve checkout — digital replacement for the paper checkout board.
// Pick gear -> pick return date -> safety acknowledgments -> get the shed code.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { C, S } from '../theme';

export default function SelfCheckout({ onDone }: { onDone: () => void }) {
  const [me, setMe] = useState<any>(null);
  const [gear, setGear] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState('');
  const [acks, setAcks] = useState({ sober: false, pfd: false, experience: false, condition: false });
  const [buddy, setBuddy] = useState('');
  const [river, setRiver] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const load = () => {
    api.me().then((r) => setMe(r.member)).catch(() => {});
    api.getGear().then(setGear).catch((e) => setError(e.message));
    api.getCategories().then(setCats).catch(() => {});
  };
  useEffect(load, []);

  const available = useMemo(() => gear.filter((g) => g.status === 'available'), [gear]);
  const byCat = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const g of available) {
      if (!m.has(g.category_id)) m.set(g.category_id, []);
      m.get(g.category_id)!.push(g);
    }
    return m;
  }, [available]);

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const isBeginner = me?.experience_level === 'beginner';
  const maxDate = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }, []);

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      const res = await api.selfCheckout({
        gear_item_ids: [...selected],
        due_at: dueDate ? new Date(`${dueDate}T20:00:00`).toISOString() : '',
        ack_sober: acks.sober, ack_pfd: acks.pfd, ack_experience: acks.experience, ack_condition: acks.condition,
        buddy_name: buddy, planned_river_section: river,
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message);
      load(); // refresh availability in case someone raced us
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ ...S.card, padding: 32 }}>
          <div style={{ fontSize: 44 }}>🔓</div>
          <h1 style={S.h1}>You're all set!</h1>
          <p style={{ color: C.textSecondary, marginBottom: 20 }}>Your shed access code:</p>
          <div style={{
            fontSize: 44, fontWeight: 800, letterSpacing: '0.2em', color: C.accent,
            background: C.accentTint, borderRadius: 14, padding: '18px 0', marginBottom: 20,
          }}>{result.access_code}</div>
          <div style={{ textAlign: 'left', fontSize: 14, color: C.textSecondary, marginBottom: 20 }}>
            <p style={{ marginBottom: 8 }}><strong style={{ color: C.text }}>Your gear:</strong></p>
            <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
              {result.items.map((i: any) => (
                <li key={i.id}>{i.gear_code} — {[i.brand, i.model].filter(Boolean).join(' ') || i.name}</li>
              ))}
            </ul>
            <p style={{ marginBottom: 4 }}><strong style={{ color: C.text }}>Due back:</strong> {new Date(result.due_at).toDateString()}</p>
            <p>We also emailed this to you. Close the shed and scramble the lock on your way out. Have a great paddle! 🌊</p>
          </div>
          <button style={S.btn} onClick={onDone}>View my gear</button>
        </div>
      </div>
    );
  }

  const canSubmit = selected.size > 0 && dueDate && acks.sober && acks.pfd && acks.experience && acks.condition && (!isBeginner || buddy.trim());

  return (
    <div>
      <h1 style={S.h1}>Check out gear</h1>
      <p style={{ color: C.textSecondary, marginBottom: 20 }}>
        Pick what you need, agree to the safety rules, and you'll get the shed access code instantly.
      </p>

      {me && me.status !== 'active' && (
        <div style={{ ...S.card, borderLeft: `4px solid ${C.red}`, marginBottom: 16 }}>
          Your membership is {me.status}. Contact the library before checking out gear.
        </div>
      )}

      <div style={{ ...S.card, marginBottom: 16 }}>
        <h2 style={S.h2}>1 · Pick your gear <span style={{ color: C.textSecondary, fontWeight: 400 }}>({selected.size} selected, max 6)</span></h2>
        {cats.map((cat) => {
          const items = byCat.get(cat.id) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={cat.id} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{cat.name}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {items.map((g) => {
                  const on = selected.has(g.id);
                  return (
                    <button key={g.id} onClick={() => toggle(g.id)} style={{
                      padding: '8px 12px', borderRadius: 10, fontSize: 13, cursor: 'pointer', textAlign: 'left',
                      border: `1.5px solid ${on ? C.accent : C.border}`,
                      background: on ? C.accentTint : '#fff', color: C.text,
                    }}>
                      <div style={{ fontWeight: 600 }}>{g.gear_code} · {[g.brand, g.model].filter(Boolean).join(' ') || g.name}</div>
                      <div style={{ color: C.textSecondary, fontSize: 12 }}>{[g.color, g.size && `size ${g.size}`, g.condition].filter(Boolean).join(' · ')}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {available.length === 0 && <p style={{ color: C.textSecondary }}>No gear is available right now — check back soon.</p>}
      </div>

      <div style={{ ...S.card, marginBottom: 16 }}>
        <h2 style={S.h2}>2 · When will you bring it back?</h2>
        <label style={S.label}>Return date (loans up to 7 days)</label>
        <input style={{ ...S.input, maxWidth: 220 }} type="date" value={dueDate}
          min={new Date().toISOString().slice(0, 10)} max={maxDate}
          onChange={(e) => setDueDate(e.target.value)} />
        <div style={{ marginTop: 12 }}>
          <label style={S.label}>Where are you planning to paddle? (optional, helps us help you)</label>
          <input style={{ ...S.input, maxWidth: 380 }} value={river} onChange={(e) => setRiver(e.target.value)} placeholder="e.g. Husum to Northwestern" />
        </div>
      </div>

      <div style={{ ...S.card, marginBottom: 16 }}>
        <h2 style={S.h2}>3 · The library agreement</h2>
        {([
          ['sober', 'Zero tolerance: no drugs or alcohol while using library gear on the river.'],
          ['pfd', 'I will wear a properly fitted PFD whenever I am on the water.'],
          ['experience', isBeginner
            ? 'I am new to whitewater, so I will only paddle with an experienced buddy who can guide me on safe water and gear use.'
            : 'I will only paddle water within my ability, and help newer paddlers do the same.'],
          ['condition', 'I will inspect the gear before use and honestly report any damage when I return it.'],
        ] as [keyof typeof acks, string][]).map(([k, label]) => (
          <label key={k} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, marginBottom: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={acks[k]} onChange={(e) => setAcks((p) => ({ ...p, [k]: e.target.checked }))} style={{ marginTop: 3 }} />
            <span>{label}</span>
          </label>
        ))}
        {isBeginner && (
          <div style={{ marginTop: 8 }}>
            <label style={S.label}>Who are you paddling with? (required for new paddlers)</label>
            <input style={{ ...S.input, maxWidth: 380 }} value={buddy} onChange={(e) => setBuddy(e.target.value)} placeholder="Buddy's name" />
          </div>
        )}
      </div>

      {error && <div style={{ color: C.red, fontSize: 14, marginBottom: 12 }}>{error}</div>}
      <button style={{ ...S.btn, opacity: canSubmit ? 1 : 0.5 }} disabled={!canSubmit || busy} onClick={submit}>
        {busy ? 'Checking out…' : 'Check out & get shed code'}
      </button>
    </div>
  );
}
