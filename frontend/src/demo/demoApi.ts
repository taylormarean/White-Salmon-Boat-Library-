// In-browser demo backend — the Worker's behavior (same safeguards, same
// response shapes) against a localStorage store, so the full app can be
// demoed with zero infrastructure. Built into the bundle only when
// VITE_DEMO=1. Timestamps mirror D1: 'YYYY-MM-DD HH:MM:SS' for created-style
// columns, ISO for due_at — so date rendering matches production exactly.

const LS_KEY = 'wsbl_demo_db_v1';

const sqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
let idCounter = 100;
const newId = (p: string) => `${p}_demo${idCounter++}`;
const randomCode = () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');

interface DB {
  users: any[]; members: any[]; categories: any[]; gear: any[];
  checkouts: any[]; checkoutItems: any[]; maintenance: any[];
  shifts: any[]; signups: any[]; incidents: any[]; donations: any[];
  accessCodes: any[]; notifications: any[]; auditLog: any[];
  settings: Record<string, string>;
  session: { username: string } | null;
}

function seed(): DB {
  const cats = [
    ['kayak', 'Whitewater Kayaks', 1], ['ik', 'Inflatable Kayaks', 2], ['paddle', 'Paddles', 3],
    ['pfd', 'PFDs', 4], ['helmet', 'Helmets', 5], ['skirt', 'Spray Skirts', 6],
    ['drytop', 'Drytops', 7], ['throwbag', 'Throwbags', 8], ['other', 'Other Gear', 9],
  ].map(([id, name, sort]) => ({ id, name, sort }));

  const gearRows: [string, string, string, string, string, string, string][] = [
    ['k01', 'kayak', 'K-01', 'Creek Boat', 'Jackson', 'Zen 3.0', 'Blue'],
    ['k02', 'kayak', 'K-02', 'Creek Boat', 'Pyranha', 'Scorch', 'Red'],
    ['k03', 'kayak', 'K-03', 'River Runner', 'Dagger', 'Rewind', 'Green'],
    ['i01', 'ik', 'IK-01', 'Inflatable Kayak', 'AIRE', 'Tributary', 'Yellow'],
    ['p01', 'paddle', 'P-01', 'Whitewater Paddle', 'Werner', 'Powerhouse', 'Black'],
    ['p02', 'paddle', 'P-02', 'Whitewater Paddle', 'AT', 'Hercules', 'Blue'],
    ['f01', 'pfd', 'PFD-01', 'Rescue PFD', 'Astral', 'GreenJacket', 'Green'],
    ['f02', 'pfd', 'PFD-02', 'PFD', 'NRS', 'Ninja', 'Red'],
    ['h01', 'helmet', 'H-01', 'Helmet', 'Sweet', 'Rocker', 'White'],
    ['h02', 'helmet', 'H-02', 'Helmet', 'WRSI', 'Current', 'Black'],
    ['s01', 'skirt', 'SK-01', 'Spray Skirt', 'Immersion Research', 'Klingon', 'Black'],
    ['d01', 'drytop', 'DT-01', 'Drytop', 'Kokatat', 'Rogue', 'Blue'],
    ['t01', 'throwbag', 'TB-01', 'Throwbag', 'NRS', 'Pro 75ft', 'Orange'],
  ];
  const gear = gearRows.map(([id, category_id, gear_code, name, brand, model, color]) => ({
    id, category_id, gear_code, name, brand, model, color, size: 'M',
    condition: 'good', status: 'available', oos_reason: null, notes: null, active: 1,
    created_at: sqlNow(), updated_at: null,
  }));

  const members = [
    { id: 'mem_maya', name: 'Maya Torres', email: 'maya.demo@example.com', phone: '509-555-0101', experience_level: 'advanced' },
    { id: 'mem_sam', name: 'Sam Whitfield', email: 'sam.demo@example.com', phone: '509-555-0102', experience_level: 'beginner' },
    { id: 'mem_jo', name: 'Jo Kalama', email: 'jo.demo@example.com', phone: '509-555-0103', experience_level: 'intermediate' },
  ].map((m) => ({
    ...m, emergency_contact_name: 'Demo Contact', emergency_contact_phone: '509-555-0100',
    waiver_signed_at: sqlNow(), waiver_version: 1, waiver_signature: m.name,
    orientation_completed_at: m.id === 'mem_sam' ? null : sqlNow(),
    status: 'active', suspension_reason: null, notes: null, created_at: sqlNow(), updated_at: null,
  }));

  const users = [
    { username: 'admin@wsbl.demo', password: 'demo', display_name: 'Library Admin', role: 'admin', member_id: null },
    ...members.map((m) => ({ username: m.email, password: 'paddle123', display_name: m.name, role: 'member', member_id: m.id })),
  ].map((u) => ({ ...u, phone: null, last_login_at: null, created_at: sqlNow() }));

  const db: DB = {
    users, members, categories: cats, gear,
    checkouts: [], checkoutItems: [], maintenance: [], shifts: [], signups: [],
    incidents: [], donations: [], accessCodes: [], notifications: [], auditLog: [],
    settings: {
      app_name: 'White Salmon Boat Library', standard_loan_days: '3', max_loan_days: '9', max_items_per_checkout: '8',
      door_code_mode: 'per_checkout', notifications_paused: '0', notifications_pause_reason: '',
      orientation_info: 'New Member Orientations are Tuesdays at 5:30pm at the library shed at The Missing Corner in BZ Corner (across from the BZ Corner Mini Mart).',
      waiver_version: '1', library_address: 'The Missing Corner, BZ Corner, WA — Hwy 141 at Glenwood Hwy, across from the Mini Mart',
      staff_digest_email: '',
    },
    session: null,
  };

  // Two live checkouts (Maya out on the Truss, Sam on the classic with a buddy)
  const co = (id: string, memberId: string, items: string[], dueDays: number, buddy: string | null, river: string, tripNote: string | null = null) => {
    db.checkouts.push({
      id, member_id: memberId, status: 'active', checked_out_at: sqlNow(), due_at: daysFromNow(dueDays),
      returned_at: null, access_code: randomCode(), ack_sober: 1, ack_pfd: 1, ack_experience: 1, ack_condition: 1,
      buddy_name: buddy, planned_river_section: river, trip_note: tripNote, return_notes: null, extended_by: null, force_returned_by: null,
    });
    for (const g of items) {
      db.checkoutItems.push({ checkout_id: id, gear_item_id: g, returned_at: null, condition_on_return: null, damage_notes: null });
      db.gear.find((x) => x.id === g)!.status = 'checked_out';
    }
    const c = db.checkouts[db.checkouts.length - 1];
    db.accessCodes.push({ id: idCounter++, checkout_id: id, member_id: memberId, code: c.access_code, mode: 'per_checkout', issued_at: sqlNow() });
  };
  co('co_maya', 'mem_maya', ['k02', 'f01'], 3, null, 'Green Truss');
  co('co_sam', 'mem_sam', ['i01', 'h02'], 5, 'Maya Torres', 'BZ to Husum', 'Long weekend on the Deschutes');

  // A repair-queue item
  db.gear.find((g) => g.id === 'd01')!.status = 'maintenance';
  db.gear.find((g) => g.id === 'd01')!.oos_reason = 'Wrist gasket torn — replacement ordered';
  db.maintenance.push({
    id: newId('mnt'), gear_item_id: 'd01', reported_by: 'mem_jo', source: 'return',
    issue: 'Wrist gasket torn — replacement ordered', severity: 'major', status: 'in_progress',
    resolution_notes: null, created_at: sqlNow(), resolved_at: null,
  });

  // Shifts
  const nextTuesday = (weeks = 0) => {
    const d = new Date(); d.setDate(d.getDate() + (((9 - d.getDay()) % 7) || 7) + weeks * 7);
    return d.toISOString().slice(0, 10);
  };
  db.shifts.push(
    { id: 'shift_o1', shift_date: nextTuesday(0), start_time: '17:30', end_time: '19:00', shift_type: 'orientation', title: 'New Member Orientation', notes: null, needed: 2, created_by: 'admin@wsbl.demo', cancelled_at: null, created_at: sqlNow() },
    { id: 'shift_o2', shift_date: nextTuesday(1), start_time: '17:30', end_time: '19:00', shift_type: 'orientation', title: 'New Member Orientation', notes: null, needed: 2, created_by: 'admin@wsbl.demo', cancelled_at: null, created_at: sqlNow() },
    { id: 'shift_r1', shift_date: nextTuesday(1), start_time: '18:00', end_time: '20:30', shift_type: 'gear_maintenance', title: 'Repair Night (pizza provided)', notes: 'Gasket replacements + outfitting checks', needed: 4, created_by: 'admin@wsbl.demo', cancelled_at: null, created_at: sqlNow() },
  );
  db.signups.push({ shift_id: 'shift_o1', username: 'maya.demo@example.com', signed_up_at: sqlNow() });

  db.incidents.push({
    id: newId('inc'), member_id: null, checkout_id: null, type: 'near_miss',
    description: 'Swimmer at Husum Falls — self-rescued, gear recovered downstream. Buddy system worked as intended.',
    occurred_at: new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10),
    reported_by: 'admin@wsbl.demo', status: 'resolved', follow_up: 'Reviewed at orientation.', created_at: sqlNow(), resolved_at: sqlNow(),
  });

  return db;
}

