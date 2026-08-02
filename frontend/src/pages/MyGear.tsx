// Member's active checkouts: access code recall + self-return with condition report.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, S } from '../theme';

export default function MyGear() {
  const [data, setData] = useState<{ member: any; active_checkouts: any[] } | null>(null);
  const [error, setError] = useState('');
  const [returning, setReturning] = useState<string | null>(null); // checkout id
  const [conditions, setConditions] = useState<Record<string, { condition: string; damage_notes: string }>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = () => { api.me().then(setData).catch((e) => setError(e.message)); };
  useEffect(load, []);

  const startReturn = (co: any) => {
    setReturning(co.id);
    const init: Record<string, { condition: string; damage_notes: string }> = {};
    for (const i of co.items.filter((i: any) => !i.returned_at)) init[i.gear_item_id] = { condition: 'ok', damage_notes: '' };
    setConditions(init);
    setMessage('');
  };

  const submitReturn = async (co: any) => {
    setBusy(true); setError('');
    try {
      const items = Object.entries(conditions).map(([gear_item_id, v]) => ({ gear_item_id, ...v }));
      const res = await api.selfReturn(co.id, { items });
      setMessage(res.complete ? 'All returned — thanks for bringing it back! 🙌' : 'Items marked returned.');
      setReturning(null);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p style={{ color: C.textSecondary }}>{error || 'Loading…'}</p>;

  const m = data.member;
  return (
    <div>
      <h1 style={S.h1}>My gear</h1>
      <p style={{ color: C.textSecondary, marginBottom: 20 }}>
        Member since {new Date(m.created_at).toLocaleDateString()} · {m.experience_level}
        {m.orientation_completed_at ? ' · orientation ✓' : ''}
      </p>
      {message && <div style={{ ...S.card, borderLeft: `4px solid ${C.green}`, marginBottom: 16 }}>{message}</div>}
      {error && <div style={{ color: C.red, marginBottom: 12 }}>{error}</div>}

      {data.active_checkouts.length === 0 && (
        <div style={{ ...S.card, textAlign: 'center', color: C.textSecondary }}>
          Nothing checked out. <a href="#/checkout" style={{ color: C.accent }}>Grab some gear →</a>
        </div>
      )}

      {data.active_checkouts.map((co) => {
        const overdue = new Date(co.due_at) < new Date();
        const out = co.items.filter((i: any) => !i.returned_at);
        return (
          <div key={co.id} style={{ ...S.card, marginBottom: 16, borderLeft: `4px solid ${overdue ? C.red : C.accent}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>Checked out {new Date(co.checked_out_at).toLocaleDateString()}</div>
                <div style={{ fontSize: 14, color: overdue ? C.red : C.textSecondary }}>
                  Due {new Date(co.due_at).toDateString()} {overdue && '— OVERDUE, please return'}
                </div>
              </div>
              {co.access_code && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Shed code</div>
                  <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.15em', color: C.accent }}>{co.access_code}</div>
                </div>
              )}
            </div>

            <ul style={{ paddingLeft: 20, fontSize: 14, marginBottom: 12 }}>
              {co.items.map((i: any) => (
                <li key={i.gear_item_id} style={{ color: i.returned_at ? C.textTertiary : C.text }}>
                  {i.gear_code} — {[i.brand, i.model].filter(Boolean).join(' ') || i.name}
                  {i.returned_at && ' (returned)'}
                </li>
              ))}
            </ul>

            {returning === co.id ? (
              <div style={{ borderTop: `1px solid ${C.divider}`, paddingTop: 12 }}>
                <h2 style={S.h2}>Condition report</h2>
                {out.map((i: any) => (
                  <div key={i.gear_item_id} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{i.gear_code} — {[i.brand, i.model].filter(Boolean).join(' ') || i.name}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {['ok', 'damaged'].map((c) => (
                        <button key={c} onClick={() => setConditions((p) => ({ ...p, [i.gear_item_id]: { ...p[i.gear_item_id], condition: c } }))} style={{
                          ...S.btnGhost, padding: '6px 14px', fontSize: 13,
                          borderColor: conditions[i.gear_item_id]?.condition === c ? C.accent : C.border,
                          background: conditions[i.gear_item_id]?.condition === c ? C.accentTint : '#fff',
                        }}>{c === 'ok' ? 'Good shape' : 'Damaged'}</button>
                      ))}
                    </div>
                    {conditions[i.gear_item_id]?.condition === 'damaged' && (
                      <input style={{ ...S.input, marginTop: 8 }} placeholder="Describe the damage (required — honesty keeps the library running)"
                        value={conditions[i.gear_item_id]?.damage_notes ?? ''}
                        onChange={(e) => setConditions((p) => ({ ...p, [i.gear_item_id]: { ...p[i.gear_item_id], damage_notes: e.target.value } }))} />
                    )}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={S.btn} disabled={busy} onClick={() => submitReturn(co)}>{busy ? 'Returning…' : 'Confirm return'}</button>
                  <button style={S.btnGhost} onClick={() => setReturning(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              out.length > 0 && <button style={S.btn} onClick={() => startReturn(co)}>Return gear</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
