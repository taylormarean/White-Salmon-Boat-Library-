// Staff inventory management + repair queue (vehicles/Fleet page, adapted).

import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, S } from '../theme';
import { Modal, type ModalConfig, Segmented, PageHeader, Loading, Empty } from '../components';

const STATUS_BADGE: Record<string, [string, string]> = {
  available: [C.green, C.greenTint],
  checked_out: [C.blue, C.blueTint],
  maintenance: [C.yellow, C.yellowTint],
  retired: [C.textSecondary, 'rgba(0,0,0,0.06)'],
};

const EMPTY = { category_id: 'kayak', gear_code: '', name: '', brand: '', model: '', color: '', size: '', condition: 'good', notes: '' };

export default function Inventory() {
  const [gear, setGear] = useState<any[] | null>(null);
  const [cats, setCats] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [tab, setTab] = useState<'gear' | 'repairs'>('gear');
  const [form, setForm] = useState<any>(null);
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    api.getGear({ all: true }).then(setGear).catch((e) => setError(e.message));
    api.getCategories().then(setCats).catch(() => {});
    api.getMaintenance().then(setQueue).catch(() => {});
  };
  useEffect(load, []);

  const save = async () => {
    setError('');
    try {
      if (form.id) await api.updateGear(form.id, form);
      else await api.createGear(form);
      setForm(null); load();
    } catch (e: any) { setError(e.message); }
  };

  const pullFromService = (g: any) => setModal({
    title: `Pull ${g.gear_code} from circulation`,
    description: 'The item moves to maintenance status and disappears from the member checkout list.',
    fields: [{ key: 'reason', label: 'Reason', type: 'textarea', required: true, placeholder: 'e.g. crack in the hull near the seat' }],
    confirmLabel: 'Pull from circulation', danger: true,
    onConfirm: async (v) => { await api.setGearStatus(g.id, 'maintenance', v.reason); load(); },
  });

  const restore = (g: any) => setModal({
    title: `Return ${g.gear_code} to circulation`,
    description: 'The item becomes available for member checkout again.',
    confirmLabel: 'Make available',
    onConfirm: async () => { await api.setGearStatus(g.id, 'available'); load(); },
  });

  const logIssue = (g: any) => setModal({
    title: `Log an issue — ${g.gear_code}`,
    fields: [
      { key: 'issue', label: 'What\'s wrong?', type: 'textarea', required: true },
      { key: 'severity', label: 'Severity', type: 'select', options: [
        { value: 'minor', label: 'Minor — stays in circulation' },
        { value: 'major', label: 'Major — pull from circulation' },
        { value: 'unusable', label: 'Unusable — pull from circulation' },
      ] },
    ],
    confirmLabel: 'Log issue',
    onConfirm: async (v) => { await api.createMaintenance(g.id, v); load(); },
  });

  const resolveIssue = (m: any) => setModal({
    title: `Resolve — ${m.gear_code}`,
    description: m.issue,
    fields: [{ key: 'resolution_notes', label: 'What was done?', type: 'textarea', placeholder: 'e.g. welded, strap replaced, retired the part' }],
    confirmLabel: 'Mark resolved',
    onConfirm: async (v) => {
      await api.updateMaintenance(m.id, { status: 'resolved', resolution_notes: v.resolution_notes, return_to_service: true });
      load();
    },
  });

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Every item in the shed, and what shape it's in."
        actions={<>
          <Segmented tabs={[{ key: 'gear', label: `Gear${gear ? ` · ${gear.length}` : ''}` }, { key: 'repairs', label: `Repairs · ${queue.filter((q) => q.status !== 'resolved').length}` }]}
            value={tab} onChange={setTab} />
          {tab === 'gear' && <button style={S.btn} onClick={() => setForm({ ...EMPTY })}>+ Add gear</button>}
        </>} />
      {error && <div style={{ color: C.red, marginBottom: 12 }}>{error}</div>}

      {form && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <h2 style={S.h2}>{form.id ? `Edit ${form.gear_code}` : 'New gear item'}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
            <div><label style={S.label}>Category</label>
              <select style={S.input} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div><label style={S.label}>Gear code (on the item)</label>
              <input style={S.input} value={form.gear_code} onChange={(e) => setForm({ ...form, gear_code: e.target.value })} placeholder="K-04" /></div>
            <div><label style={S.label}>Name</label>
              <input style={S.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Creek Boat" /></div>
            <div><label style={S.label}>Brand</label>
              <input style={S.input} value={form.brand ?? ''} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></div>
            <div><label style={S.label}>Model</label>
              <input style={S.input} value={form.model ?? ''} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
            <div><label style={S.label}>Color</label>
              <input style={S.input} value={form.color ?? ''} onChange={(e) => setForm({ ...form, color: e.target.value })} /></div>
            <div><label style={S.label}>Size</label>
              <input style={S.input} value={form.size ?? ''} onChange={(e) => setForm({ ...form, size: e.target.value })} /></div>
            <div><label style={S.label}>Condition</label>
              <select style={S.input} value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                {['excellent', 'good', 'fair', 'poor'].map((c) => <option key={c}>{c}</option>)}
              </select></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.btn} onClick={save}>Save</button>
            <button style={S.btnGhost} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      {tab === 'gear' && (
        gear === null ? <Loading label="Loading inventory" /> :
        <div style={{ ...S.card, ...S.tableWrap, padding: 0, overflow: 'hidden' }}>
          <div style={S.tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                {['Code', 'Item', 'Category', 'Condition', 'Status', ''].map((h) => <th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {gear.map((g) => {
                  const [color, tint] = STATUS_BADGE[g.status] ?? STATUS_BADGE.available;
                  return (
                    <tr key={g.id}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{g.gear_code}</td>
                      <td style={S.td}>
                        {[g.brand, g.model].filter(Boolean).join(' ') || g.name}
                        <div style={{ color: C.textTertiary, fontSize: 12 }}>{[g.color, g.size].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td style={S.td}>{g.category_name}</td>
                      <td style={S.td}>{g.condition}</td>
                      <td style={S.td}>
                        <span style={S.badge(color, tint)}>{g.status.replace('_', ' ')}</span>
                        {g.oos_reason && <div style={{ color: C.textTertiary, fontSize: 12, marginTop: 4 }}>{g.oos_reason}</div>}
                        {g.due_back_at && g.status === 'checked_out' && <div style={{ color: C.textTertiary, fontSize: 12, marginTop: 4 }}>due {new Date(g.due_back_at).toLocaleDateString()}</div>}
                      </td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                        <button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 12, marginRight: 6 }} onClick={() => setForm({ ...g })}>Edit</button>
                        {g.status === 'available' && <>
                          <button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 12, marginRight: 6 }} onClick={() => logIssue(g)}>Log issue</button>
                          <button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 12 }} onClick={() => pullFromService(g)}>Pull</button>
                        </>}
                        {g.status === 'maintenance' && <button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 12 }} onClick={() => restore(g)}>Restore</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {gear.length === 0 && <Empty icon="🚣" title="No gear yet" hint="Add your first item with + Add gear." />}
        </div>
      )}

      {tab === 'repairs' && (
        <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
          <div style={S.tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Gear', 'Issue', 'Severity', 'Source', 'Status', 'Reported', ''].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {queue.map((m) => (
                  <tr key={m.id}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{m.gear_code}<div style={{ fontWeight: 400, color: C.textTertiary, fontSize: 12 }}>{m.gear_name}</div></td>
                    <td style={S.td}>{m.issue}{m.resolution_notes && <div style={{ color: C.textTertiary, fontSize: 12 }}>fix: {m.resolution_notes}</div>}</td>
                    <td style={S.td}><span style={S.badge(m.severity === 'minor' ? C.yellow : C.red, m.severity === 'minor' ? C.yellowTint : C.redTint)}>{m.severity}</span></td>
                    <td style={S.td}>{m.source}</td>
                    <td style={S.td}>{m.status}</td>
                    <td style={S.td}>{new Date(m.created_at + 'Z').toLocaleDateString()}</td>
                    <td style={S.td}>
                      {m.status !== 'resolved' && <button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 12 }} onClick={() => resolveIssue(m)}>Resolve</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {queue.length === 0 && <Empty icon="🔧" title="Repair queue is empty" hint="Damage reported on returns lands here automatically." />}
        </div>
      )}

      <Modal config={modal} onClose={() => setModal(null)} />
    </div>
  );
}
