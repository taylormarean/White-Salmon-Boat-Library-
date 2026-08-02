// Staff inventory management + repair queue (vehicles/Fleet page, adapted).

import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, S } from '../theme';

const STATUS_BADGE: Record<string, [string, string]> = {
  available: [C.green, C.greenTint],
  checked_out: [C.blue, C.blueTint],
  maintenance: [C.yellow, C.yellowTint],
  retired: [C.textSecondary, 'rgba(0,0,0,0.06)'],
};

const EMPTY = { category_id: 'kayak', gear_code: '', name: '', brand: '', model: '', color: '', size: '', condition: 'good', notes: '' };

export default function Inventory() {
  const [gear, setGear] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [tab, setTab] = useState<'gear' | 'repairs'>('gear');
  const [form, setForm] = useState<any>(null); // null = closed, {} = new, {id} = edit
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

  const setStatus = async (g: any, status: string) => {
    const reason = status === 'available' ? undefined : (prompt(`Reason for marking ${g.gear_code} ${status}?`) ?? undefined);
    if (status !== 'available' && !reason) return;
    try { await api.setGearStatus(g.id, status, reason); load(); } catch (e: any) { setError(e.message); }
  };

  const logIssue = async (g: any) => {
    const issue = prompt(`Describe the issue with ${g.gear_code}:`);
    if (!issue) return;
    const severity = prompt('Severity: minor, major, or unusable?', 'minor') ?? 'minor';
    try { await api.createMaintenance(g.id, { issue, severity }); load(); } catch (e: any) { setError(e.message); }
  };

  const resolveIssue = async (m: any) => {
    const notes = prompt('Resolution notes?') ?? '';
    try { await api.updateMaintenance(m.id, { status: 'resolved', resolution_notes: notes, return_to_service: true }); load(); } catch (e: any) { setError(e.message); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h1 style={S.h1}>Inventory</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={tab === 'gear' ? S.btn : S.btnGhost} onClick={() => setTab('gear')}>Gear ({gear.length})</button>
          <button style={tab === 'repairs' ? S.btn : S.btnGhost} onClick={() => setTab('repairs')}>
            Repairs ({queue.filter((q) => q.status !== 'resolved').length})
          </button>
          {tab === 'gear' && <button style={S.btn} onClick={() => setForm({ ...EMPTY })}>+ Add gear</button>}
        </div>
      </div>
      {error && <div style={{ color: C.red, marginBottom: 12 }}>{error}</div>}

      {form && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <h2 style={S.h2}>{form.id ? `Edit ${form.gear_code}` : 'New gear item'}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
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
        <div style={{ ...S.card, ...S.tableWrap, padding: 0 }}>
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
                      <span style={S.badge(color, tint)}>{g.status}</span>
                      {g.oos_reason && <div style={{ color: C.textTertiary, fontSize: 12 }}>{g.oos_reason}</div>}
                      {g.due_back_at && g.status === 'checked_out' && <div style={{ color: C.textTertiary, fontSize: 12 }}>due {new Date(g.due_back_at).toLocaleDateString()}</div>}
                    </td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                      <button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 12, marginRight: 6 }} onClick={() => setForm({ ...g })}>Edit</button>
                      {g.status === 'available' && <>
                        <button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 12, marginRight: 6 }} onClick={() => logIssue(g)}>Log issue</button>
                        <button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 12 }} onClick={() => setStatus(g, 'maintenance')}>Pull</button>
                      </>}
                      {g.status === 'maintenance' && <button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 12 }} onClick={() => setStatus(g, 'available')}>Restore</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'repairs' && (
        <div style={{ ...S.card, ...S.tableWrap, padding: 0 }}>
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
                  <td style={S.td}>{new Date(m.created_at).toLocaleDateString()}</td>
                  <td style={S.td}>
                    {m.status !== 'resolved' && <button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 12 }} onClick={() => resolveIssue(m)}>Resolve</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
