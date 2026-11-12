import { useEffect, useState } from 'react';
import { api } from '../api';
import { Btn, ErrorBox, Loading, useLoad, useToast, when } from '../ui';

interface Prefs {
  name: string; email: string; phone: string; home_location: string; radius_miles: number; target_roles: string[]; exclude_keywords: string[];
  min_salary: number | null; want_remote: boolean; want_local: boolean; wishes: string;
  sources: { remotive: boolean; remoteok: boolean; himalayas: boolean; adzuna: boolean; usajobs: boolean; web_scout: boolean; greenhouse_boards: string[]; lever_sites: string[]; rss_feeds: string[] };
  autopilot: { daily_search: boolean; daily_hour: number; max_scores_per_run: number; auto_prepare_threshold: number; auto_send_applications: boolean; auto_send_follow_ups: boolean; follow_up_days: number[]; close_after_days: number; interview_check_in_days: number; daily_digest: boolean };
}
interface Status { ai: boolean; mock_ai: boolean; model: string; gmail: { configured: boolean; connected: boolean; email: string | null }; sources: { adzuna: boolean; usajobs: boolean }; last_search: { at: string; report: { source: string; found: number; error?: string }[]; added: number; screenedOut: number; scored: number; prepared: number } | null }

const lines = (a: string[]) => a.join('\n');
const unlines = (s: string) => s.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

