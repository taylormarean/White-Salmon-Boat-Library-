// Staff calendar — month grid of everything time-bound in the library:
// volunteer shifts, gear due back, and overdue checkouts.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { C, S } from '../theme';
import { PageHeader, Loading } from '../components';

interface CalEvent {
  date: string;               // YYYY-MM-DD
  kind: 'shift' | 'due' | 'overdue';
  label: string;
  detail?: string;
}

const KIND_STYLE: Record<CalEvent['kind'], { color: string; tint: string; icon: string }> = {
  shift: { color: C.accent, tint: C.accentTint, icon: '👥' },
  due: { color: C.blue, tint: C.blueTint, icon: '↩' },
  overdue: { color: C.red, tint: C.redTint, icon: '⚠' },
};

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function Calendar() {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getShifts(true), api.getCheckouts('active')])
      .then(([shifts, checkouts]) => {
        const evts: CalEvent[] = [];
        for (const s of shifts) {
          evts.push({
            date: s.shift_date, kind: 'shift',
            label: `${s.start_time} ${s.title}`,
            detail: `${s.signed_up}/${s.needed} volunteers${s.volunteers?.length ? ` — ${s.volunteers.map((v: any) => v.name).join(', ')}` : ''}`,
          });
        }
        const today = new Date(); today.setHours(0, 0, 0, 0);
        for (const c of checkouts) {
          const due = new Date(c.due_at);
          const overdue = due < today;
          const items = (c.items ?? []).filter((i: any) => !i.returned_at).map((i: any) => i.gear_code).join(', ');
          evts.push({
            date: ymd(due), kind: overdue ? 'overdue' : 'due',
            label: `${c.member_name}${overdue ? ' (overdue)' : ''}`,
            detail: items ? `Due back: ${items}` : 'Due back',
          });
        }
        setEvents(evts);
      })
      .catch((e) => setError(e.message));
  }, []);

  const byDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events ?? []) {
      if (!m.has(e.date)) m.set(e.date, []);
      m.get(e.date)!.push(e);
    }
    return m;
  }, [events]);

  const grid = useMemo(() => {
    const first = new Date(month);
    const start = new Date(first);
    start.setDate(1 - first.getDay()); // back to Sunday
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
    }
    return cells;
  }, [month]);

  const todayStr = ymd(new Date());
  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shift = (delta: number) => {
    const d = new Date(month); d.setMonth(d.getMonth() + delta); setMonth(d); setSelected(null);
  };

  if (error) return <p style={{ color: C.red }}>{error}</p>;
  if (events === null) return <Loading label="Loading calendar" />;

  const selectedEvents = selected ? (byDate.get(selected) ?? []) : [];

  return (
    <div>
      <PageHeader title="Calendar" subtitle="Shifts, due returns, and overdues — the library's month at a glance."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button style={{ ...S.btnGhost, padding: '7px 14px' }} onClick={() => shift(-1)}>←</button>
            <strong style={{ fontSize: 16, minWidth: 150, textAlign: 'center' }}>{monthLabel}</strong>
            <button style={{ ...S.btnGhost, padding: '7px 14px' }} onClick={() => shift(1)}>→</button>
            <button style={{ ...S.btnGhost, padding: '7px 14px' }} onClick={() => { const d = new Date(); d.setDate(1); setMonth(d); }}>Today</button>
          </div>
        } />

      <div style={{ display: 'flex', gap: 14, marginBottom: 14, fontSize: 13, color: C.textSecondary, flexWrap: 'wrap' }}>
        {(Object.entries(KIND_STYLE) as [CalEvent['kind'], typeof KIND_STYLE.shift][]).map(([k, s]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: 'inline-block' }} />
            {k === 'shift' ? 'Volunteer shift' : k === 'due' ? 'Gear due back' : 'Overdue'}
          </span>
        ))}
      </div>

      <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} style={{ ...S.th, textAlign: 'center' }}>{d}</div>
          ))}
          {grid.map((d, i) => {
            const key = ymd(d);
            const inMonth = d.getMonth() === month.getMonth();
            const dayEvents = byDate.get(key) ?? [];
            const isToday = key === todayStr;
            const isSelected = key === selected;
            return (
              <div key={i} onClick={() => setSelected(dayEvents.length ? key : null)} style={{
                minHeight: 92, padding: 6, borderBottom: `1px solid ${C.divider}`,
                borderRight: (i % 7 < 6) ? `1px solid ${C.divider}` : 'none',
                background: isSelected ? C.accentTint : isToday ? 'rgba(14,124,134,0.04)' : inMonth ? 'transparent' : 'rgba(0,0,0,0.015)',
                cursor: dayEvents.length ? 'pointer' : 'default',
              }}>
                <div style={{
                  fontSize: 12.5, fontWeight: isToday ? 700 : 500,
                  color: isToday ? C.accent : inMonth ? C.text : C.textTertiary,
                  width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isToday ? C.accentTint : 'transparent', marginBottom: 4,
                }}>{d.getDate()}</div>
                {dayEvents.slice(0, 3).map((e, j) => {
                  const st = KIND_STYLE[e.kind];
                  return (
                    <div key={j} title={`${e.label}${e.detail ? ` — ${e.detail}` : ''}`} style={{
                      fontSize: 11, fontWeight: 600, color: st.color, background: st.tint,
                      borderRadius: 5, padding: '2px 6px', marginBottom: 3,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{e.label}</div>
                  );
                })}
                {dayEvents.length > 3 && (
                  <div style={{ fontSize: 11, color: C.textTertiary }}>+{dayEvents.length - 3} more</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selected && selectedEvents.length > 0 && (
        <div style={{ ...S.card, marginTop: 16 }}>
          <h2 style={S.h2}>{new Date(selected + 'T00:00:00').toDateString()}</h2>
          {selectedEvents.map((e, i) => {
            const st = KIND_STYLE[e.kind];
            return (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.divider}`, fontSize: 14, alignItems: 'baseline' }}>
                <span style={S.badge(st.color, st.tint)}>{e.kind === 'shift' ? 'Shift' : e.kind === 'due' ? 'Due' : 'Overdue'}</span>
                <span><strong>{e.label}</strong>{e.detail && <span style={{ color: C.textSecondary }}> — {e.detail}</span>}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
