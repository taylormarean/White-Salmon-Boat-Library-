// Admin · Users — account management (fleet-app AdminUsers, minus impersonation).

import { useEffect, useState } from 'react';
import { api } from '../api';
import { C, S } from '../theme';
import { PageHeader, Segmented } from '../components';

const ROLES = ['admin', 'librarian', 'volunteer', 'member', 'disabled'];
const EMPTY = { username: '', display_name: '', password: '', role: 'volunteer', phone: '' };

export default function AdminUsers() {
  const [users, setUsers] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [tab, setTab] = useState<'users' | 'audit' | 'notifications'>('users');
  const [notifLog, setNotifLog] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null);
  const [error, setError] = useState('');

  const load = () => {
    api.getUsers().then(setUsers).catch((e) => setError(e.message));
    if (tab === 'audit') api.getAuditLog().then(setAuditLog).catch(() => {});
    if (tab === 'notifications') api.getNotificationLog().then(setNotifLog).catch(() => {});
  };
  useEffect(load, [tab]);

  const save = async () => {
    setError('');
    try {
      if (form.existing) await api.updateUser(form.username, form);
      else await api.createUser(form);
      setForm(null); load();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div>
      <PageHeader title="Admin" subtitle="Accounts, audit trail, and every outbound email."
        actions={<>
          <Segmented tabs={[{ key: 'users', label: 'Users' }, { key: 'audit', label: 'Audit log' }, { key: 'notifications', label: 'Notifications' }]}
            value={tab} onChange={setTab} />
          {tab === 'users' && <button style={S.btn} onClick={() => setForm({ ...EMPTY })}>+ Add user</button>}
        </>} />
      {error && <div style={{ color: C.red, marginBottom: 12 }}>{error}</div>}

      {form && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <h2 style={S.h2}>{form.existing ? `Edit ${form.username}` : 'New user'}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
            <div><label style={S.label}>Email</label>
              <input style={S.input} value={form.username} disabled={!!form.existing} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
            <div><label style={S.label}>Display name</label>
              <input style={S.input} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
            <div><label style={S.label}>Role</label>
              <select style={S.input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select></div>
            <div><label style={S.label}>{form.existing ? 'Reset password (optional)' : 'Password'}</label>
              <input style={S.input} type="password" value={form.existing ? (form.new_password ?? '') : form.password}
                onChange={(e) => setForm(form.existing ? { ...form, new_password: e.target.value } : { ...form, password: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.btn} onClick={save}>Save</button>
            <button style={S.btnGhost} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div style={{ ...S.card, ...S.tableWrap, padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['User', 'Role', 'Member link', 'Last login', ''].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.username}>
                  <td style={S.td}><strong>{u.display_name}</strong><div style={{ color: C.textTertiary, fontSize: 12 }}>{u.username}</div></td>
                  <td style={S.td}><span style={S.badge(
                    u.role === 'admin' ? C.accent : u.role === 'disabled' ? C.red : C.textSecondary,
                    u.role === 'admin' ? C.accentTint : u.role === 'disabled' ? C.redTint : 'rgba(0,0,0,0.05)',
                  )}>{u.role}</span></td>
                  <td style={S.td}>{u.member_name ?? '—'}</td>
                  <td style={S.td}>{u.last_login_at ? new Date(u.last_login_at + 'Z').toLocaleString() : 'never'}</td>
                  <td style={S.td}><button style={{ ...S.btnGhost, padding: '4px 10px', fontSize: 12 }} onClick={() => setForm({ ...u, existing: true })}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'audit' && (
        <div style={{ ...S.card, ...S.tableWrap, padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['When', 'Actor', 'Action', 'Target', 'Details'].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {auditLog.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{new Date(a.created_at + 'Z').toLocaleString()}</td>
                  <td style={S.td}>{a.actor}</td>
                  <td style={S.td}>{a.action}</td>
                  <td style={S.td}>{a.target ?? '—'}</td>
                  <td style={{ ...S.td, fontSize: 12, color: C.textTertiary, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.meta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'notifications' && (
        <div style={{ ...S.card, ...S.tableWrap, padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['When', 'Category', 'Recipient', 'Subject', 'Status'].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {notifLog.map((n) => (
                <tr key={n.id}>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{new Date(n.sent_at + 'Z').toLocaleString()}</td>
                  <td style={S.td}>{n.category}</td>
                  <td style={S.td}>{n.recipient}</td>
                  <td style={S.td}>{n.subject}</td>
                  <td style={S.td}><span style={S.badge(
                    n.status === 'sent' ? C.green : n.status === 'failed' ? C.red : C.yellow,
                    n.status === 'sent' ? C.greenTint : n.status === 'failed' ? C.redTint : C.yellowTint,
                  )}>{n.status}</span>{n.error && <div style={{ color: C.textTertiary, fontSize: 11 }}>{n.error}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
