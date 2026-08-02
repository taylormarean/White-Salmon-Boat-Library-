// Staff dashboard rollup — the fleet-status calculator, reshaped for gear.

import type { Env } from '../index';
import { json } from '../lib/util';

export async function handleDashboard(env: Env): Promise<Response> {
  const [gear, checkouts, overdue, members, maintenance, shifts, incidents] = await Promise.all([
    env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM gear_items WHERE active = 1 GROUP BY status`,
    ).all<any>(),
    env.DB.prepare(
      `SELECT c.id, c.due_at, c.checked_out_at, m.name AS member_name, m.experience_level,
        (SELECT COUNT(*) FROM checkout_items ci WHERE ci.checkout_id = c.id AND ci.returned_at IS NULL) AS items_out
       FROM checkouts c JOIN members m ON m.id = c.member_id
       WHERE c.status = 'active' ORDER BY c.due_at ASC LIMIT 50`,
    ).all<any>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM checkouts WHERE status = 'active' AND due_at < datetime('now')`,
    ).first<any>(),
    env.DB.prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
        SUM(CASE WHEN orientation_completed_at IS NULL AND status = 'active' THEN 1 ELSE 0 END) AS pending_orientation,
        SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS new_30d
       FROM members`,
    ).first<any>(),
    env.DB.prepare(
      `SELECT gm.id, gm.issue, gm.severity, gm.status, gm.created_at, g.gear_code, g.name AS gear_name
       FROM gear_maintenance gm JOIN gear_items g ON g.id = gm.gear_item_id
       WHERE gm.status != 'resolved' ORDER BY gm.created_at DESC LIMIT 20`,
    ).all<any>(),
    env.DB.prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM shift_signups ss WHERE ss.shift_id = s.id) AS signed_up
       FROM volunteer_shifts s
       WHERE s.cancelled_at IS NULL AND s.shift_date >= date('now') ORDER BY s.shift_date, s.start_time LIMIT 10`,
    ).all<any>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM incidents WHERE status != 'resolved'`,
    ).first<any>(),
  ]);

  const gearCounts: Record<string, number> = { available: 0, checked_out: 0, maintenance: 0, retired: 0 };
  for (const row of gear.results ?? []) gearCounts[row.status] = row.n;

  return json({
    gear: gearCounts,
    active_checkouts: checkouts.results ?? [],
    overdue_count: overdue?.n ?? 0,
    members,
    open_maintenance: maintenance.results ?? [],
    upcoming_shifts: shifts.results ?? [],
    open_incidents: incidents?.n ?? 0,
  });
}