function load(): DB {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupted -> reseed */ }
  const db = seed();
  save(db);
  return db;
}
function save(db: DB) { localStorage.setItem(LS_KEY, JSON.stringify(db)); }

export function resetDemo() { localStorage.removeItem(LS_KEY); }

// ---------- helpers ----------

const fail = (message: string): never => { throw new Error(message); };
const ok = <T>(v: T): Promise<T> => Promise.resolve(JSON.parse(JSON.stringify(v)));

function currentUser(db: DB) {
  if (!db.session) fail('Session expired. Please sign in again.');
  return db.users.find((u) => u.username === db.session!.username) ?? fail('Session expired. Please sign in again.');
}
function requireStaff(db: DB) {
  const u = currentUser(db);
  if (!['admin', 'librarian'].includes(u.role)) fail('Staff only');
  return u;
}
function audit(db: DB, actor: string, action: string, target?: string, meta?: unknown) {
  db.auditLog.unshift({ id: idCounter++, actor, action, target: target ?? null, meta: meta ? JSON.stringify(meta) : null, ip: 'demo', created_at: sqlNow() });
}
function emailLog(db: DB, category: string, recipient: string, subject: string, member_id?: string, checkout_id?: string) {
  db.notifications.unshift({ id: idCounter++, category, channel: 'email', recipient, member_id: member_id ?? null, checkout_id: checkout_id ?? null, subject, status: 'sent', error: null, initiated_by: 'system', sent_at: sqlNow() });
}
function gearWithMeta(db: DB, g: any) {
  const cat = db.categories.find((c) => c.id === g.category_id);
  const openIssues = db.maintenance.filter((m) => m.gear_item_id === g.id && m.status !== 'resolved').length;
  const item = db.checkoutItems.find((ci) => ci.gear_item_id === g.id && !ci.returned_at);
  const checkout = item ? db.checkouts.find((c) => c.id === item.checkout_id && c.status === 'active') : null;
  return { ...g, category_name: cat?.name, open_issues: openIssues, due_back_at: checkout?.due_at ?? null };
}
function checkoutItems(db: DB, checkoutId: string) {
  return db.checkoutItems.filter((ci) => ci.checkout_id === checkoutId).map((ci) => {
    const g = db.gear.find((x) => x.id === ci.gear_item_id)!;
    return { gear_item_id: ci.gear_item_id, returned_at: ci.returned_at, condition_on_return: ci.condition_on_return, damage_notes: ci.damage_notes, gear_code: g.gear_code, name: g.name, brand: g.brand, model: g.model, color: g.color, size: g.size };
  });
}

