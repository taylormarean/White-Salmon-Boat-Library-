// Staff dashboard — the fleet-status overview, reshaped for gear.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, S } from '../theme';
import { PageHeader, Loading } from '../components';

function Stat({ icon, label, value, color, onClick }: { icon: string; label: string; value: number | string; color?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} role="button" style={{
      ...S.card, flex: 1, minWidth: 140, cursor: 'pointer', padding: 18,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 12, flexShrink: 0, fontSize: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.035)',
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1, color: color ?? C.text }}>{value}</div>
        <div style={{ fontSize: 12.5, color: C.textSecondary, letterSpacing: '-0.01em' }}>{label}</div>
      </div>
    </div>
  );
}

export default function Dashboard({ nav }: { nav: (p: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.getDashboard().then(setD).catch((e) => setError(e.message)); }, []);

  if (error) return <p style={{ color: C.red }}>{error}</p>;
  if (!d) return <Loading label="Loading library status" />;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Library status at a glance." />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <Stat icon="🛶" label="Gear available" value={d.gear.available ?? 0} color={C.green} onClick={() => nav('inventory')} />
        <Stat icon="🌊" label="Checked out" value={d.gear.checked_out ?? 0} color={C.blue} onClick={() => nav('checkouts')} />
        <Stat icon="⏰" label="Overdue" value={d.overdue_count} color={d.overdue_count > 0 ? C.red : C.text} onClick={() => nav('checkouts')} />
        <Stat icon="🔧" label="In repair" value={d.gear.maintenance ?? 0} color={C.yellow} onClick={() => nav('inventory')} />
        <Stat icon="👥" label="Active members" value={d.members?.active ?? 0} onClick={() => nav('members')} />
        <Stat icon="📋" label="Open incidents" value={d.open_incidents} color={d.open_incidents > 0 ? C.yellow : C.text} onClick={() => nav('incidents')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div style={S.card}>
          <h2 style={S.h2}>Gear out now</h2>
          {d.active_checkouts.length === 0 && <p style={{ color: C.textSecondary, fontSize: 14 }}>Nothing checked out.</p>}
          {d.active_checkouts.slice(0, 12).map((c: any) => {
            const overdue = new Date(c.due_at) < new Date();
            return (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.divider}`, fontSize: 14 }}>
                <span>{c.member_name} <span style={{ color: C.textTertiary }}>· {c.items_out} item{c.items_out === 1 ? '' : 's'}</span></span>
                <span style={{ color: overdue ? C.red : C.textSecondary }}>
                  due {new Date(c.due_at).toLocaleDateString()}{overdue && ' ⚠'}
                </span>
              </div>
            );
          })}
        </div>

        <div style={S.card}>
          <h2 style={S.h2}>Repair queue</h2>
          {d.open_maintenance.length === 0 && <p style={{ color: C.textSecondary, fontSize: 14 }}>Nothing needs fixing. 🎉</p>}
          {d.open_maintenance.map((m: any) => (
            <div key={m.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.divider}`, fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{m.gear_code} · {m.gear_name}</strong>
                <span style={S.badge(m.severity === 'minor' ? C.yellow : C.red, m.severity === 'minor' ? C.yellowTint : C.redTint)}>{m.severity}</span>
              </div>
              <div style={{ color: C.textSecondary }}>{m.issue}</div>
            </div>
          ))}
        </div>

        <div style={S.card}>
          <h2 style={S.h2}>Upcoming shifts</h2>
          {d.upcoming_shifts.length === 0 && <p style={{ color: C.textSecondary, fontSize: 14 }}>No shifts scheduled.</p>}
          {d.upcoming_shifts.map((s: any) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.divider}`, fontSize: 14 }}>
              <span>{s.title} <span style={{ color: C.textTertiary }}>· {s.shift_date} {s.start_time}</span></span>
              <span style={{ color: s.signed_up >= s.needed ? C.green : C.yellow }}>{s.signed_up}/{s.needed}</span>
            </div>
          ))}
        </div>

        <div style={S.card}>
          <h2 style={S.h2}>Members</h2>
          <div style={{ fontSize: 14, lineHeight: 2 }}>
            <div>Total: <strong>{d.members?.total ?? 0}</strong></div>
            <div>New in last 30 days: <strong>{d.members?.new_30d ?? 0}</strong></div>
            <div>Awaiting orientation: <strong>{d.members?.pending_orientation ?? 0}</strong></div>
            <div>Suspended: <strong style={{ color: (d.members?.suspended ?? 0) > 0 ? C.red : C.text }}>{d.members?.suspended ?? 0}</strong></div>
          </div>
        </div>
      </div>
    </div>
  );
}