export default function Settings({ query }: { query: URLSearchParams }) {
  const prefs = useLoad<Prefs>('/prefs');
  const status = useLoad<Status>('/status');
  const activity = useLoad<{ id: number; kind: string; message: string; created_at: string }[]>('/activity');
  const toast = useToast();
  const [p, setP] = useState<Prefs | null>(null);
  useEffect(() => { if (prefs.data) setP(prefs.data); }, [prefs.data]);
  useEffect(() => {
    const g = query.get('gmail');
    if (g === 'connected') toast('Gmail connected ✅');
    if (g === 'error') toast(`Gmail didn’t connect: ${query.get('reason') ?? 'unknown error'}`, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (prefs.error) return <ErrorBox error={prefs.error} />;
  if (!p || !status.data) return <Loading />;
  const s = status.data;
  const set = (patch: Partial<Prefs>) => setP({ ...p, ...patch });
  const src = (patch: Partial<Prefs['sources']>) => setP({ ...p, sources: { ...p.sources, ...patch } });
  const auto = (patch: Partial<Prefs['autopilot']>) => setP({ ...p, autopilot: { ...p.autopilot, ...patch } });
  const save = async () => { const r = await api<Prefs>('/prefs', { method: 'PUT', body: p }); setP(r); };

  return (
    <div>
      <h1>Settings</h1>

      <div className="section"><h2>About you</h2></div>
      <div className="card">
        <div className="grid2">
          <div><label>Your name <span className="hint">as it should appear on applications</span></label><input value={p.name} onChange={(e) => set({ name: e.target.value })} /></div>
          <div><label>Phone</label><input value={p.phone} onChange={(e) => set({ phone: e.target.value })} /></div>
          <div><label>Email</label><input value={p.email} onChange={(e) => set({ email: e.target.value })} /></div>
          <div><label>Where you live <span className="hint">town and state, e.g. “White Salmon, WA”</span></label><input value={p.home_location} onChange={(e) => set({ home_location: e.target.value })} /></div>
        </div>
      </div>

      <div className="section"><h2>What you’re looking for</h2></div>
      <div className="card">
        <div className="grid2">
          <div>
            <label>Kinds of jobs <span className="hint">one per line — e.g. office manager, receptionist, bookkeeper</span></label>
            <textarea rows={5} value={lines(p.target_roles)} onChange={(e) => set({ target_roles: unlines(e.target.value) })} />
          </div>
          <div>
            <label>Never show jobs that mention <span className="hint">one per line — e.g. commission only, night shift</span></label>
            <textarea rows={5} value={lines(p.exclude_keywords)} onChange={(e) => set({ exclude_keywords: unlines(e.target.value) })} />
          </div>
        </div>
        <div className="grid2">
          <div>
            <label className="check"><input type="checkbox" checked={p.want_local} onChange={(e) => set({ want_local: e.target.checked })} /> In-person or hybrid jobs near me</label>
            <label className="check"><input type="checkbox" checked={p.want_remote} onChange={(e) => set({ want_remote: e.target.checked })} /> Work-from-home jobs</label>
          </div>
          <div className="row">
            <div className="grow"><label>How far will you drive? <span className="hint">miles</span></label><input type="number" min={1} max={200} value={p.radius_miles} onChange={(e) => set({ radius_miles: Number(e.target.value) })} /></div>
            <div className="grow"><label>Lowest yearly pay <span className="hint">optional — $20/hr ≈ $41,600</span></label><input type="number" value={p.min_salary ?? ''} onChange={(e) => set({ min_salary: e.target.value ? Number(e.target.value) : null })} /></div>
          </div>
        </div>
        <label>Anything else, in your own words <span className="hint">e.g. “Part-time is fine. No weekends. I love working with kids.”</span></label>
        <textarea rows={3} value={p.wishes} onChange={(e) => set({ wishes: e.target.value })} />
      </div>

      <div className="section"><h2>Gmail</h2></div>
      <div className="card">
        {!s.gmail.configured ? (
          <p className="muted">Gmail isn’t set up on the server yet (whoever installed the app needs to add the Google keys — see the README).</p>
        ) : s.gmail.connected ? (
          <div className="row between">
            <span>✅ Connected as <strong>{s.gmail.email}</strong>. Applications and follow-ups are sent from this address, and the app watches it for replies.</span>
            <Btn className="ghost danger" onClick={async () => { await api('/google/disconnect', { method: 'POST' }); status.reload(); }}>Disconnect</Btn>
          </div>
        ) : (
          <div className="row between">
            <span>Connect your Gmail so the app can send applications for you and notice when employers write back.</span>
            <Btn className="primary" onClick={async () => { const r = await api<{ url: string }>('/google/start'); window.location.href = r.url; }}>Connect Gmail</Btn>
          </div>
        )}
      </div>

      <div className="section"><h2>Autopilot</h2><span className="small muted">How much the app does on its own</span></div>
      <div className="card">
        <label className="check"><input type="checkbox" checked={p.autopilot.daily_search} onChange={(e) => auto({ daily_search: e.target.checked })} />
          <span>Look for new jobs every morning at <input type="number" min={0} max={23} value={p.autopilot.daily_hour} onChange={(e) => auto({ daily_hour: Number(e.target.value) })} style={{ width: '4.5rem', display: 'inline-block' }} /> o’clock (24-hour)</span></label>
        <label className="check"><input type="checkbox" checked={p.autopilot.daily_digest} onChange={(e) => auto({ daily_digest: e.target.checked })} /> Email me a short summary each morning</label>
        <label className="check"><input type="checkbox" checked={p.autopilot.auto_prepare_threshold > 0} onChange={(e) => auto({ auto_prepare_threshold: e.target.checked ? 80 : 0 })} />
          <span>Write a resume and cover letter automatically for jobs that fit at least
            <input type="number" min={50} max={100} disabled={!p.autopilot.auto_prepare_threshold} value={p.autopilot.auto_prepare_threshold || 80} onChange={(e) => auto({ auto_prepare_threshold: Number(e.target.value) })} style={{ width: '4.5rem', display: 'inline-block', margin: '0 .4rem' }} />/ 100</span></label>
        <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '1rem 0' }} />
        <label className="check"><input type="checkbox" checked={p.autopilot.auto_send_follow_ups} onChange={(e) => auto({ auto_send_follow_ups: e.target.checked })} />
          <span>Send follow-up emails without asking me first <span className="hint">They go out on weekdays during business hours. Off means each follow-up waits on the Today page for your OK.</span></span></label>
        <label className="check"><input type="checkbox" checked={p.autopilot.auto_send_applications} onChange={(e) => auto({ auto_send_applications: e.target.checked })} />
          <span>Send email applications without asking me first <span className="hint">Only for jobs above the fit score above. We recommend leaving this off until you trust the drafts.</span></span></label>
        <p className="small muted">Replies to a real person (like an interview request) always wait for your OK.</p>
        <div className="grid2">
          <div><label>Follow up after <span className="hint">days of silence before each follow-up</span></label>
            <input value={p.autopilot.follow_up_days.join(', ')} onChange={(e) => auto({ follow_up_days: unlines(e.target.value).map(Number).filter((n) => n > 0) })} /></div>
          <div><label>Then close it after <span className="hint">more days with no answer</span></label>
            <input type="number" value={p.autopilot.close_after_days} onChange={(e) => auto({ close_after_days: Number(e.target.value) })} /></div>
        </div>
      </div>

      <div className="section"><h2>Where to look</h2></div>
      <div className="card">
        <div className="grid2">
          <div>
            <h3>Local jobs</h3>
            <label className="check"><input type="checkbox" checked={p.sources.web_scout} onChange={(e) => src({ web_scout: e.target.checked })} /> <span>AI web search <span className="hint">city & county pages, schools, hospitals, local papers</span></span></label>
            <label className="check"><input type="checkbox" checked={p.sources.adzuna} onChange={(e) => src({ adzuna: e.target.checked })} disabled={!s.sources.adzuna} /> <span>Adzuna {!s.sources.adzuna && <span className="hint">needs an API key on the server</span>}</span></label>
            <label className="check"><input type="checkbox" checked={p.sources.usajobs} onChange={(e) => src({ usajobs: e.target.checked })} disabled={!s.sources.usajobs} /> <span>USAJobs (government) {!s.sources.usajobs && <span className="hint">needs an API key on the server</span>}</span></label>
          </div>
          <div>
            <h3>Work from home</h3>
            <label className="check"><input type="checkbox" checked={p.sources.remotive} onChange={(e) => src({ remotive: e.target.checked })} /> Remotive</label>
            <label className="check"><input type="checkbox" checked={p.sources.remoteok} onChange={(e) => src({ remoteok: e.target.checked })} /> RemoteOK</label>
            <label className="check"><input type="checkbox" checked={p.sources.himalayas} onChange={(e) => src({ himalayas: e.target.checked })} /> Himalayas</label>
          </div>
        </div>
        <details style={{ marginTop: '.75rem' }}>
          <summary>Specific employers and job feeds (advanced)</summary>
          <label>Greenhouse company boards <span className="hint">the part after boards.greenhouse.io/ — one per line</span></label>
          <textarea rows={3} value={lines(p.sources.greenhouse_boards)} onChange={(e) => src({ greenhouse_boards: unlines(e.target.value) })} />
          <label>Lever company sites <span className="hint">the part after jobs.lever.co/ — one per line</span></label>
          <textarea rows={3} value={lines(p.sources.lever_sites)} onChange={(e) => src({ lever_sites: unlines(e.target.value) })} />
          <label>RSS job feeds <span className="hint">full links, one per line</span></label>
          <textarea rows={3} value={lines(p.sources.rss_feeds)} onChange={(e) => src({ rss_feeds: unlines(e.target.value) })} />
          <label>Most fit checks per day <span className="hint">keeps AI costs predictable</span></label>
          <input type="number" min={5} max={200} value={p.autopilot.max_scores_per_run} onChange={(e) => auto({ max_scores_per_run: Number(e.target.value) })} style={{ maxWidth: 140 }} />
        </details>
        {s.last_search && (
          <details style={{ marginTop: '.75rem' }}>
            <summary>Last search: {when(s.last_search.at)} — {s.last_search.added} new jobs</summary>
            <ul className="small">{s.last_search.report.map((r) => <li key={r.source}>{r.source}: {r.error ? <span style={{ color: 'var(--bad)' }}>problem — {r.error}</span> : `${r.found} found`}</li>)}</ul>
            <p className="small muted">{s.last_search.screenedOut} screened out by your keywords · {s.last_search.scored} fit-checked · {s.last_search.prepared} drafted automatically</p>
          </details>
        )}
      </div>

      <div className="row" style={{ position: 'sticky', bottom: '1rem', marginTop: '1rem' }}>
        <Btn className="primary big" onClick={save} done="Settings saved">💾 Save settings</Btn>
      </div>

      <div className="section"><h2>Behind the scenes</h2></div>
      <div className="card small">
        <p>AI: {s.mock_ai ? '⚠️ test mode (fake answers)' : s.ai ? `✅ ${s.model}` : '❌ not set up — add ANTHROPIC_API_KEY'}</p>
        <details>
          <summary>Recent activity</summary>
          <ul>{(activity.data ?? []).slice(0, 40).map((a) => <li key={a.id}><span className="muted">{when(a.created_at)}</span> — {a.message}</li>)}</ul>
        </details>
      </div>
    </div>
  );
}
