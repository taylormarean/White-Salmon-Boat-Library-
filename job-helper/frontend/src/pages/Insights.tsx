import { ErrorBox, Loading, useLoad } from '../ui';

interface Row { applied: number; replied: number; interviews: number }
interface Insights {
  week: { found: number; recommended: number; liked: number; passed: number; drafted: number; sent: number; followUps: number; replies: number; interviews: number; offers: number };
  total: { applied: number; replied: number; interviews: number; offers: number; won: number; responseRate: number; interviewRate: number };
  bySource: (Row & { source: string })[];
  byRole: (Row & { role: string })[];
  spendMonthMicro: number;
}

const SOURCE: Record<string, string> = { remotive: 'Remotive', remoteok: 'RemoteOK', himalayas: 'Himalayas', adzuna: 'Adzuna (local)', usajobs: 'USAJobs', greenhouse: 'Company sites', lever: 'Company sites', rss: 'Job feeds', web_scout: 'Web search (local)', manual: 'Jobs you added' };

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div style={{ background: 'var(--line)', borderRadius: 99, height: 10, minWidth: 80 }}>
      <div style={{ width: `${max ? Math.round((value / max) * 100) : 0}%`, background: 'var(--brand)', height: 10, borderRadius: 99 }} />
    </div>
  );
}

function Table({ rows, label }: { rows: (Row & { name: string })[]; label: string }) {
  if (!rows.length) return <p className="small muted">Nothing yet — this fills in as you apply.</p>;
  const max = Math.max(...rows.map((r) => r.applied));
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr className="small muted" style={{ textAlign: 'left' }}><th>{label}</th><th>Applied</th><th>Replies</th><th>Interviews</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} style={{ borderTop: '1px solid var(--line)' }}>
            <td style={{ padding: '.45rem .3rem' }}>{r.name}</td><td>{r.applied}</td><td>{r.replied}</td><td>{r.interviews}</td>
            <td style={{ width: '30%' }}><Bar value={r.applied} max={max} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Insights() {
  const { data, error } = useLoad<Insights>('/insights');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const w = data.week;
  const t = data.total;
  const stat = (n: number, label: string) => (
    <div className="card" style={{ textAlign: 'center', marginBottom: 0 }}>
      <div style={{ fontSize: '1.9rem', fontWeight: 800 }}>{n}</div>
      <div className="small muted">{label}</div>
    </div>
  );
  return (
    <div>
      <h1>Your progress</h1>
      <p className="muted">Job searching is a numbers game — these show what’s working so you can do more of it.</p>

      <div className="section"><h2>This week</h2></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '.75rem' }}>
        {stat(w.found, 'jobs found')}{stat(w.recommended, 'recommended')}{stat(w.liked, 'you liked 👍')}{stat(w.sent, 'applications sent')}
        {stat(w.followUps, 'follow-ups')}{stat(w.replies, 'replies')}{stat(w.interviews, 'interviews')}{stat(w.offers, 'offers')}
      </div>

      <div className="section"><h2>So far</h2></div>
      <div className="card">
        <p style={{ fontSize: '1.1rem' }}>
          <strong>{t.applied}</strong> applications sent · <strong>{t.responseRate}%</strong> got a reply · <strong>{t.interviewRate}%</strong> led to an interview
          {t.offers ? <> · <strong>{t.offers}</strong> offer{t.offers === 1 ? '' : 's'} 🎉</> : null}
        </p>
        <p className="small muted">For most people, 2–10% of applications turn into interviews. Tailored applications and follow-ups — which the app does for you — move that number up.</p>
      </div>

      <div className="grid2">
        <div className="card"><h3>Which kinds of jobs answer</h3><Table rows={data.byRole.map((r) => ({ ...r, name: r.role }))} label="Role" /></div>
        <div className="card"><h3>Where your best leads come from</h3><Table rows={data.bySource.map((r) => ({ ...r, name: SOURCE[r.source] ?? r.source }))} label="Source" /></div>
      </div>
      <p className="small muted">AI used this month: ${(data.spendMonthMicro / 1e6).toFixed(2)} · <a href="#/billing">Credit & billing</a></p>
    </div>
  );
}
