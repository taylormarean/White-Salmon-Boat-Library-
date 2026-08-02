// Volunteer schedule — shifts to claim (the tour-claim flow, for volunteers).

import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, S } from '../theme';
import { Modal, type ModalConfig, PageHeader, Loading, Empty } from '../components';

const TYPE_LABEL: Record<string, string> = {
  orientation: 'New Member Orientation',
  gear_maintenance: 'Gear Repair Night',
  inventory_audit: 'Inventory Audit',
  event: 'Event',
};

const EMPTY = { shift_date: '', start_time: '17:30', end_time: '19:00', shift_type: 'orientation', title: '', notes: '', needed: 1 };

export default function Shifts({ staff }: { staff: boolean }) {
  const [shifts, setShifts] = useState<any[] | null>(null);
  const [form, setForm] = useState<any>(null);
  const [modal, setModal] = useState<ModalConfig | null>(null);
  const [error, setError] = useState('');

  const load = () => { api.getShifts().then(setShifts).catch((e) => setError(e.message)); };
  useEffect(load, []);

  const save = async () => {
    setError('');
    try {
      if (form.id) await api.updateShift(form.id, form);
      else await api.createShift({ ...form, title: form.title || TYPE_LABEL[form.shift_type] });
      setForm(null); load();
    } catch (e: any) { setError(e.message); }
  };

  const toggleSignup = async (s: any) => {
    try {
      if (s.caller_signed_up) await api.unsignupShift(s.id);
      else await api.signupShift(s.id);
      load();
    } catch (e: any) { setError(e.message); }
  };

  const cancel = (s: any) => setModal({
    title: `Cancel "${s.title}"`,
    description: `${new Date(s.shift_date + 'T00:00:00').toDateString()}, ${s.start_time}–${s.end_time}. Signed-up volunteers keep no record of a cancelled shift.`,
    confirmLabel: 'Cancel shift', danger: true,
    onConfirm: async () => { await api.cancelShift(s.id); load(); },
  });

  return (
    <div>
      <PageHeader title={staff ? 'Volunteer schedule' : 'Volunteer'}
        subtitle="The library runs on volunteers — claim a shift and help keep the gear flowing."
        actions={staff ? <button style={S.btn} onClick={() => setForm({ ...EMPTY })}>+ New shift</button> : undefined} />
      {error && <div style={{ color: C.red, marginBottom: 12 }}>{error}</div>}

      {form && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <h2 style={S.h2}>{form.id ? 'Edit shift' : 'New shift'}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
            <div><label style={S.label}>Type</label>
              <select style={S.input} value={form.shift_type} onChange={(e) => setForm({ ...form, shift_type: e.target.value })}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label style={S.label}>Date</label>
              <input style={S.input} type="date" value={form.shift_date} onChange={(e) => setForm({ ...form, shift_date: e.target.value })} /></div>
            <div><label style={S.label}>Start</label>
              <input style={S.input} type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
            <div><label style={S.label}>End</label>
              <input style={S.input} type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
            <div><label style={S.label}>Volunteers needed</label>
              <input style={S.input} type="number" min={1} value={form.needed} onChange={(e) => setForm({ ...form, needed: e.target.value })} /></div>
          </div>
          <label style={S.label}>Title</label>
          <input style={{ ...S.input, marginBottom: 8 }} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={TYPE_LABEL[form.shift_type]} />
          <label style={S.label}>Notes</label>
          <input style={{ ...S.input, marginBottom: 12 }} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.btn} onClick={save}>Save</button>
            <button style={S.btnGhost} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      {shifts === null && <Loading label="Loading shifts" />}
      {shifts?.length === 0 && <div style={S.card}><Empty icon="🗓️" title="No upcoming shifts" hint="Check back soon!" /></div>}
      {(shifts ?? []).map((s) => {
        const full = s.signed_up >= s.needed;
        return (
          <div key={s.id} style={{ ...S.card, marginBottom: 12, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{s.title}</div>
              <div style={{ fontSize: 14, color: C.textSecondary }}>
                {new Date(s.shift_date + 'T00:00:00').toDateString()} · {s.start_time}–{s.end_time}
                {s.notes && ` · ${s.notes}`}
              </div>
              {s.volunteers.length > 0 && (
                <div style={{ fontSize: 13, color: C.textTertiary, marginTop: 4 }}>
                  Signed up: {s.volunteers.map((v: any) => v.name).join(', ')}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={S.badge(full ? C.green : C.yellow, full ? C.greenTint : C.yellowTint)}>{s.signed_up}/{s.needed}</span>
              <button style={s.caller_signed_up ? S.btnGhost : S.btn} onClick={() => toggleSignup(s)}
                disabled={!s.caller_signed_up && full}>
                {s.caller_signed_up ? 'Drop shift' : full ? 'Full' : 'Claim shift'}
              </button>
              {staff && <>
                <button style={{ ...S.btnGhost, padding: '6px 12px', fontSize: 13 }} onClick={() => setForm({ ...s })}>Edit</button>
                <button style={{ ...S.btnGhost, padding: '6px 12px', fontSize: 13, color: C.red }} onClick={() => cancel(s)}>Cancel</button>
              </>}
            </div>
          </div>
        );
      })}
      <Modal config={modal} onClose={() => setModal(null)} />
    </div>
  );
}
