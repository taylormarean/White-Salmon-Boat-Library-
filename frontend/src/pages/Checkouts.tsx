// Staff checkout board: active / overdue / history, extend, force-return,
// today's door code, and the access-code audit log.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, S } from '../theme';

export default function Checkouts() {
  const [tab, setTab] = useState<'active' | 'overdue' | 'returned' | 'codes'>('active');
  const [rows, setRows] = useState<any[]>([]);
  const [codeLog, setCodeLog] = useState<any[]>([]);
  const [doorCode, setDoorCode] = useState<any>(null);
  const [error, setError] = useState('');

  const load = () => {
    if (tab === 'codes') api.getAccessCodeLog().then(setCodeLog).catch((e) => setError(e.message));
    else api.getCheckouts(tab).then(setRows).catch((e) => setError(e.message));
    api.getTodayDoorCode().then(setDoorCode).catch(() => {});
  };
  useEffect(load, [tab]);

  const extend = async (c: any) => {
    const current = new Date(c.due_at).toISOString().slice(0, 10);
    const date = prompt(`New due date for ${c.member_name} (YYYY-MM-DD):`, current);
    if (!date) return;
    try { await api.extendCheckout(c.id, new Date(`${date}T20:00:00`).toISOString()); load(); } catch (e: any) { setError(e.message); }
  };

  const forceReturn = async (c: any) => {
    if (!confirm(`Close out ${c.member_name}'s checkout? Use this when gear is physically back but wasn't marked returned (or is lost).`)) return;
    const notes = prompt('Notes (what happened)?') ?? '';
    const inspect = confirm('Send the items to the repair queue for inspection? (Cancel = mark available)');
    try { await api.forceReturn(c.id, { notes, mark_items: inspect ? 'maintenance' : 'available' }); load(); } catch (e: any) { setError(e.message); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h1 style={S.h1}>Checkouts</h1>
        {doorCode && doorCode.mode === 'daily' && (
          <div style={{ ...S.card, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: C.textSecondary }}>Today's door code ({doorCode.date}):</span>
            <strong style={{ fontSize: 18, letterSpacing: '0.15em', color: C.accent }}>{doorCode.code}</strong>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['active', 'overdue', 'returned', 'codes'] as const).map((t) => (
          <button key={t} style={tab === t ? S.btn : S.btnGhost} onClick={() => setTab(t)}>
            {t === 'codes' ? 'Code log' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {error && <div style={{ color: C.red, marginBottom: 12 }}>{error}</div>}

      {tab === 'codes' ? (
        <div style={{ ...S.card, ...S.tableWrap, padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Issued', 'Member', 'Code', 'Mode', 'Checkout'].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {codeLog.map((r) => (
                <tr key={r.id}>
                  <td style={S.td}>{new Date(r.issued_at + 'Z').toLocaleString()}</td>
                  <td style={S.td}>{r.member_name ?? r.member_id}</td>
                  <td style={{ ...S.td, fontWeight: 700, letterSpacing: '0.1em' }}>{r.code}</td>
                  <td style={S.td}>{r.mode}</td>
                  <td style={{ ...S.td, color: C.textTertiary, fontSize: 12 }}>{r.checkout_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ ...S.card, ...S.tableWrap, padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Member', 'Gear', 'Out', 'Due', 'Safety', ''].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((c) => {
                const overdue = c.status === 'active' && new Date(c.due_at) < new Date();
                return (
                  <tr key={c.id}>
                    <td style={S.td}>
                      <strong>{c.member_name}</strong>
                      <div style={{ color: C.textTertiary, fontSize: 12 }}>{c.member_email} · {c.experience_level}</div>
                    </td>
                    <td style={S.td}>
                      {c.items.map((i: any) => (
                        <div key={i.gear_item_id} style={{ fontSize: 13 }}>
                          {i.gear_code} {i.returned_at ? '✓' : ''}
                          {i.condition_on_return === 'damaged' && <span style={{ color: C.red }}> ⚠ {i.damage_notes}</span>}
                        </div>
                      ))}
                      {c.buddy_name && <div style={{ color: C.textTertiary, fontSize: 12 }}>buddy: {c.buddy_name}</div>}
                      {c.planned_river_section && <div style={{ color: C.textTertiary, fontSize: 12 }}>river: {c.planned_river_section}</div>}
                    </td>
                    <td style={S.td}>{new Date(c.checked_out_at + (c.checked_out_at.endsWith('Z') ? '' : 'Z')).toLocaleDateString()}</td>
                    <td style={{ ...S.td, color: overdue ? C.red : C.text }}>
                      {new Date(c.due_at).toLocaleDateString()}{overdue && ' ⚠'}
                      {c.returned_at && <div style={{ color: C.textTertiary, fontSize: 12 }}>returned {new Date(c.returned_at + 'Z').toLocaleDateString()}</div>}
                    </td>
                    <td style={{ ...S.td, fontSize: 12, color: C.textSecondary }}>
                      {c.ack_sober && c.ack_pfd && c.ack_experience && c.ack_condition ? '✓ all acks' : '✗ incomplete'}
                    </td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                      {c.status === 'active' && <>
                        <button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 12, marginRight: 6 }} onClick={() => extend(c)}>Extend</button>
                        <button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 12 }} onClick={() => forceReturn(c)}>Force return</button>
                      </>}
                      {c.force_returned_by && <div style={{ color: C.textTertiary, fontSize: 11 }}>closed by {c.force_returned_by}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p style={{ padding: 20, color: C.textSecondary, fontSize: 14 }}>Nothing here.</p>}
        </div>
      )}
    </div>
  );
}
