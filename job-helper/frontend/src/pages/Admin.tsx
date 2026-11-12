import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import { Btn, ErrorBox, Loading, useToast, when } from '../ui';
import './business.css';

type Period = { credit_sold: number; usage_charged: number; ai_cost: number; ai_cost_comped: number; referral_earned: number; referral_paid: number; profit: number };
interface Overview {
  month: Period; all: Period;
  users: number; waitlist: number; max_users: number;
  prepaid_outstanding: number; referral_owed: number;
  global_cap_usd: number | null; global_month_cost: number;
  multiplier: number; referral_share: number;
}
interface AdminUser {
  id: number; email: string; name: string; plan: 'paid' | 'free'; status: 'active' | 'waitlist' | 'suspended'; is_admin: number;
  balance_micro: number; monthly_cap_micro: number | null; created_at: string; last_login_at: string | null; connect_ready: number;
  referred_by_email: string | null; referrals: number; month_cost: number; month_charge: number; earnings_unpaid: number;
}

/** Micro-dollars → "$1,234.56", or 3 decimals under a dollar ("$0.042"). */
function money(micro: number | null | undefined): string {
  const v = (micro ?? 0) / 1_000_000;
  const abs = Math.abs(v);
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: abs < 1 && v !== 0 ? 3 : 2, maximumFractionDigits: abs < 1 && v !== 0 ? 3 : 2 });
  return `${v < 0 ? '−' : ''}$${s}`;
}

/** Fetch that keeps the HTTP status, so a 403 can say "Admins only". */
function useAdminLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<{ status: number; message: string } | null>(null);
  const load = useCallback(() => {
    api<T>(path).then((d) => { setData(d); setErr(null); })
      .catch((e) => setErr({ status: e instanceof ApiError ? e.status : 0, message: e instanceof Error ? e.message : String(e) }));
  }, [path]);
  useEffect(load, [load]);
  return { data, err, reload: load };
}

const FILTERS = { all: 'Everyone', waitlist: 'Waitlist', active: 'Active', free: 'Comped', paid: 'Paying', suspended: 'Suspended' } as const;
type Filter = keyof typeof FILTERS;

export default function Admin() {
  const ov = useAdminLoad<Overview>('/admin/overview');
  const us = useAdminLoad<AdminUser[]>('/admin/users');
  const toast = useToast();
  const [period, setPeriod] = useState<'month' | 'all'>('month');

  const forbidden = ov.err?.status === 403 || us.err?.status === 403;
  if (forbidden) return <div className="card warn"><h2>Admins only</h2><p style={{ margin: 0 }}>This page is for the business owner.</p></div>;
  if (ov.err && !ov.data) return <ErrorBox error={ov.err.message} />;
  if (!ov.data) return <Loading />;
  const o = ov.data;
  const p = o[period];
  const reloadAll = () => { ov.reload(); us.reload(); };

  return (
    <div className="biz biz-admin">
      <div className="row between">
        <div><h1>Business</h1><p className="muted" style={{ margin: 0 }}>Pricing: customers pay {o.multiplier}× AI cost · referrers get {Math.round(o.referral_share * 100)}% of profit</p></div>
        <Btn className="danger" busyText="Paying…" onClick={async () => {
          if (!window.confirm('Send referral payouts now?\n\nEveryone with enough available earnings and a ready payout account will be paid by Stripe transfer. This moves real money.')) return;
          const r = await api<{ paid: number; failed: number }>('/admin/payouts/run', { method: 'POST' });
          toast(`Payouts done: ${r.paid} paid, ${r.failed} failed`, r.failed > 0);
          reloadAll();
        }}>💸 Run payouts now</Btn>
      </div>

      <div className="tabs">
        <button className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>This month</button>
        <button className={period === 'all' ? 'on' : ''} onClick={() => setPeriod('all')}>All time</button>
      </div>
      <div className="biz-kpis">
        <Kpi label="Profit" value={money(p.profit)} tone={p.profit >= 0 ? 'pos' : 'neg'} sub="charged − AI cost − referrals" hl />
        <Kpi label="Credit sold" value={money(p.credit_sold)} sub="Stripe purchases" />
        <Kpi label="Usage charged" value={money(p.usage_charged)} sub="drawn from balances" />
        <Kpi label="AI cost" value={money(p.ai_cost)} sub={`${money(p.ai_cost_comped)} comped`} />
        <Kpi label="Referral earned" value={money(p.referral_earned)} sub="accrued to referrers" />
        <Kpi label="Referral paid" value={money(p.referral_paid)} sub="transferred" />
      </div>
      <div className="biz-kpis">
        <Kpi label="Active users" value={`${o.users} / ${o.max_users}`} sub="beta cap" />
        <Kpi label="Waitlist" value={String(o.waitlist)} tone={o.waitlist > 0 ? 'neg' : undefined} sub={o.waitlist > 0 ? 'waiting for approval' : 'nobody waiting'} />
        <Kpi label="Prepaid outstanding" value={money(o.prepaid_outstanding)} sub="unspent customer credit" />
        <Kpi label="Referral owed" value={money(o.referral_owed)} sub="earned, not yet paid" />
      </div>

      <GlobalCap o={o} onSaved={ov.reload} />

      <Users list={us.data} error={us.err?.message ?? null} onChange={reloadAll} />
    </div>
  );
}

