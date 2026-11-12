import { useState } from 'react';
import { api } from '../api';
import type { Me } from '../App';
import { Btn, useLoad, useToast, when } from '../ui';

/** Account-level settings: helpers, test week, text messages, browser-helper key. */
export default function SettingsExtras({ me, reloadMe }: { me: Me; reloadMe: () => void }) {
  const toast = useToast();
  const helpers = useLoad<{ helper_email: string; created_at: string }[]>('/helpers');
  const [invite, setInvite] = useState('');
  const [phone, setPhone] = useState('');
  const [smsOk, setSmsOk] = useState(false);
  const [key, setKey] = useState<string | null>(null);

  return (
    <>
      <div className="section"><h2>Test week</h2></div>
      <div className="card">
        {me.test_mode ? (
          <div className="row between">
            <span>🧪 <strong>Test mode is on</strong> until {new Date(me.test_mode).toLocaleDateString()}. Applications and follow-ups go to <strong>your own inbox</strong> (marked [TEST]) so you can see exactly what employers would get.</span>
            <Btn className="primary" onClick={async () => { if (confirm('Turn off test mode? From now on, approved emails go to employers.')) { await api('/test-mode', { method: 'PUT', body: { on: false } }); reloadMe(); toast('Test mode is off — emails will go to employers.'); } }}>I’m ready — send for real</Btn>
          </div>
        ) : (
          <div className="row between">
            <span>Emails you approve go straight to employers.</span>
            <Btn className="ghost" onClick={async () => { await api('/test-mode', { method: 'PUT', body: { on: true, days: 7 } }); reloadMe(); toast('Test mode on for a week.'); }}>Turn test mode back on for a week</Btn>
          </div>
        )}
      </div>

      {me.is_owner && (
        <>
          <div className="section"><h2>Family & friends who help</h2></div>
          <div className="card">
            <p className="small muted">A helper can see your matches, drafts and applications, approve messages, and get an email if something goes wrong. They sign in with their own Google account using “Sign in as a helper” — their email is never touched.</p>
            {(helpers.data ?? []).map((h) => (
              <div key={h.helper_email} className="row between lesson">
                <span>{h.helper_email} <span className="small muted">· added {when(h.created_at)}</span></span>
                <Btn className="ghost danger" onClick={async () => { await api(`/helpers/${encodeURIComponent(h.helper_email)}`, { method: 'DELETE' }); helpers.reload(); }}>Remove</Btn>
              </div>
            ))}
            <div className="row" style={{ marginTop: '.6rem' }}>
              <input className="grow" type="email" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="their.email@gmail.com" />
              <Btn className="primary" disabled={!invite.includes('@')} onClick={async () => { const r = await api<{ note: string }>('/helpers', { body: { email: invite } }); toast(r.note); setInvite(''); helpers.reload(); }}>Invite</Btn>
            </div>
          </div>

          <div className="section"><h2>Text messages</h2></div>
          <div className="card">
            <p className="small muted">Get one short text a day when there’s something to do (new jobs to vote on, replies, things to OK). Standard message rates may apply. Reply STOP anytime to opt out.</p>
            <div className="row">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number, e.g. (509) 555-0100" style={{ maxWidth: 280 }} />
            </div>
            <label className="check"><input type="checkbox" checked={smsOk} onChange={(e) => setSmsOk(e.target.checked)} /> <span>Yes, text me about my job search at this number</span></label>
            <div className="row">
              <Btn className="primary" disabled={!smsOk || !phone.trim()} onClick={async () => { const r = await api<{ sent?: boolean }>('/sms', { method: 'PUT', body: { phone, opt_in: true } }); toast(r.sent ? 'Done — check your phone for a welcome text.' : 'Saved. (Texting isn’t switched on yet — we’ll start when it is.)'); }}>Turn on texts</Btn>
              <Btn className="ghost" onClick={async () => { await api('/sms', { method: 'PUT', body: { opt_in: false } }); toast('Texts turned off.'); }}>Turn off texts</Btn>
            </div>
          </div>

          <div className="section"><h2>Browser helper</h2></div>
          <div className="card">
            <p className="small muted">The Next Chapter browser helper (for Chrome) fills in company application forms for you — your details, your resume and cover letter, and answers to their questions. You check everything and press their Submit button yourself.</p>
            <ol className="small">
              <li>Install the helper (see <a href="#/help/browser-helper">how to install it</a>).</li>
              <li>Create a key below and paste it into the helper’s setup screen, along with <code>{window.location.origin}</code>.</li>
            </ol>
            {key ? (
              <div className="notes">
                <strong>Your key (shown once):</strong>
                <pre className="mail small" style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{key}</pre>
                <button onClick={() => navigator.clipboard.writeText(key).then(() => toast('Copied'))}>📋 Copy key</button>
              </div>
            ) : (
              <Btn onClick={async () => { if (confirm('Create a new key? Any older key stops working.')) setKey((await api<{ key: string }>('/ext-key', { method: 'POST' })).key); }}>Create my browser-helper key</Btn>
            )}
          </div>
        </>
      )}
    </>
  );
}
