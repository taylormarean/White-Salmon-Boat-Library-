// Incident log — injuries, near-misses, gear damage, policy violations.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, S } from '../theme';
import { PageHeader, Empty } from '../components';

const TYPES = ['injury', 'near_miss', 'gear_damage', 'policy_violation', 'other'];
const EMPTY = { type: 'other', description: '', occurred_at: '', member_id: '' };

export default function Incidents() {
  const [rows, setRows] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null);
  const [error, setError] = useState('');

  const load = () => {
    api.getIncidents().then(setRows).catch((e) => setError(e.message));
    api.getMembers().then(setMembers).catch(() => {});
  };
  useEffect(load, []);

  const save = async () => {
    setError('');
    try {
      if (form.id) await api.updateIncident(form.id, form);
      else await api.createIncident({ ...form, member_id: form.member_id || null });
      setForm(null); load();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div>
      <PageHeader title="Incidents" subtitle="Injuries, near-misses, gear damage, and policy violations."
        actions={<button style={S.btn} onClick={() => setForm({ ...EMPTY })}>+ Report incident</button>} />
      {error && <div style={{ color: C.red, marginBottom: 12 }}>{error}</div>}

      {form && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <h2 style={S.h2}>{form.id ? 'Update incident' : 'New incident'}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
            <div><label style={S.label}>Type</label>
              <select style={S.input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select></div>
            <div><label style={S.label}>Member (optional)</label>
              <select style={S.input} value={form.member_id ?? ''} onChange={(e) => setForm({ ...form, member_id: e.target.value })}>
                <option value="">—</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select></div>
            <div><label style={S.label}>When</label>
              <input style={S.input} type="date" value={form.occurred_at ?? ''} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} /></div>
            {form.id && <div><label style={S.label}>Status</label>
              <select style={S.input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {['open', 'investigating', 'resolved'].map((s) => <option key={s}>{s}</option>)}
              </select></div>}
          </div>
          <label style={S.label}>What happened?</label>
          <textarea style={{ ...S.input, minHeight: 80, marginBottom: 8 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          {form.id && <>
            <label style={S.label}>Follow-up</label>
            <textarea style={{ ...S.input, minHeight: 60, marginBottom: 8 }} value={form.follow_up ?? ''} onChange={(e) => setForm({ ...form, follow_up: e.target.value })} />
          </>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.btn} onClick={save}>Save</button>
            <button style={S.btnGhost} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ ...S.card, ...S.tableWrap, padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Type', 'Member', 'Description', 'Status', 'Reported', ''].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td style={S.td}><span style={S.badge(
                  i.type === 'injury' ? C.red : i.type === 'policy_violation' ? C.yellow : C.blue,
                  i.type === 'injury' ? C.redTint : i.type === 'policy_violation' ? C.yellowTint : C.blueTint,
                )}>{i.type.replace('_', ' ')}</span></td>
                <td style={S.td}>{i.member_name ?? '—'}</td>
                <td style={S.td}>{i.description}{i.follow_up && <div style={{ color: C.textTertiary, fontSize: 12 }}>follow-up: {i.follow_up}</div>}</td>
                <td style={S.td}>{i.status}</td>
                <td style={S.td}>{new Date(i.created_at + 'Z').toLocaleDateString()}<div style={{ color: C.textTertiary, fontSize: 12 }}>{i.reported_by}</div></td>
                <td style={S.td}><button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 12 }} onClick={() => setForm({ ...i })}>Update</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty icon="🤞" title="No incidents reported" hint="Long may it last." />}
      </div>
    </div>
  );
}