function Kpi({ label, value, sub, tone, hl }: { label: string; value: string; sub?: string; tone?: 'pos' | 'neg'; hl?: boolean }) {
  return (
    <div className={`biz-kpi ${tone ?? ''} ${hl ? 'hl' : ''}`}>
      <div className="biz-label">{label}</div>
      <div className="v">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function GlobalCap({ o, onSaved }: { o: Overview; onSaved: () => void }) {
  const [v, setV] = useState(o.global_cap_usd == null ? '' : String(o.global_cap_usd));
  useEffect(() => setV(o.global_cap_usd == null ? '' : String(o.global_cap_usd)), [o.global_cap_usd]);
  const cap = o.global_cap_usd != null ? o.global_cap_usd * 1_000_000 : null;
  const pct = cap ? Math.min(100, (o.global_month_cost / cap) * 100) : 0;
  const save = async (usd: number | null) => { await api('/admin/global-cap', { method: 'PUT', body: { usd } }); onSaved(); };
  const n = Number(v);
  return (
    <div className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Business-wide AI limit</h2>
        <span className="small muted">this month: <strong>{money(o.global_month_cost)}</strong>{cap != null && <> of {money(cap)} ({Math.round(pct)}%)</>}</span>
      </div>
      {cap != null
        ? <div className={`biz-bar ${pct >= 100 ? 'over' : pct >= 80 ? 'warn' : ''}`}><span style={{ width: `${pct}%` }} /></div>
        : <p className="small muted">No limit — total AI cost is uncapped.</p>}
      <p className="small muted">When total AI cost this month (all customers, including comped) reaches this, every account’s AI work pauses until the 1st.</p>
      <div className="biz-inline">
        <span className="biz-money-input"><input type="number" min={1} step={1} value={v} onChange={(e) => setV(e.target.value)} placeholder="No limit" /></span>
        <Btn className="primary" disabled={!(n > 0)} done="Limit saved" onClick={() => save(n)}>Save</Btn>
        {cap != null && <Btn done="Limit removed" onClick={async () => { await save(null); setV(''); }}>No limit</Btn>}
      </div>
    </div>
  );
}

function Users({ list, error, onChange }: { list: AdminUser[] | null; error: string | null; onChange: () => void }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState<Filter>('all');
  const toast = useToast();
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list ?? []).filter((u) =>
      (f === 'all' || u.status === f || u.plan === f) &&
      (!s || [u.email, u.name, u.referred_by_email ?? ''].some((x) => x.toLowerCase().includes(s))));
  }, [list, q, f]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: list?.length ?? 0 };
    for (const u of list ?? []) { c[u.status] = (c[u.status] ?? 0) + 1; c[u.plan] = (c[u.plan] ?? 0) + 1; }
    return c;
  }, [list]);

  const patch = async (u: AdminUser, b: Record<string, unknown>, msg: string) => {
    await api(`/admin/users/${u.id}`, { method: 'PATCH', body: b });
    toast(msg);
    onChange();
  };
  const credit = async (u: AdminUser) => {
    const a = window.prompt(`Add credit for ${u.email} (current balance ${money(u.balance_micro)}).\nDollars — use a negative number to remove, e.g. -5`, '5');
    if (a === null) return;
    const n = Number(a);
    if (!Number.isFinite(n) || n === 0) { toast('Enter a dollar amount like 5 or -5', true); return; }
    const note = window.prompt('Note (shows in their credit history)', n > 0 ? 'Credit from Next Chapter' : 'Credit correction');
    if (note === null) return;
    await patch(u, { credit_usd: n, note: note.trim() || undefined }, `${n > 0 ? 'Added' : 'Removed'} ${money(Math.abs(n) * 1e6)} ${n > 0 ? 'to' : 'from'} ${u.email}`);
  };
  const cap = async (u: AdminUser) => {
    const cur = u.monthly_cap_micro == null ? '' : String(u.monthly_cap_micro / 1e6);
    const a = window.prompt(`Monthly cap for ${u.email} in dollars — ${u.plan === 'free' ? 'applies to AI cost (comped account)' : 'applies to what they’re charged'}.\nLeave empty for no cap.`, cur);
    if (a === null) return;
    const n = a.trim() === '' ? null : Number(a);
    if (n !== null && (!Number.isFinite(n) || n < 0)) { toast('Enter a dollar amount, or leave it empty', true); return; }
    await patch(u, { monthly_cap_usd: n }, n ? `Cap set to ${money(n * 1e6)}/month` : 'Cap removed');
  };

  return (
    <>
      <div className="section"><h2>Customers</h2><span className="muted small">{rows.length} shown</span></div>
      {(counts.waitlist ?? 0) > 0 && f !== 'waitlist' && (
        <div className="card warn row between" style={{ padding: '.6rem 1rem' }}>
          <span>⏳ <strong>{counts.waitlist}</strong> {counts.waitlist === 1 ? 'person is' : 'people are'} on the waitlist, waiting for you to approve them.</span>
          <button onClick={() => setF('waitlist')}>Show them</button>
        </div>
      )}
      <div className="row" style={{ marginBottom: '.75rem' }}>
        <input className="biz-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" />
        <div className="row" style={{ gap: '.35rem' }}>
          {(Object.keys(FILTERS) as Filter[]).map((k) => (
            <button key={k} className={`chip ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>
              {FILTERS[k]} {counts[k] ? <span className="muted" style={f === k ? { color: '#fff' } : undefined}>({counts[k]})</span> : null}
            </button>
          ))}
        </div>
      </div>
      {error && !list ? <ErrorBox error={error} /> : !list ? <Loading /> : (
        <div className="card biz-table-wrap" style={{ padding: '.4rem .5rem' }}>
          <table className="biz-table">
            <thead>
              <tr>
                <th>Customer</th><th>Plan / status</th><th className="num">Balance</th><th className="num">This month<div className="sub">cost / charge · cap</div></th>
                <th className="num">Referrals<div className="sub">unpaid earnings</div></th><th>Last login</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="empty">No customers match.</td></tr>}
              {rows.map((u) => (
                <tr key={u.id} className={u.status === 'waitlist' ? 'waiting' : u.status === 'suspended' ? 'suspended' : ''}>
                  <td className="who">
                    <strong>{u.name}</strong> {!!u.is_admin && <span className="badge biz-admin-b">admin</span>}
                    <div className="small">{u.email}</div>
                    <div className="small muted">joined {when(u.created_at)}{u.referred_by_email && <> · via {u.referred_by_email}</>}</div>
                  </td>
                  <td>
                    <div className="biz-badges">
                      <span className={`badge ${u.plan === 'free' ? 'biz-free-b' : 'biz-paid-b'}`}>{u.plan === 'free' ? 'Comped' : 'Paid'}</span>
                      {u.status === 'waitlist' && <span className="badge biz-wait">⏳ Waitlist</span>}
                      {u.status === 'active' && <span className="badge won">Active</span>}
                      {u.status === 'suspended' && <span className="badge biz-susp">Suspended</span>}
                    </div>
                  </td>
                  <td className="num" style={u.plan === 'paid' && u.status === 'active' && u.balance_micro <= 1e6 ? { color: 'var(--bad)' } : undefined}>{u.plan === 'free' ? <span className="muted">—</span> : money(u.balance_micro)}</td>
                  <td className="num">
                    {money(u.month_cost)}<div className="small muted">{money(u.month_charge)}</div>
                    {u.monthly_cap_micro != null && <div className="small muted">cap {money(u.monthly_cap_micro)}</div>}
                  </td>
                  <td className="num">{u.referrals || <span className="muted">0</span>}{u.earnings_unpaid ? <div className="small muted">{money(u.earnings_unpaid)}{u.connect_ready ? ' · bank ✓' : ''}</div> : null}</td>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{u.last_login_at ? when(u.last_login_at) : <span className="muted">never</span>}</td>
                  <td>
                    <div className="biz-actions">
                      {u.status === 'waitlist' && <Btn className="primary" busyText="…" onClick={() => patch(u, { status: 'active' }, `Approved ${u.email}`)}>✓ Approve</Btn>}
                      {u.status === 'active' && <Btn className="danger" busyText="…" onClick={async () => { if (window.confirm(`Suspend ${u.email}? Their AI work stops.`)) await patch(u, { status: 'suspended' }, `Suspended ${u.email}`); }}>Suspend</Btn>}
                      {u.status === 'suspended' && <Btn busyText="…" onClick={() => patch(u, { status: 'active' }, `Reactivated ${u.email}`)}>Reactivate</Btn>}
                      {u.status === 'active' && <Btn busyText="…" title="Move back to the waitlist" onClick={() => patch(u, { status: 'waitlist' }, `${u.email} moved to the waitlist`)}>Waitlist</Btn>}
                      <Btn busyText="…" title={u.plan === 'paid' ? 'Make this account free — the business pays its AI cost' : 'Make this account pay for its own usage'}
                        onClick={async () => { if (window.confirm(u.plan === 'paid' ? `Comp ${u.email}? Their AI use becomes free (you pay the cost).` : `Make ${u.email} a paying account?`)) await patch(u, { plan: u.plan === 'paid' ? 'free' : 'paid' }, u.plan === 'paid' ? `${u.email} is now comped` : `${u.email} now pays`); }}>
                        {u.plan === 'paid' ? '🎁 Comp' : '$ Paid'}
                      </Btn>
                      <Btn busyText="…" onClick={() => credit(u)}>± Credit</Btn>
                      <Btn busyText="…" onClick={() => cap(u)}>Cap</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
