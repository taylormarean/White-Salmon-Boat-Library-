// Same origin in production (the Worker serves this app). Dev points at `wrangler dev` via .env.development.
const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

/** Sign-in link; carries a stored referral code (?ref=) through Google and back. */
export function googleSignInUrl(mode: 'owner' | 'helper' = 'owner'): string {
  const ref = localStorage.getItem('nc_ref');
  return `${BASE}/api/auth/google?mode=${mode}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`;
}
const KEY = 'nc_token';

export function getToken(): string | null {
  return localStorage.getItem(KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(KEY, t);
  else localStorage.removeItem(KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, navigator.onLine ? 'Couldn’t reach Next Chapter — please try again in a moment.' : 'You’re offline — check your internet connection and try again.');
  }
  if (res.status === 401 && path !== '/login') {
    setToken(null);
    window.dispatchEvent(new Event('nc-logout'));
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 402) window.dispatchEvent(new CustomEvent('nc-billing', { detail: (data as { billing?: string }).billing }));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export async function download(path: string, fallbackName: string) {
  const res = await fetch(`${BASE}/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
