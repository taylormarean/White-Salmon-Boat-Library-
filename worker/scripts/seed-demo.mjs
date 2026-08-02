#!/usr/bin/env node
// Populate a WSBL instance with realistic demo data via the public API, so a
// client demo shows a living library instead of empty tables.
//
// Usage:
//   BASE=http://localhost:8787 node scripts/seed-demo.mjs           # local dev
//   BASE=https://wsbl-api.<you>.workers.dev node scripts/seed-demo.mjs
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... to also seed staff-side data (shifts, incidents).
//
// Creates: 3 members (password: paddle123), 2 active checkouts, and — with
// admin creds — 3 volunteer shifts and 1 resolved incident.

const BASE = process.env.BASE || 'http://localhost:8787';
const API = `${BASE}/api`;

async function req(path, opts = {}, token) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

const MEMBERS = [
  { name: 'Maya Torres', email: 'maya.demo@example.com', experience_level: 'advanced', phone: '509-555-0101' },
  { name: 'Sam Whitfield', email: 'sam.demo@example.com', experience_level: 'beginner', phone: '509-555-0102' },
  { name: 'Jo Kalama', email: 'jo.demo@example.com', experience_level: 'intermediate', phone: '509-555-0103' },
];

console.log(`Seeding demo data into ${BASE} ...`);

// 1. Members
const tokens = {};
for (const m of MEMBERS) {
  const join = await req('/public/join', {
    method: 'POST',
    body: JSON.stringify({
      ...m, password: 'paddle123', waiver_signature: m.name, waiver_accepted: true,
      emergency_contact_name: 'Demo Contact', emergency_contact_phone: '509-555-0100',
    }),
  });
  console.log(join.ok ? `  member ${m.name} created` : `  member ${m.name}: ${join.body.error ?? join.status}`);
  const login = await req('/auth/login', { method: 'POST', body: JSON.stringify({ username: m.email, password: 'paddle123' }) });
  if (login.ok) tokens[m.email] = login.body.token;
}

// 2. Checkouts (gear ids from the schema seed)
const due = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
const checkouts = [
  { email: 'maya.demo@example.com', gear_item_ids: ['k02', 'p01', 'f01', 'h01', 's01'], due_at: due(3), planned_river_section: 'Green Truss' },
  { email: 'sam.demo@example.com', gear_item_ids: ['i01', 'p02', 'f02', 'h02'], due_at: due(5), buddy_name: 'Maya Torres', planned_river_section: 'BZ to Husum' },
];
for (const c of checkouts) {
  const t = tokens[c.email];
  if (!t) continue;
  const r = await req('/checkouts/self', {
    method: 'POST',
    body: JSON.stringify({ ...c, ack_sober: true, ack_pfd: true, ack_experience: true, ack_condition: true }),
  }, t);
  console.log(r.ok ? `  checkout for ${c.email} → code ${r.body.access_code}` : `  checkout ${c.email}: ${r.body.error ?? r.status}`);
}

// 3. Staff-side data (needs admin credentials)
const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (ADMIN_EMAIL && ADMIN_PASSWORD) {
  const login = await req('/auth/login', { method: 'POST', body: JSON.stringify({ username: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
  if (!login.ok) { console.log(`  admin login failed: ${login.body.error}`); process.exit(0); }
  const admin = login.body.token;

  const nextTuesday = (weeks = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + ((9 - d.getDay()) % 7 || 7) + weeks * 7);
    return d.toISOString().slice(0, 10);
  };
  const shifts = [
    { shift_date: nextTuesday(0), start_time: '17:30', end_time: '19:00', shift_type: 'orientation', title: 'New Member Orientation', needed: 2 },
    { shift_date: nextTuesday(1), start_time: '17:30', end_time: '19:00', shift_type: 'orientation', title: 'New Member Orientation', needed: 2 },
    { shift_date: nextTuesday(1), start_time: '18:00', end_time: '20:30', shift_type: 'gear_maintenance', title: 'Repair Night (pizza provided)', needed: 4 },
  ];
  for (const s of shifts) {
    const r = await req('/shifts', { method: 'POST', body: JSON.stringify(s) }, admin);
    console.log(r.ok ? `  shift "${s.title}" on ${s.shift_date}` : `  shift: ${r.body.error ?? r.status}`);
  }

  const inc = await req('/incidents', {
    method: 'POST',
    body: JSON.stringify({ type: 'near_miss', description: 'Swimmer at Husum Falls — self-rescued, gear recovered downstream. Buddy system worked as intended.', occurred_at: new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10) }),
  }, admin);
  console.log(inc.ok ? '  incident logged' : `  incident: ${inc.body.error ?? inc.status}`);
}

console.log('\nDone. Demo member login: any of the *.demo@example.com accounts / paddle123');
console.log('Tip (optional): make one checkout overdue for the demo —');
console.log(`  wrangler d1 execute wsbl-db --remote --command "UPDATE checkouts SET due_at = datetime('now','-2 days') WHERE id = (SELECT id FROM checkouts WHERE status='active' LIMIT 1); DELETE FROM reminder_log;"`);
