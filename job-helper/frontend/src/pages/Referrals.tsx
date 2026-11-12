import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Btn, ErrorBox, Loading, useLoad, useToast } from '../ui';
import './business.css';

interface ReferralData {
  code: string;
  link: string;
  share: number;
  multiplier: number;
  pending: number;
  available: number;
  paid: number;
  referrals: number;
  people: { name: string; joined: string; status: string; earned_micro: number }[];
  payouts: { amount_micro: number; status: 'pending' | 'paid' | 'failed' | string; error: string | null; created_at: string }[];
  payouts_enabled: boolean;
  connect: { started: boolean; ready: boolean };
  min_payout_usd: number;
  hold_days: number;
}

function money(micro: number | null | undefined): string {
  const v = (micro ?? 0) / 1_000_000;
  if (v !== 0 && Math.abs(v) < 0.005) return v < 0 ? '−$0.01' : 'under 1¢';
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function day(s: string): string {
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
const pct = (x: number) => `${Math.round(x * 100)}%`;
const times = (m: number) => `${Number.isInteger(m) ? m : m.toFixed(1)}×`;
const cents = (c: number) => (Number.isInteger(c) ? `${c}¢` : `${c.toFixed(1)}¢`);

const PERSON: Record<string, [string, string]> = {
  active: ['Using the app', 'won'],
  waitlist: ['On the waitlist', 'following_up'],
  suspended: ['Paused', ''],
};
const PAYOUT: Record<string, [string, string]> = {
  paid: ['Sent to your bank', 'won'],
  pending: ['On its way', 'interviewing'],
  failed: ['Didn’t go through', 'rejected'],
};

export default function Referrals() {
  const r = useLoad<ReferralData>('/referrals');
  const toast = useToast();
  const [checking, setChecking] = useState(false);
  const ran = useRef(false);
  const connectParam = window.location.hash.match(/[?&]connect=(\w+)/)?.[1] ?? null;

  // Back from Stripe's payout setup: ask the server to re-check the account, then reload.
  useEffect(() => {
    if (ran.current || !connectParam) return;
    ran.current = true;
    history.replaceState(null, '', '#/referrals');
    if (connectParam === 'done') {
      setChecking(true);
      api<{ ready: boolean }>('/referrals/connect/refresh', { method: 'POST' })
        .then((x) => toast(x.ready ? 'Payouts are set up ✅' : 'Thanks! Stripe still needs a little more information from you.', !x.ready))
        .catch((e) => toast(e instanceof Error ? e.message : String(e), true))
        .finally(() => { setChecking(false); r.reload(); });
    } else if (connectParam === 'retry') {
      toast('That setup link expired — tap “Set up payouts” to pick up where you left off.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (r.error && !r.data) return <ErrorBox error={r.error} />;
  if (!r.data) return <Loading />;
  const d = r.data;
  // Worked example per 10¢ of AI: they pay multiplier × 10¢; the profit is the difference; you get share of it.
  const youGet = d.share * (d.multiplier - 1) * 10;

  return (
    <div className="biz">
      <h1>Invite friends</h1>
      <p className="muted">Know someone else looking for work? Share your link.</p>

      <div className="card hl">
        <h2>Your link</h2>
        <ShareLink link={d.link} />
        <p style={{ marginTop: '1rem' }}>
          <strong>When someone signs up with your link, you earn {d.share === 0.5 ? 'half' : pct(d.share)} of the profit from what they use — paid to your bank monthly.</strong>
        </p>
        <ul className="biz-steps">
          <li>They pay {times(d.multiplier)} the AI cost for what their helper does; you get {pct(d.share)} of the difference.</li>
          <li>For example: if a task uses 10¢ of AI, they pay {cents(d.multiplier * 10)}, and you earn {cents(youGet)}.</li>
          <li>You only earn while they’re paying for their own use. It never costs them anything extra.</li>
        </ul>
        <p className="small muted" style={{ marginBottom: 0 }}>
          How much you earn depends entirely on how much they use the app — for most people it’s a small amount. This isn’t a job or a guaranteed income.
        </p>
      </div>

      <div className="section"><h2>Your earnings</h2></div>
      <div className="biz-hero">
        <div className="card">
          <div className="biz-label">Waiting</div>
          <div className="biz-mid">{money(d.pending)}</div>
          <div className="small muted">Held for {d.hold_days} days in case of refunds, then it becomes available.</div>
        </div>
        <div className="card">
          <div className="biz-label">Available</div>
          <div className={`biz-mid ${d.available > 0 ? 'good' : ''}`}>{money(d.available)}</div>
          <div className="small muted">Ready for the next payout (once it reaches ${d.min_payout_usd}).</div>
        </div>
        <div className="card">
          <div className="biz-label">Paid to you so far</div>
          <div className="biz-mid">{money(d.paid)}</div>
          <div className="small muted">{d.referrals === 1 ? '1 person' : `${d.referrals} people`} you invited {d.referrals === 1 ? 'is' : 'are'} using the app.</div>
        </div>
      </div>

      <div className="section"><h2>Getting paid</h2></div>
      <PayoutSetup d={d} checking={checking} />

      <div className="section"><h2>People you invited</h2></div>
      {d.people.length === 0 ? (
        <div className="card empty">No one yet. When someone signs up with your link, they’ll show up here.</div>
      ) : (
        <div className="card biz-table-wrap">
          <table className="biz-table">
            <thead><tr><th>Name</th><th>Joined</th><th>Status</th><th className="num">You earned</th></tr></thead>
            <tbody>
              {d.people.map((p, i) => {
                const [label, cls] = PERSON[p.status] ?? [p.status, ''];
                return (
                  <tr key={i}>
                    <td><strong>{p.name}</strong></td>
                    <td>{day(p.joined)}</td>
                    <td><span className={`badge ${cls}`}>{label}</span></td>
                    <td className="num">{money(p.earned_micro)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {d.payouts.length > 0 && (
        <>
          <div className="section"><h2>Payouts</h2></div>
          <div className="card biz-table-wrap">
            <table className="biz-table">
              <thead><tr><th>Date</th><th>Status</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {d.payouts.map((p, i) => {
                  const [label, cls] = PAYOUT[p.status] ?? [p.status, ''];
                  return (
                    <tr key={i}>
                      <td>{day(p.created_at)}</td>
                      <td>
                        <span className={`badge ${cls}`}>{label}</span>
                        {p.status === 'failed' && <div className="small muted">We’ll try again next month.{p.error ? ` (${p.error})` : ''}</div>}
                      </td>
                      <td className="num">{money(p.amount_micro)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ShareLink({ link }: { link: string }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      input.current?.select();
      document.execCommand('copy');
    }
    toast('Link copied — paste it into an email or text message');
  };
  return (
    <div className="biz-link">
      <input ref={input} readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Your invite link" />
      <button className="primary big" onClick={copy}>📋 Copy link</button>
      {canShare && (
        <button className="big" onClick={() => navigator.share({
          title: 'Next Chapter',
          text: 'I’ve been using Next Chapter to help with my job search — it finds jobs and helps write applications. Try it:',
          url: link,
        }).catch(() => { /* closed the share sheet */ })}>📤 Share…</button>
      )}
    </div>
  );
}

function PayoutSetup({ d, checking }: { d: ReferralData; checking: boolean }) {
  if (checking) return <div className="card"><span className="spinner" /> Checking your payout setup with Stripe…</div>;
  if (!d.payouts_enabled) {
    return (
      <div className="card">
        <p style={{ margin: 0 }}><strong>Payouts aren’t set up yet.</strong> <span className="muted">Your earnings are still being counted and will be paid once cash payouts are turned on.</span></p>
      </div>
    );
  }
  const connect = async () => {
    const x = await api<{ url: string }>('/referrals/connect', { method: 'POST' });
    window.location.href = x.url;
  };
  if (!d.connect.started || !d.connect.ready) {
    return (
      <div className="card">
        {d.connect.started
          ? <p><strong>You’re almost there.</strong> Stripe needs a little more information before it can send you money.</p>
          : <p>To get your earnings as cash, tell us where to send them. Our payment partner, <strong>Stripe</strong>, handles this securely — we never see your bank details.</p>}
        <p className="small muted">Stripe will ask a few questions to confirm who you are (like your date of birth and part of your Social Security number) and for your bank account. They may also collect tax information. It takes a few minutes.</p>
        <Btn className="primary big" busyText="Opening Stripe…" onClick={connect}>{d.connect.started ? 'Finish setting up payouts' : '🏦 Set up payouts'}</Btn>
      </div>
    );
  }
  const view = async () => {
    // Open the tab now (while the click still counts as a click) so pop-up blockers allow it.
    const w = window.open('', '_blank');
    try {
      const x = await api<{ url: string }>('/referrals/dashboard');
      if (w) { w.opener = null; w.location.href = x.url; } else window.location.href = x.url;
    } catch (e) {
      w?.close();
      throw e;
    }
  };
  return (
    <div className="card">
      <p><span className="badge won">✓ Payouts are set up</span></p>
      <p>Payouts go to your bank on the 1st of each month once you have at least ${d.min_payout_usd} available.</p>
      <Btn className="big" busyText="Opening…" onClick={view}>View payouts</Btn>
    </div>
  );
}