// ---------- the API surface (mirrors frontend/src/api.ts) ----------

export const demoApi: any = {
  async login(username: string, password: string) {
    const db = load();
    const u = db.users.find((x) => x.username === username.trim().toLowerCase());
    if (!u || u.password !== password) fail('Invalid email or password');
    if (u.role === 'disabled') fail('This account is disabled.');
    u.last_login_at = sqlNow();
    db.session = { username: u.username };
    save(db);
    return ok({ token: 'demo-token', user: { username: u.username, name: u.display_name, role: u.role, member_id: u.member_id } });
  },
  async verify() {
    const db = load();
    const u = currentUser(db);
    return ok({ user: { username: u.username, name: u.display_name, role: u.role, member_id: u.member_id } });
  },
  async changePassword(current_password: string, new_password: string) {
    const db = load();
    const u = currentUser(db);
    if (u.password !== current_password) fail('Current password is incorrect');
    u.password = new_password; save(db);
    return ok({ success: true });
  },

  async publicInfo() {
    const db = load();
    return ok({ app_name: db.settings.app_name, orientation_info: db.settings.orientation_info, library_address: db.settings.library_address, waiver_version: parseInt(db.settings.waiver_version) });
  },
  async join(data: any) {
    const db = load();
    const email = (data.email ?? '').trim().toLowerCase();
    if (!data.name?.trim()) fail('Full name is required');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('A valid email is required');
    if ((data.password ?? '').length < 6) fail('Password must be at least 6 characters');
    if (!data.waiver_accepted) fail('You must accept the liability waiver to join');
    if (!data.waiver_signature?.trim()) fail('Type your full legal name to sign the waiver');
    if (!data.emergency_contact_name || !data.emergency_contact_phone) fail('Emergency contact name and phone are required');
    if (db.users.some((u) => u.username === email) || db.members.some((m) => m.email === email)) {
      fail('An account with this email already exists. Sign in instead.');
    }
    const id = newId('mem');
    db.members.push({
      id, name: data.name.trim(), email, phone: data.phone ?? null,
      emergency_contact_name: data.emergency_contact_name, emergency_contact_phone: data.emergency_contact_phone,
      experience_level: ['beginner', 'intermediate', 'advanced'].includes(data.experience_level) ? data.experience_level : 'beginner',
      waiver_signed_at: sqlNow(), waiver_version: parseInt(db.settings.waiver_version), waiver_signature: data.waiver_signature.trim(),
      orientation_completed_at: null, status: 'active', suspension_reason: null, notes: null, created_at: sqlNow(), updated_at: null,
    });
    db.users.push({ username: email, password: data.password, display_name: data.name.trim(), role: 'member', phone: data.phone ?? null, member_id: id, last_login_at: null, created_at: sqlNow() });
    emailLog(db, 'welcome', email, 'Welcome to the White Salmon Boat Library', id);
    save(db);
    return ok({ success: true, member_id: id });
  },
  async getGear(params?: { category?: string; all?: boolean }) {
    const db = load();
    const staff = db.session && ['admin', 'librarian'].includes(db.users.find((u) => u.username === db.session!.username)?.role);
    let rows = db.gear.filter((g) => (params?.all && staff ? true : g.active === 1));
    if (params?.category) rows = rows.filter((g) => g.category_id === params.category);
    const out = rows.map((g) => gearWithMeta(db, g)).map((g) =>
      staff ? g : { ...g, oos_reason: g.oos_reason ? 'In for repair' : null, notes: null });
    out.sort((a, b) => (db.categories.find((c) => c.id === a.category_id)!.sort - db.categories.find((c) => c.id === b.category_id)!.sort) || a.gear_code.localeCompare(b.gear_code));
    return ok(out);
  },
  async getCategories() { return ok(load().categories); },

  async me() {
    const db = load();
    const u = currentUser(db);
    const member = db.members.find((m) => m.id === u.member_id) ?? fail('No member record linked to this account');
    const active = db.checkouts.filter((c) => c.member_id === member.id && c.status === 'active')
      .map((c) => ({ ...c, items: checkoutItems(db, c.id) }));
    return ok({ member, active_checkouts: active });
  },
  async selfCheckout(data: any) {
    const db = load();
    const u = currentUser(db);
    const m = db.members.find((x) => x.id === u.member_id) ?? fail('Sign in with your member account first');
    if (m.status !== 'active') fail(m.status === 'suspended' ? `Your membership is suspended${m.suspension_reason ? `: ${m.suspension_reason}` : ''}. Contact the library.` : 'Your membership is not active. Contact the library.');
    if ((m.waiver_version ?? 0) < parseInt(db.settings.waiver_version)) fail('Our liability waiver has been updated — please re-sign it before checking out gear.');
    if (db.checkouts.some((c) => c.member_id === m.id && c.status === 'active' && new Date(c.due_at) < new Date())) {
      fail('You have overdue gear. Return it (or ask the library for an extension) before checking out more.');
    }
    if (!data.ack_sober || !data.ack_pfd || !data.ack_experience || !data.ack_condition) fail('All safety acknowledgments are required.');
    if (m.experience_level === 'beginner' && !(data.buddy_name ?? '').trim()) {
      fail('Library policy: paddlers new to the sport must go with an experienced buddy. Enter the name of who you are paddling with.');
    }
    const ids: string[] = [...new Set(data.gear_item_ids ?? [])] as string[];
    if (ids.length === 0) fail('Pick at least one piece of gear.');
    const maxItems = parseInt(db.settings.max_items_per_checkout);
    if (ids.length > maxItems) fail(`You can check out at most ${maxItems} items at a time.`);
    const due = new Date(data.due_at ?? '');
    if (isNaN(due.getTime())) fail('A return date is required.');
    if (due.getTime() < Date.now()) fail('The return date must be in the future.');
    const standardDays = parseInt(db.settings.standard_loan_days ?? '3');
    const maxDays = parseInt(db.settings.max_loan_days);
    if (due.getTime() > Date.now() + maxDays * 86_400_000 + 60_000) fail(`${maxDays} days (three rental periods) is the maximum. Pick an earlier return date.`);
    const isExtended = due.getTime() > Date.now() + standardDays * 86_400_000 + 60_000;
    if (isExtended && !(data.trip_note ?? '').trim()) fail(`Standard rentals are ${standardDays} days. Longer rentals are reserved for multi-day runs and out-of-town trips — tell us where the gear is going.`);
    const items = ids.map((id) => db.gear.find((g) => g.id === id) ?? fail('One or more selected items no longer exist.'));
    const unavailable = items.filter((g: any) => g.status !== 'available' || !g.active);
    if (unavailable.length) fail(`Not available: ${unavailable.map((g: any) => `${g.gear_code} (${g.status})`).join(', ')}. Refresh and pick again.`);

    const id = newId('co');
    const code = randomCode();
    for (const g of items) (g as any).status = 'checked_out';
    db.checkouts.push({
      id, member_id: m.id, status: 'active', checked_out_at: sqlNow(), due_at: due.toISOString(), returned_at: null,
      access_code: code, ack_sober: 1, ack_pfd: 1, ack_experience: 1, ack_condition: 1,
      buddy_name: (data.buddy_name ?? '').trim() || null, planned_river_section: (data.planned_river_section ?? '').trim() || null,
      trip_note: (data.trip_note ?? '').trim() || null,
      return_notes: null, extended_by: null, force_returned_by: null,
    });
    for (const g of items) db.checkoutItems.push({ checkout_id: id, gear_item_id: (g as any).id, returned_at: null, condition_on_return: null, damage_notes: null });
    db.accessCodes.unshift({ id: idCounter++, checkout_id: id, member_id: m.id, code, mode: db.settings.door_code_mode, issued_at: sqlNow() });
    emailLog(db, 'checkout_confirmation', m.email, `Your gear is reserved — shed code ${code}`, m.id, id);
    save(db);
    return ok({
      success: true, checkout_id: id, access_code: code, code_mode: db.settings.door_code_mode, due_at: due.toISOString(),
      items: items.map((g: any) => ({ id: g.id, gear_code: g.gear_code, name: g.name, brand: g.brand, model: g.model })),
    });
  },
  async selfReturn(checkoutId: string, data: any) {
    const db = load();
    const u = currentUser(db);
    const checkout = db.checkouts.find((c) => c.id === checkoutId) ?? fail('Checkout not found');
    if (checkout.member_id !== u.member_id) fail('This checkout belongs to a different member.');
    if (checkout.status !== 'active') fail('This checkout is already closed.');
    const outstanding = new Set(db.checkoutItems.filter((ci) => ci.checkout_id === checkoutId && !ci.returned_at).map((ci) => ci.gear_item_id));
    const reported = (data.items ?? []).filter((i: any) => outstanding.has(i.gear_item_id));
    if (reported.length === 0) fail('Select which items you are returning.');
    for (const item of reported) {
      const damaged = item.condition === 'damaged';
      if (damaged && !(item.damage_notes ?? '').trim()) fail('Describe the damage for each damaged item — honest reports are part of the library agreement.');
      const ci = db.checkoutItems.find((x) => x.checkout_id === checkoutId && x.gear_item_id === item.gear_item_id)!;
      ci.returned_at = sqlNow(); ci.condition_on_return = damaged ? 'damaged' : 'ok'; ci.damage_notes = damaged ? item.damage_notes : null;
      const g = db.gear.find((x) => x.id === item.gear_item_id)!;
      g.status = damaged ? 'maintenance' : 'available';
      g.oos_reason = damaged ? `Damage reported on return: ${item.damage_notes}` : null;
      if (damaged) db.maintenance.unshift({ id: newId('mnt'), gear_item_id: g.id, reported_by: checkout.member_id, source: 'return', issue: item.damage_notes, severity: 'major', status: 'open', resolution_notes: null, created_at: sqlNow(), resolved_at: null });
    }
    const stillOut = db.checkoutItems.some((ci) => ci.checkout_id === checkoutId && !ci.returned_at);
    if (!stillOut) { checkout.status = 'returned'; checkout.returned_at = sqlNow(); checkout.return_notes = (data.return_notes ?? '').trim() || null; }
    save(db);
    return ok({ success: true, complete: !stillOut, items_returned: reported.length });
  },

  async getShifts(all?: boolean) {
    const db = load();
    const today = new Date().toISOString().slice(0, 10);
    const me = db.session?.username ?? '';
    return ok(db.shifts
      .filter((s) => !s.cancelled_at && (all || s.shift_date >= today))
      .sort((a, b) => a.shift_date.localeCompare(b.shift_date) || a.start_time.localeCompare(b.start_time))
      .map((s) => {
        const vols = db.signups.filter((x) => x.shift_id === s.id).map((x) => ({ username: x.username, name: db.users.find((u) => u.username === x.username)?.display_name ?? x.username }));
        return { ...s, signed_up: vols.length, volunteers: vols, caller_signed_up: vols.some((v) => v.username === me) ? 1 : 0 };
      }));
  },
  async createShift(data: any) {
    const db = load(); const u = requireStaff(db);
    if (!data.shift_date || !data.start_time || !data.end_time || !data.title) fail('shift_date, start_time, end_time, and title are required');
    const id = newId('shift');
    db.shifts.push({ id, shift_date: data.shift_date, start_time: data.start_time, end_time: data.end_time, shift_type: data.shift_type ?? 'orientation', title: data.title, notes: data.notes ?? null, needed: Math.max(1, parseInt(data.needed) || 1), created_by: u.username, cancelled_at: null, created_at: sqlNow() });
    audit(db, u.username, 'shift.create', id); save(db);
    return ok({ success: true, id });
  },
  async updateShift(id: string, data: any) {
    const db = load(); const u = requireStaff(db);
    const s = db.shifts.find((x) => x.id === id) ?? fail('Shift not found');
    Object.assign(s, { shift_date: data.shift_date ?? s.shift_date, start_time: data.start_time ?? s.start_time, end_time: data.end_time ?? s.end_time, shift_type: data.shift_type ?? s.shift_type, title: data.title ?? s.title, notes: data.notes ?? s.notes, needed: data.needed !== undefined ? Math.max(1, parseInt(data.needed) || 1) : s.needed });
    audit(db, u.username, 'shift.update', id); save(db);
    return ok({ success: true });
  },
  async cancelShift(id: string) {
    const db = load(); const u = requireStaff(db);
    const s = db.shifts.find((x) => x.id === id && !x.cancelled_at) ?? fail('Shift not found or already cancelled');
    s.cancelled_at = sqlNow(); audit(db, u.username, 'shift.cancel', id); save(db);
    return ok({ success: true });
  },
  async signupShift(id: string) {
    const db = load(); const u = currentUser(db);
    const s = db.shifts.find((x) => x.id === id && !x.cancelled_at) ?? fail('Shift not found');
    const count = db.signups.filter((x) => x.shift_id === id).length;
    if (count >= s.needed) fail('This shift is already full');
    if (db.signups.some((x) => x.shift_id === id && x.username === u.username)) fail('You are already signed up for this shift');
    db.signups.push({ shift_id: id, username: u.username, signed_up_at: sqlNow() }); save(db);
    return ok({ success: true });
  },
  async unsignupShift(id: string) {
    const db = load(); const u = currentUser(db);
    db.signups = db.signups.filter((x) => !(x.shift_id === id && x.username === u.username)); save(db);
    return ok({ success: true });
  },

  async getDashboard() {
    const db = load(); requireStaff(db);
    const gearCounts: Record<string, number> = { available: 0, checked_out: 0, maintenance: 0, retired: 0 };
    for (const g of db.gear.filter((x) => x.active === 1)) gearCounts[g.status] = (gearCounts[g.status] ?? 0) + 1;
    const active = db.checkouts.filter((c) => c.status === 'active').sort((a, b) => a.due_at.localeCompare(b.due_at)).map((c) => {
      const m = db.members.find((x) => x.id === c.member_id)!;
      return { id: c.id, due_at: c.due_at, checked_out_at: c.checked_out_at, member_name: m.name, experience_level: m.experience_level, items_out: db.checkoutItems.filter((ci) => ci.checkout_id === c.id && !ci.returned_at).length };
    });
    return ok({
      gear: gearCounts,
      active_checkouts: active,
      overdue_count: db.checkouts.filter((c) => c.status === 'active' && new Date(c.due_at) < new Date()).length,
      members: {
        total: db.members.length,
        active: db.members.filter((m) => m.status === 'active').length,
        suspended: db.members.filter((m) => m.status === 'suspended').length,
        pending_orientation: db.members.filter((m) => !m.orientation_completed_at && m.status === 'active').length,
        new_30d: db.members.length,
      },
      open_maintenance: db.maintenance.filter((m) => m.status !== 'resolved').map((m) => ({ ...m, gear_code: db.gear.find((g) => g.id === m.gear_item_id)?.gear_code, gear_name: db.gear.find((g) => g.id === m.gear_item_id)?.name })),
      upcoming_shifts: db.shifts.filter((s) => !s.cancelled_at && s.shift_date >= new Date().toISOString().slice(0, 10)).map((s) => ({ ...s, signed_up: db.signups.filter((x) => x.shift_id === s.id).length })),
      open_incidents: db.incidents.filter((i) => i.status !== 'resolved').length,
    });
  },

  async createGear(data: any) {
    const db = load(); const u = requireStaff(db);
    if (!data.category_id || !data.gear_code || !data.name) fail('category_id, gear_code, and name are required');
    if (db.gear.some((g) => g.gear_code === data.gear_code)) fail(`Gear code ${data.gear_code} is already in use`);
    const id = newId('gear');
    db.gear.push({ id, category_id: data.category_id, gear_code: data.gear_code, name: data.name, brand: data.brand ?? null, model: data.model ?? null, color: data.color ?? null, size: data.size ?? null, condition: data.condition ?? 'good', status: 'available', oos_reason: null, notes: data.notes ?? null, active: 1, created_at: sqlNow(), updated_at: null });
    audit(db, u.username, 'gear.create', id); save(db);
    return ok({ success: true, id });
  },
  async updateGear(id: string, data: any) {
    const db = load(); const u = requireStaff(db);
    const g = db.gear.find((x) => x.id === id) ?? fail('Gear item not found');
    if (data.gear_code && data.gear_code !== g.gear_code && db.gear.some((x) => x.gear_code === data.gear_code)) fail(`Gear code ${data.gear_code} is already in use`);
    Object.assign(g, { gear_code: data.gear_code ?? g.gear_code, name: data.name ?? g.name, brand: data.brand ?? g.brand, model: data.model ?? g.model, color: data.color ?? g.color, size: data.size ?? g.size, condition: data.condition ?? g.condition, notes: data.notes ?? g.notes, updated_at: sqlNow() });
    audit(db, u.username, 'gear.update', id); save(db);
    return ok({ success: true });
  },
  async setGearStatus(id: string, status: string, reason?: string) {
    const db = load(); const u = requireStaff(db);
    const g = db.gear.find((x) => x.id === id) ?? fail('Gear item not found');
    if (g.status === 'checked_out') fail('Item is currently checked out — process the return first');
    if (status !== 'available' && !reason) fail('A reason is required when pulling gear from circulation');
    g.status = status; g.oos_reason = status === 'available' ? null : reason; g.updated_at = sqlNow();
    audit(db, u.username, 'gear.status', id, { status, reason }); save(db);
    return ok({ success: true });
  },
  async getMaintenance(status?: string) {
    const db = load(); requireStaff(db);
    return ok(db.maintenance.filter((m) => !status || m.status === status).map((m) => {
      const g = db.gear.find((x) => x.id === m.gear_item_id)!;
      return { ...m, gear_code: g.gear_code, gear_name: g.name, brand: g.brand, model: g.model, gear_status: g.status };
    }));
  },
  async createMaintenance(gearId: string, data: any) {
    const db = load(); const u = requireStaff(db);
    const g = db.gear.find((x) => x.id === gearId) ?? fail('Gear item not found');
    if (!data.issue) fail('issue is required');
    const severity = ['minor', 'major', 'unusable'].includes(data.severity) ? data.severity : 'minor';
    db.maintenance.unshift({ id: newId('mnt'), gear_item_id: gearId, reported_by: u.username, source: 'staff', issue: data.issue, severity, status: 'open', resolution_notes: null, created_at: sqlNow(), resolved_at: null });
    if (severity !== 'minor' && g.status === 'available') { g.status = 'maintenance'; g.oos_reason = data.issue; }
    audit(db, u.username, 'gear.maintenance.create', gearId); save(db);
    return ok({ success: true });
  },
  async updateMaintenance(id: string, data: any) {
    const db = load(); const u = requireStaff(db);
    const m = db.maintenance.find((x) => x.id === id) ?? fail('Maintenance record not found');
    const status = ['open', 'in_progress', 'resolved'].includes(data.status) ? data.status : m.status;
    m.status = status; m.resolution_notes = data.resolution_notes ?? m.resolution_notes;
    if (status === 'resolved') {
      m.resolved_at = sqlNow();
      if (data.return_to_service && !db.maintenance.some((x) => x.gear_item_id === m.gear_item_id && x.status !== 'resolved')) {
        const g = db.gear.find((x) => x.id === m.gear_item_id)!;
        if (g.status === 'maintenance') { g.status = 'available'; g.oos_reason = null; }
      }
    }
    audit(db, u.username, 'gear.maintenance.update', id); save(db);
    return ok({ success: true });
  },

  async getMembers() {
    const db = load(); requireStaff(db);
    return ok(db.members.map((m) => ({
      ...m,
      active_checkouts: db.checkouts.filter((c) => c.member_id === m.id && c.status === 'active').length,
      overdue_checkouts: db.checkouts.filter((c) => c.member_id === m.id && c.status === 'active' && new Date(c.due_at) < new Date()).length,
      lifetime_checkouts: db.checkouts.filter((c) => c.member_id === m.id).length,
    })));
  },
  async getMember(id: string) {
    const db = load(); requireStaff(db);
    const member = db.members.find((m) => m.id === id) ?? fail('Member not found');
    const checkouts = db.checkouts.filter((c) => c.member_id === id).map((c) => ({
      ...c, gear_codes: JSON.stringify(db.checkoutItems.filter((ci) => ci.checkout_id === c.id).map((ci) => db.gear.find((g) => g.id === ci.gear_item_id)?.gear_code)),
    }));
    const incidents = db.incidents.filter((i) => i.member_id === id);
    return ok({ member, checkouts, incidents });
  },
  async updateMember(id: string, data: any) {
    const db = load(); const u = requireStaff(db);
    const m = db.members.find((x) => x.id === id) ?? fail('Member not found');
    if (data.orientation_completed === true && !m.orientation_completed_at) m.orientation_completed_at = sqlNow();
    if (data.orientation_completed === false) m.orientation_completed_at = null;
    Object.assign(m, { name: data.name ?? m.name, phone: data.phone ?? m.phone, notes: data.notes ?? m.notes, updated_at: sqlNow() });
    if (['beginner', 'intermediate', 'advanced'].includes(data.experience_level)) m.experience_level = data.experience_level;
    audit(db, u.username, 'member.update', id); save(db);
    return ok({ success: true });
  },
  async setMemberStatus(id: string, status: string, reason?: string) {
    const db = load(); const u = requireStaff(db);
    const m = db.members.find((x) => x.id === id) ?? fail('Member not found');
    m.status = status; m.suspension_reason = status === 'active' ? null : (reason ?? null); m.updated_at = sqlNow();
    if (status === 'terminated') { const acct = db.users.find((x) => x.member_id === id); if (acct) acct.role = 'disabled'; }
    audit(db, u.username, `member.${status}`, id, { reason }); save(db);
    return ok({ success: true });
  },

  async getCheckouts(status?: string) {
    const db = load(); requireStaff(db);
    let rows = db.checkouts;
    if (status === 'active') rows = rows.filter((c) => c.status === 'active');
    else if (status === 'returned') rows = rows.filter((c) => c.status === 'returned');
    else if (status === 'overdue') rows = rows.filter((c) => c.status === 'active' && new Date(c.due_at) < new Date());
    return ok(rows.map((c) => {
      const m = db.members.find((x) => x.id === c.member_id)!;
      return { ...c, member_name: m.name, member_email: m.email, member_phone: m.phone, experience_level: m.experience_level, items: checkoutItems(db, c.id) };
    }).sort((a, b) => b.checked_out_at.localeCompare(a.checked_out_at)));
  },
  async extendCheckout(id: string, due_at: string) {
    const db = load(); const u = requireStaff(db);
    const c = db.checkouts.find((x) => x.id === id) ?? fail('Checkout not found');
    if (c.status !== 'active') fail('Only active checkouts can be extended');
    c.due_at = due_at; c.extended_by = u.username;
    audit(db, u.username, 'checkout.extend', id); save(db);
    return ok({ success: true });
  },
  async forceReturn(id: string, data: any) {
    const db = load(); const u = requireStaff(db);
    const c = db.checkouts.find((x) => x.id === id) ?? fail('Checkout not found');
    if (c.status !== 'active') fail('Checkout is already closed');
    const markAs = data.mark_items === 'maintenance' ? 'maintenance' : 'available';
    for (const ci of db.checkoutItems.filter((x) => x.checkout_id === id && !x.returned_at)) {
      ci.returned_at = sqlNow(); ci.condition_on_return = 'ok';
      const g = db.gear.find((x) => x.id === ci.gear_item_id)!;
      g.status = markAs; g.oos_reason = markAs === 'maintenance' ? `Staff force-return: ${data.notes ?? 'inspection needed'}` : null;
    }
    c.status = 'returned'; c.returned_at = sqlNow(); c.force_returned_by = u.username; c.return_notes = data.notes ?? null;
    audit(db, u.username, 'checkout.force_return', id); save(db);
    return ok({ success: true });
  },
  async getAccessCodeLog() {
    const db = load(); requireStaff(db);
    return ok(db.accessCodes.map((a) => ({ ...a, member_name: db.members.find((m) => m.id === a.member_id)?.name })));
  },
  async getTodayDoorCode() {
    const db = load(); requireStaff(db);
    return ok({ date: new Date().toISOString().slice(0, 10), code: '284916', mode: db.settings.door_code_mode });
  },

  async getIncidents(status?: string) {
    const db = load(); requireStaff(db);
    return ok(db.incidents.filter((i) => !status || i.status === status).map((i) => ({ ...i, member_name: db.members.find((m) => m.id === i.member_id)?.name ?? null })));
  },
  async createIncident(data: any) {
    const db = load(); const u = requireStaff(db);
    if (!data.description) fail('description is required');
    const id = newId('inc');
    db.incidents.unshift({ id, member_id: data.member_id ?? null, checkout_id: data.checkout_id ?? null, type: data.type ?? 'other', description: data.description, occurred_at: data.occurred_at ?? null, reported_by: u.username, status: 'open', follow_up: null, created_at: sqlNow(), resolved_at: null });
    audit(db, u.username, 'incident.create', id); save(db);
    return ok({ success: true, id });
  },
  async updateIncident(id: string, data: any) {
    const db = load(); const u = requireStaff(db);
    const i = db.incidents.find((x) => x.id === id) ?? fail('Incident not found');
    const status = ['open', 'investigating', 'resolved'].includes(data.status) ? data.status : i.status;
    Object.assign(i, { type: data.type ?? i.type, description: data.description ?? i.description, status, follow_up: data.follow_up ?? i.follow_up });
    if (status === 'resolved' && !i.resolved_at) i.resolved_at = sqlNow();
    audit(db, u.username, 'incident.update', id); save(db);
    return ok({ success: true });
  },

  async getSettings() { const db = load(); requireStaff(db); return ok(db.settings); },
  async updateSettings(data: Record<string, string>) {
    const db = load(); const u = requireStaff(db);
    if (u.role !== 'admin') fail('Admin only');
    Object.assign(db.settings, data);
    audit(db, u.username, 'settings.update', undefined, data); save(db);
    return ok({ success: true });
  },
  async getUsers() {
    const db = load(); const u = requireStaff(db);
    if (u.role !== 'admin') fail('Admin only');
    return ok(db.users.map((x) => ({ username: x.username, display_name: x.display_name, role: x.role, phone: x.phone, member_id: x.member_id, last_login_at: x.last_login_at, created_at: x.created_at, member_name: db.members.find((m) => m.id === x.member_id)?.name ?? null })));
  },
  async createUser(data: any) {
    const db = load(); const u = requireStaff(db);
    if (u.role !== 'admin') fail('Admin only');
    const username = (data.username ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(username)) fail('username must be an email address');
    if (db.users.some((x) => x.username === username)) fail('A user with this email already exists');
    if ((data.password ?? '').length < 6) fail('password must be at least 6 characters');
    db.users.push({ username, password: data.password, display_name: data.display_name, role: data.role ?? 'volunteer', phone: data.phone ?? null, member_id: null, last_login_at: null, created_at: sqlNow() });
    audit(db, u.username, 'user.create', username); save(db);
    return ok({ success: true });
  },
  async updateUser(username: string, data: any) {
    const db = load(); const u = requireStaff(db);
    if (u.role !== 'admin') fail('Admin only');
    const target = db.users.find((x) => x.username === username) ?? fail('User not found');
    if (username === u.username && data.role && data.role !== 'admin') fail('You cannot change your own admin role');
    Object.assign(target, { display_name: data.display_name ?? target.display_name, role: data.role ?? target.role, phone: data.phone ?? target.phone });
    if (data.new_password) target.password = data.new_password;
    audit(db, u.username, 'user.update', username); save(db);
    return ok({ success: true });
  },
  async getAuditLog() { const db = load(); const u = requireStaff(db); if (u.role !== 'admin') fail('Admin only'); return ok(db.auditLog); },
  async getNotificationLog() { const db = load(); requireStaff(db); return ok(db.notifications); },
};
