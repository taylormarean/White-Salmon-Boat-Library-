// Shared UI kit — modal dialogs (replacing browser prompt/confirm), spinner,
// empty states, segmented tabs. One place, fleet-app style.

import { useEffect, useState } from 'react';
import { C, S, R, SHADOW, FONT } from './theme';

// ---------- Modal ----------

export interface ModalField {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'select' | 'textarea';
  options?: { value: string; label: string }[];
  placeholder?: string;
  initial?: string;
  required?: boolean;
}

export interface ModalConfig {
  title: string;
  description?: string;
  fields?: ModalField[];
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: (values: Record<string, string>) => void | Promise<void>;
}

/**
 * App-styled replacement for prompt()/confirm(). Drive it with a state var:
 *   const [modal, setModal] = useState<ModalConfig | null>(null);
 *   ...
 *   <Modal config={modal} onClose={() => setModal(null)} />
 */
export function Modal({ config, onClose }: { config: ModalConfig | null; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!config) return;
    const init: Record<string, string> = {};
    for (const f of config.fields ?? []) init[f.key] = f.initial ?? (f.type === 'select' ? (f.options?.[0]?.value ?? '') : '');
    setValues(init);
    setBusy(false);
    setError('');
  }, [config]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!config) return null;

  const missing = (config.fields ?? []).some((f) => f.required && !(values[f.key] ?? '').trim());

  const confirm = async () => {
    setError(''); setBusy(true);
    try {
      await config.onConfirm(values);
      onClose();
    } catch (e: any) {
      setError(e.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(23,40,43,0.32)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', padding: 20,
    }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 420, background: C.cardSolid, borderRadius: R.xl,
        boxShadow: SHADOW.modal, padding: 24, fontFamily: FONT,
      }}>
        <h2 style={{ ...S.h2, marginBottom: config.description ? 6 : 16 }}>{config.title}</h2>
        {config.description && (
          <p style={{ fontSize: 14, color: C.textSecondary, margin: '0 0 16px', lineHeight: 1.5 }}>{config.description}</p>
        )}
        {(config.fields ?? []).map((f) => (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <label style={S.label}>{f.label}</label>
            {f.type === 'select' ? (
              <select style={S.input} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea style={{ ...S.input, minHeight: 72, resize: 'vertical' }} placeholder={f.placeholder}
                value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} autoFocus />
            ) : (
              <input style={S.input} type={f.type ?? 'text'} placeholder={f.placeholder}
                value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} autoFocus />
            )}
          </div>
        ))}
        {error && <div style={{ color: C.red, fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button style={S.btnGhost} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            style={{ ...S.btn, ...(config.danger ? { background: C.red } : {}), opacity: missing ? 0.5 : 1 }}
            disabled={busy || missing} onClick={confirm}>
            {busy ? 'Working…' : (config.confirmLabel ?? 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Spinner + loading ----------

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <span className="spin" style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      border: `2.5px solid ${C.accentTint}`, borderTopColor: C.accent,
    }} />
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.textSecondary, fontSize: 14, padding: '32px 0', justifyContent: 'center' }}>
      <Spinner /> {label}…
    </div>
  );
}

// ---------- Empty state ----------

export function Empty({ icon = '🌊', title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: C.textSecondary }}>
      <div style={{ fontSize: 36, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 4 }}>{title}</div>
      {hint && <div style={{ fontSize: 13 }}>{hint}</div>}
    </div>
  );
}

// ---------- Segmented tabs ----------

export function Segmented<Tab extends string>({ tabs, value, onChange }: {
  tabs: { key: Tab; label: string }[]; value: Tab; onChange: (t: Tab) => void;
}) {
  return (
    <div style={{
      display: 'inline-flex', gap: 2, padding: 3, borderRadius: R.md,
      background: 'rgba(0,0,0,0.045)', flexWrap: 'wrap',
    }}>
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button key={t.key} onClick={() => onChange(t.key)} style={{
            padding: '7px 14px', borderRadius: R.sm - 1, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: active ? 600 : 500, fontFamily: FONT, letterSpacing: '-0.01em',
            background: active ? '#fff' : 'transparent',
            color: active ? C.accent : C.textSecondary,
            boxShadow: active ? SHADOW.subtle : 'none',
          }}>{t.label}</button>
        );
      })}
    </div>
  );
}

// ---------- Page header ----------

export function PageHeader({ title, subtitle, actions }: {
  title: string; subtitle?: string; actions?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
      <div>
        <h1 style={S.h1}>{title}</h1>
        {subtitle && <p style={{ color: C.textSecondary, fontSize: 15, margin: 0, letterSpacing: '-0.01em' }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}
