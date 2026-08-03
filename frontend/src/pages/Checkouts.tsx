// Staff checkout board: active / overdue / history, extend, force-return,
// today's door code, and the access-code audit log.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, S } from '../theme';
import { Modal, type ModalConfig, Segmented, PageHeader, Loading, Empty } from '../components';

export default function Checkouts() {
  const [tab, setTab] = useState<'active' | 'overdue' | 'returned' | 'codes'>('active');
  const [rows, setRows] = useState<any[] | null>(null);
  const [codeLog, setCodeLog] = useState<any[]>([]);
  const [doorCode, setDoorCode] = useState<any>(null);
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    if (tab === 'codes') api.getAccessCodeLog().then(setCodeLog).catch((e) => setError(e.message));
    else { setRows(null); api.getCheckouts(tab).then(setRows).catch((e) => setError(e.message)); }
    api.getTodayDoorCode().then(setDoorCode).catch(() => {});
  };
  useEffect(load, [tab]);

  const extend = (c: any) => setModal({
    title: `Extend ${c.member_name}'s loan`,
    description: 'Overdue reminders re-arm for the new date.',
    fields: [{ key: 'due', label: 'New due date', type: 'date', required: true, initial: new Date(c.due_at).toISOString().slice(0, 10) }],
    confirmLabel: 'Extend',
    onConfirm: async (v) => { await api.extendCheckout(c.id, new Date(`${v.due}T20:00:00`).toISOString()); load(); },
  });

  const forceReturn = (c: any) => setModal({
    title: `Close out ${c.member_name}'s checkout`,
    description: 'Use this when gear is physically back but was never marked returned — or is lost.',
    fields: [
      { key: 'notes', label: 'What happened?', type: 'textarea', required: true },
      { key: 'mark_items', label: 'Where do the items go?', type: 'select', options: [
        { value: 'available', label: 'Back to circulation' },
        { value: 'maintenance', label: 'Repair queue for inspection' },
      ] },
    ],
    confirmLabel: 'Force return', danger: true,
    onConfirm: async (v) => { await api.forceReturn(c.id, v); load(); },
  });

  return (
    <div>
      <PageHeader title="Checkouts" subtitle="The digital checkout board — who has what, and when it's due."
        actions={doorCode && doorCode.mode === 'daily' ? (
          <div style={{ ...S.card, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: C.textSecondary }}>Today's door code</span>
            <strong style={{ fontSize: 18, letterSpacing: '0.15em', color: C.accent }}>{doorCode.code}</strong>
          </div>
        ) : undefined} />
      <div style={{ marginBottom: 16 }}>
        <Segmented
          tabs={[
            { key: 'active', label: 'Active' }, { key: 'overdue', label: 'Overdue' },
            { key: 'returned', label: 'Returned' }, { key: 'codes', label: 'Code log' },
          ]}
          value={tab} onChange={setTab} />
      </div>
      {error && <div style={{ color: C.red, marginBottom: 12 }}>{error}</div>}

      {tab === 'codes' ? (
        <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
          <div style={S.tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Issued', 'Member', 'Code', 'Mode', 'Checkout'].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {codeLog.map((r) => (
                  <tr key={r.id}>
                    <td style={S.td}>{new Date(r.issued_at + 'Z').toLocaleString()}</td>
                    <td style={S.td}>{r.member_name ?? r.member_id}</td>
                    <td style={{ ...S.td, fontWeight: 700, letterSpacing: '0.1em', color: C.accent }}>{r.code}</td>
                    <td style={S.td}>{r.mode.replace('_', ' ')}</td>
                    <td style={{ ...S.td, color: C.textTertiary, fontSize: 12 }}>{r.checkout_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {codeLog.length === 0 && <Empty icon="🔑" title="No codes issued yet" />}
        </div>
      ) : rows === null ? <Loading label="Loading checkouts" /> : (
        <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
          <div style={S.tableWrap}>
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
                        {c.trip_note && <div style={{ color: C.yellow, fontSize: 12 }}>trip: {c.trip_note}</div>}
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
          </div>
          {rows.length === 0 && <Empty icon={tab === 'overdue' ? '🎉' : '🌊'} title={tab === 'overdue' ? 'Nothing overdue' : 'Nothing here'} />}
        </div>
      )}

      <Modal config={modal} onClose={() => setModal(null)} />
    </div>
  );
}
