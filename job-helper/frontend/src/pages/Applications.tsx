import { ErrorBox, Loading, StatusBadge, useLoad, when } from '../ui';

interface App { id: number; status: string; title: string; company: string; location: string; fit_score: number; submitted_at: string; last_contact_at: string; updated_at: string; follow_up_count: number; last_event: string; waiting: number; closed_reason: string }

const COLUMNS = [
  { title: 'Getting ready', statuses: ['drafting', 'ready'] },
  { title: 'Applied — waiting', statuses: ['submitted', 'following_up'] },
  { title: 'Talking with them', statuses: ['interviewing', 'offer'] },
  { title: 'Hired 🎉', statuses: ['won'] },
];

export default function Applications() {
  const { data, error } = useLoad<App[]>('/applications');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const done = data.filter((a) => ['rejected', 'closed', 'withdrawn'].includes(a.status));
  const applied = data.filter((a) => a.submitted_at).length;
  const talking = data.filter((a) => ['interviewing', 'offer', 'won'].includes(a.status)).length;

  return (
    <div>
      <h1>Applications</h1>
      <p className="muted">
        {applied} sent so far{talking ? ` · ${talking} turned into conversations` : ''}. The app follows up on each one until you hear back.
      </p>
      {data.length === 0 && <div className="card empty">No applications yet. Open a job and tap “Help me apply”.</div>}
      <div className="pipeline">
        {COLUMNS.map((c) => {
          const items = data.filter((a) => c.statuses.includes(a.status));
          return (
            <div key={c.title} className="col">
              <h3>{c.title} <span className="muted">{items.length}</span></h3>
              {items.map((a) => (
                <a key={a.id} className="mini" href={`#/applications/${a.id}`}>
                  <strong>{a.title}</strong>
                  <div className="small">{a.company}</div>
                  <div className="row small" style={{ marginTop: '.3rem', gap: '.4rem' }}>
                    <StatusBadge s={a.status} />
                    {a.waiting > 0 && <span className="badge poor">needs your OK</span>}
                  </div>
                  <div className="small muted" style={{ marginTop: '.3rem' }}>{a.last_event} · {when(a.updated_at)}</div>
                </a>
              ))}
            </div>
          );
        })}
      </div>
      {done.length > 0 && (
        <details style={{ marginTop: '1.5rem' }}>
          <summary>Closed ({done.length})</summary>
          <div style={{ marginTop: '.75rem' }}>
            {done.map((a) => (
              <a key={a.id} className="mini row" href={`#/applications/${a.id}`}>
                <div className="grow"><strong>{a.title}</strong> — {a.company}<div className="small muted">{a.closed_reason}</div></div>
                <StatusBadge s={a.status} />
              </a>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
