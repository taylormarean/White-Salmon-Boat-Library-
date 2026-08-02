// Staff member roster — the driver roster, adapted: waiver/orientation/checkout status.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, S } from '../theme';
import { Modal, type ModalConfig, PageHeader, Loading, Empty } from '../components';

export default function Members() {
  const [members, setMembers] = useState<any[] | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const load = () => { api.getMembers().then(setMembers).catch((e) => setError(e.message)); };
  useEffect(load, []);

  const open = (id: string) => api.getMember(id).then(setDetail).catch((e) => setError(e.message));

  const suspend = (m: any) => setModal({
    title: `Suspend ${m.name}`,
    description: 'Suspended members cannot check out gear until reinstated.',
    fields: [{ key: 'reason', label: 'Reason', type: 'textarea', required: true }],
    confirmLabel: 'Suspend', danger: true,
    onConfirm: async (v) => { await api.setMemberStatus(m.id, 'suspended', v.reason); setDetail(null); load(); },
  });

  const reinstate = (m: any) => setModal({
    title: `Reinstate ${m.name}`,
    description: 'Membership returns to active and self-serve checkout works again.',
    confirmLabel: 'Reinstate',
    onConfirm: async () => { await api.setMemberStatus(m.id, 'active'); setDetail(null); load(); },
  });

  const terminate = (m: any) => setModal({
    title: `Terminate ${m.name}'s membership`,
    description: 'This also disables their login. Reserved for policy violations (drugs/alcohol with gear, harassment, unreturned equipment).',
    fields: [{ key: 'reason', label: 'Reason', type: 'textarea', required: true }],
    confirmLabel: 'Terminate membership', danger: true,
    onConfirm: async (v) => { await api.setMemberStatus(m.id, 'terminated', v.reason); setDetail(null); load(); },
  });

  const toggleOrientation = async (m: any) => {
    try { await api.updateMember(m.id, { orientation_completed: !m.orientation_completed_at }); open(m.id); load(); } catch (e: any) { setError(e.message); }
  };

  if (detail) {
    const m = detail.member;
    return (
      <div>
        <button style={{ ...S.btnGhost, marginBottom: 16 }} onClick={() => setDetail(null)}>← All members</button>
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={S.h1}>{m.name}</h1>
              <p style={{ color: C.textSecondary, fontSize: 14 }}>
                {m.email}{m.phone && ` · ${m.phone}`} · {m.experience_level} · joined {new Date(m.created_at).toLocaleDateString()}
              </p>
              <p style={{ fontSize: 14, marginTop: 10, lineHeight: 1.7 }}>
                Waiver: {m.waiver_signed_at ? `✓ v${m.waiver_version} (${new Date(m.waiver_signed_at).toLocaleDateString()}, signed "${m.waiver_signature}")` : '✗ not on file'}<br />
                Orientation: {m.orientation_completed_at ? `✓ ${new Date(m.orientation_completed_at).toLocaleDateString()}` : '✗ not yet'}<br />
                Emergency contact: {m.emergency_contact_name} ({m.emergency_contact_phone})
              </p>
              {m.status !== 'active' && <p style={{ color: C.red, marginTop: 8 }}>Status: {m.status}{m.suspension_reason && ` — ${m.suspension_reason}`}</p>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button style={S.btnGhost} onClick={() => toggleOrientation(m)}>
                {m.orientation_completed_at ? 'Un-mark orientation' : 'Mark orientation done'}
              </button>
              {m.status === 'active'
                ? <button style={{ ...S.btnGhost, color: C.yellow }} onClick={() => suspend(m)}>Suspend</button>
                : <button style={{ ...S.btnGhost, color: C.green }} onClick={() => reinstate(m)}>Reinstate</button>}
              {m.status !== 'terminated' && <button style={{ ...S.btnGhost, color: C.red }} onClick={() => terminate(m)}>Terminate</button>}
            </div>
          </div>
        </div>

        <div style={{ ...S.card, marginBottom: 16 }}>
          <h2 style={S.h2}>Checkout history</h2>
          {detail.checkouts.length === 0 && <Empty icon="📦" title="No checkouts yet" />}
          {detail.checkouts.map((c: any) => (
            <div key={c.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.divider}`, fontSize: 14, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span>{JSON.parse(c.gear_codes ?? '[]').join(', ') || '(no items)'}</span>
              <span style={{ color: C.textSecondary }}>
                {new Date(c.checked_out_at + 'Z').toLocaleDateString()} → {c.returned_at ? new Date(c.returned_at + 'Z').toLocaleDateString() : `due ${new Date(c.due_at).toLocaleDateString()}`}
                {' '}· {c.status}
              </span>
            </div>
          ))}
        </div>

        {detail.incidents.length > 0 && (
          <div style={S.card}>
            <h2 style={S.h2}>Incidents</h2>
            {detail.incidents.map((i: any) => (
              <div key={i.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.divider}`, fontSize: 14 }}>
                <strong>{i.type}</strong> · {i.status} — {i.description}
              </div>
            ))}
          </div>
        )}
        <Modal config={modal} onClose={() => setModal(null)} />
      </div>
    );
  }

  const shown = (members ?? []).filter((m) => !filter || m.name.toLowerCase().includes(filter.toLowerCase()) || m.email.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <PageHeader title={`Members${members ? ` · ${members.length}` : ''}`} subtitle="Waivers, orientation, and who has gear out."
        actions={<input style={{ ...S.input, width: 240 }} placeholder="Search name or email…" value={filter} onChange={(e) => setFilter(e.target.value)} />} />
      {error && <div style={{ color: C.red, marginBottom: 12 }}>{error}</div>}
      {members === null ? <Loading label="Loading members" /> : (
        <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
          <div style={S.tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Name', 'Experience', 'Waiver', 'Orientation', 'Out now', 'Status'].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.id} onClick={() => open(m.id)} style={{ cursor: 'pointer' }}>
                    <td style={S.td}><strong>{m.name}</strong><div style={{ color: C.textTertiary, fontSize: 12 }}>{m.email}</div></td>
                    <td style={S.td}>{m.experience_level}</td>
                    <td style={S.td}>{m.waiver_signed_at ? '✓' : <span style={{ color: C.red }}>✗</span>}</td>
                    <td style={S.td}>{m.orientation_completed_at ? '✓' : '—'}</td>
                    <td style={S.td}>
                      {m.active_checkouts > 0 ? `${m.active_checkouts}` : '—'}
                      {m.overdue_checkouts > 0 && <span style={{ color: C.red }}> ({m.overdue_checkouts} overdue)</span>}
                    </td>
                    <td style={S.td}>
                      <span style={S.badge(
                        m.status === 'active' ? C.green : m.status === 'suspended' ? C.yellow : C.red,
                        m.status === 'active' ? C.greenTint : m.status === 'suspended' ? C.yellowTint : C.redTint,
                      )}>{m.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length === 0 && <Empty icon="👋" title={filter ? 'No matches' : 'No members yet'} hint={filter ? 'Try a different search.' : 'Members appear here as they join online.'} />}
        </div>
      )}
      <Modal config={modal} onClose={() => setModal(null)} />
    </div>
  );
}
