// Admin · Settings — runtime toggles (the fleet-app settings registry, adapted),
// including the notifications kill switch and the door-code mode.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, S } from '../theme';
import { PageHeader } from '../components';

const FIELDS: { key: string; label: string; help?: string; type?: 'select' | 'toggle'; options?: string[] }[] = [
  { key: 'app_name', label: 'Library name' },
  { key: 'library_address', label: 'Shed address' },
  { key: 'standard_loan_days', label: 'Standard rental period (days)', help: 'WSBL policy: 3 days. Longer rentals require a trip note at checkout.' },
  { key: 'max_loan_days', label: 'Maximum rental (days)', help: 'WSBL policy: 9 days (three rental periods), reserved for multi-day runs and out-of-town trips.' },
  { key: 'max_items_per_checkout', label: 'Max items per checkout' },
  { key: 'door_code_mode', label: 'Door code mode', type: 'select', options: ['per_checkout', 'daily'], help: 'per_checkout: each checkout gets a random code you keep synced to a lockbox rotation. daily: one deterministic code per day (program the smart lock from the code shown on the Checkouts page).' },
  { key: 'orientation_info', label: 'Orientation info (shown to new members)' },
  { key: 'staff_digest_email', label: 'Staff digest email', help: 'Receives 7-day-overdue escalations. Leave blank to disable.' },
  { key: 'waiver_version', label: 'Waiver version', help: 'Bump this to force every member to re-sign the waiver at their next checkout.' },
];

export default function Settings() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.getSettings().then(setValues).catch((e) => setError(e.message)); }, []);

  const save = async () => {
    setError(''); setSaved(false);
    try {
      const editable: Record<string, string> = {};
      for (const f of FIELDS) if (values[f.key] !== undefined) editable[f.key] = values[f.key];
      editable.notifications_paused = values.notifications_paused ?? '0';
      editable.notifications_pause_reason = values.notifications_pause_reason ?? '';
      await api.updateSettings(editable);
      setSaved(true);
    } catch (e: any) { setError(e.message); }
  };

  const paused = values.notifications_paused === '1';

  return (
    <div style={{ maxWidth: 640 }}>
      <PageHeader title="Settings" subtitle="Runtime configuration — changes apply immediately." />

      <div style={{ ...S.card, marginBottom: 16, borderLeft: `4px solid ${paused ? C.red : C.green}` }}>
        <h2 style={S.h2}>Notifications kill switch</h2>
        <p style={{ fontSize: 14, color: C.textSecondary, marginBottom: 12 }}>
          {paused ? 'ALL outbound email is paused — including checkout confirmations and overdue reminders.' : 'Outbound email is flowing normally.'}
        </p>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, marginBottom: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={paused} onChange={(e) => setValues((v) => ({ ...v, notifications_paused: e.target.checked ? '1' : '0' }))} />
          Pause all outbound notifications
        </label>
        {paused && (
          <input style={S.input} placeholder="Reason (shown in the log)" value={values.notifications_pause_reason ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, notifications_pause_reason: e.target.value }))} />
        )}
      </div>

      <div style={{ ...S.card, marginBottom: 16 }}>
        {FIELDS.map((f) => (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <label style={S.label}>{f.label}</label>
            {f.type === 'select' ? (
              <select style={S.input} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
                {f.options!.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : (
              <input style={S.input} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
            )}
            {f.help && <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 4 }}>{f.help}</div>}
          </div>
        ))}
      </div>

      {error && <div style={{ color: C.red, marginBottom: 12 }}>{error}</div>}
      {saved && <div style={{ color: C.green, marginBottom: 12 }}>Saved ✓</div>}
      <button style={S.btn} onClick={save}>Save settings</button>
    </div>
  );
}
