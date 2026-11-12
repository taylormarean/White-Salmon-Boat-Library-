import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Btn, ErrorBox, Loading, useLoad, useToast } from '../ui';
import './business.css';

interface BillingData {
  plan: 'paid' | 'free';
  balance_micro: number;
  month: { cost: number; charge: number };
  monthly_cap_micro: number | null;
  multiplier: number;
  packs: number[];
  payments: boolean;
  usage: { purpose: string; calls: number; charge: number | null; cost: number | null }[];
  purchases: { amount_micro: number; status: 'paid' | 'refunded' | 'adjustment' | string; note: string | null; created_at: string }[];
}

/** Micro-dollars → "$12.50" (plain cents for customers; tiny non-zero amounts say "under 1¢", not $0.00). */
function money(micro: number | null | undefined): string {
  const v = (micro ?? 0) / 1_000_000;
  if (v !== 0 && Math.abs(v) < 0.005) return v < 0 ? '−$0.01' : 'under 1¢';
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function day(s: string): string {
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
const times = (m: number) => `${Number.isInteger(m) ? m : m.toFixed(1)}×`;

const PURCHASE: Record<string, string> = { paid: 'You added credit', refunded: 'Refunded' };

export default function Billing() {
  const b = useLoad<BillingData>('/billing');
  const toast = useToast();
  const paid = /[?&]paid=1\b/.test(window.location.hash);
  const [waiting, setWaiting] = useState(paid);
  const start = useRef<number | null>(null);
  const arrived = useRef(false);

  // Back from Stripe: the webhook usually lands within a few seconds. Poll until the balance moves (max 30s).
  useEffect(() => {
    if (!paid) return;
    const t0 = Date.now();
    const id = setInterval(() => {
      if (arrived.current || Date.now() - t0 > 30_000) { clearInterval(id); setWaiting(false); return; }
      b.reload();
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!paid || !b.data) return;
    if (start.current === null) { start.current = b.data.balance_micro; return; }
    if (b.data.balance_micro !== start.current && !arrived.current) {
      arrived.current = true;
      setWaiting(false);
      toast(`Your credit is here — balance is now ${money(b.data.balance_micro)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.data]);

  if (b.error && !b.data) return <ErrorBox error={b.error} />;
  if (!b.data) return <Loading />;
  const d = b.data;
  const free = d.plan === 'free';
  const low = d.balance_micro <= 1_000_000;

  return (
    <div className="biz">
      <h1>Billing</h1>
      <p className="muted">Your credit, what you’ve used, and how pricing works.</p>

      {paid && (
        <div className="card biz-thanks" role="status">
          <h2>Thanks! 🎉</h2>
          {waiting
            ? <p><span className="spinner" /> Your credit will appear in a moment…</p>
            : <p>Your payment went through. If your new balance isn’t showing yet, give it a minute and refresh this page.</p>}
        </div>
      )}

      {free && (
        <div className="card biz-free">
          <h2>Your account is on the house 🎉</h2>
          <p style={{ marginBottom: 0 }}>No need to add credit — we cover the cost of everything the helper does for you.</p>
        </div>
      )}

      <div className="biz-hero">
        {!free && (
          <div className={`card ${low ? 'biz-low' : ''}`}>
            <div className="biz-label">Your credit</div>
            <div className={`biz-big ${low ? 'low' : ''}`}>{money(d.balance_micro)}</div>
            <div className="small muted">
              {d.balance_micro <= 0 ? 'The helper is paused until you add credit.' : low ? (d.payments ? 'Running low — add some below to keep things going.' : 'Running low.') : 'Left to spend'}
            </div>
          </div>
        )}
        <div className="card">
          <div className="biz-label">{free ? 'AI used this month' : 'Spent this month'}</div>
          <div className="biz-big">{money(free ? d.month.cost : d.month.charge)}</div>
          <div className="small muted">{free ? 'Covered by us — you pay nothing' : 'Since the 1st of the month'}</div>
        </div>
        {d.monthly_cap_micro != null && <CapMeter used={free ? d.month.cost : d.month.charge} cap={d.monthly_cap_micro} free={free} />}
      </div>

      {!free && (
        <>
          <div className="section"><h2>Add credit</h2></div>
          <div className="card">
            {d.payments ? (
              <>
                <p>Pick an amount. You’ll pay securely with a card on the next screen (Stripe), then come right back here.</p>
                <div className="biz-packs">
                  {d.packs.map((amt) => (
                    <Btn key={amt} className={amt === 25 ? 'primary' : ''} busyText="Opening…"
                      onClick={async () => {
                        const r = await api<{ url: string }>('/billing/checkout', { body: { amount: amt } });
                        window.location.href = r.url;
                      }}>
                      ${amt}
                      <span className="small">Add ${amt}</span>
                    </Btn>
                  ))}
                </div>
              </>
            ) : (
              <p style={{ margin: 0 }}><strong>Payments aren’t set up yet.</strong> <span className="muted">Card payments will be available soon.</span></p>
            )}
          </div>

          <div className="section"><h2>How pricing works</h2></div>
          <div className="card">
            <p><strong>You pay for what the AI does — {times(d.multiplier)} our cost, no subscription.</strong></p>
            <ul className="biz-steps">
              <li>Every time the helper reads a job, writes a letter, or drafts an email, it uses a little AI. Most tasks cost a few cents.</li>
              <li>We charge you {times(d.multiplier)} what that AI costs us. That’s how we keep the lights on.</li>
              <li>There’s no monthly fee. Your credit stays in your account until you use it.</li>
              <li>If your credit runs out, the helper simply pauses — nothing is charged to your card.</li>
            </ul>
          </div>

          <CapEditor cap={d.monthly_cap_micro} onSaved={b.reload} />
        </>
      )}

      <div className="section"><h2>What the AI did</h2><span className="muted small">last 30 days</span></div>
      <UsageTable usage={d.usage} free={free} />

      {d.purchases.length > 0 && (
        <>
          <div className="section"><h2>Credit history</h2></div>
          <div className="card biz-table-wrap">
            <table className="biz-table">
              <thead><tr><th>Date</th><th>What</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {d.purchases.map((p, i) => (
                  <tr key={i}>
                    <td>{day(p.created_at)}</td>
                    <td>{p.status === 'adjustment' ? (p.amount_micro >= 0 ? 'Credit from us 🎁' : 'Correction') : PURCHASE[p.status] ?? p.status}{p.note && p.status !== 'paid' && <div className="small muted">{p.note}</div>}</td>
                    <td className="num">{money(p.status === 'refunded' ? -Math.abs(p.amount_micro) : p.amount_micro)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function CapMeter({ used, cap, free }: { used: number; cap: number; free: boolean }) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 100;
  return (
    <div className="card">
      <div className="biz-label">Monthly limit</div>
      <div className="biz-mid">{money(used)} <span className="muted" style={{ fontWeight: 500, fontSize: '1rem' }}>of {money(cap)}</span></div>
      <div className={`biz-bar ${pct >= 100 ? 'over' : pct >= 80 ? 'warn' : ''}`}><span style={{ width: `${pct}%` }} /></div>
      <div className="small muted">{pct >= 100 ? (free ? 'Reached — the helper picks back up on the 1st.' : 'Reached — the helper is paused until the 1st, or raise your limit.') : 'Resets on the 1st of each month'}</div>
    </div>
  );
}

function CapEditor({ cap, onSaved }: { cap: number | null; onSaved: () => void }) {
  const [v, setV] = useState(cap == null ? '' : String(cap / 1_000_000));
  useEffect(() => setV(cap == null ? '' : String(cap / 1_000_000)), [cap]);
  const save = async (val: number | null) => {
    await api('/billing/cap', { method: 'PUT', body: { cap_usd: val } });
    onSaved();
  };
  const num = Number(v);
  const valid = v.trim() !== '' && Number.isFinite(num) && num > 0;
  return (
    <>
      <div className="section"><h2>Monthly spending limit</h2></div>
      <div className="card">
        <p>Set the most you want to spend in a month. When you reach it, the helper <strong>pauses its AI work</strong> until the 1st of the next month. (A task that’s already running still finishes, so you might go a few cents over.)</p>
        <p className="small muted">Right now: {cap == null ? <strong>No limit</strong> : <strong>{money(cap)} a month</strong>}</p>
        <label htmlFor="biz-cap">Limit per month <span className="hint">in dollars, e.g. 20</span></label>
        <div className="biz-inline">
          <span className="biz-money-input"><input id="biz-cap" type="number" inputMode="decimal" min={1} step={1} value={v} onChange={(e) => setV(e.target.value)} placeholder="No limit" /></span>
          <Btn className="primary big" disabled={!valid} done="Limit saved" onClick={() => save(num)}>Save limit</Btn>
          {cap != null && <Btn className="big" done="Limit removed" onClick={async () => { await save(null); setV(''); }}>No limit</Btn>}
        </div>
      </div>
    </>
  );
}

function UsageTable({ usage, free }: { usage: BillingData['usage']; free: boolean }) {
  if (!usage.length) return <div className="card empty">Nothing yet — the helper hasn’t used any AI in the last 30 days.</div>;
  const amt = (u: BillingData['usage'][number]) => (free ? u.cost : u.charge) ?? 0;
  const rows = [...usage].sort((a, b) => amt(b) - amt(a));
  const total = rows.reduce((n, u) => n + amt(u), 0);
  const calls = rows.reduce((n, u) => n + u.calls, 0);
  return (
    <div className="card biz-table-wrap">
      <table className="biz-table">
        <thead><tr><th>What it did</th><th className="num">Times</th><th className="num">{free ? 'AI cost (covered)' : 'Cost to you'}</th></tr></thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.purpose}><td>{u.purpose}</td><td className="num">{u.calls}</td><td className="num">{money(amt(u))}</td></tr>
          ))}
        </tbody>
        <tfoot><tr><td>Total</td><td className="num">{calls}</td><td className="num">{money(total)}</td></tr></tfoot>
      </table>
    </div>
  );
}
