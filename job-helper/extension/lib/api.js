// Talks to the Next Chapter app. Used by the popup, the setup page and the
// service worker. The API key lives only in chrome.storage.local on this
// computer and is only ever sent to her own Next Chapter address.

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Turn whatever she pasted ("next-chapter.x.workers.dev", "https://.../today")
 * into an origin like "https://next-chapter.x.workers.dev".
 * Throws an Error with a plain-language message if it can't.
 */
export function normalizeBase(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Please paste the address of your Next Chapter app.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    s = (/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(s) ? 'http://' : 'https://') + s;
  }
  let url;
  try {
    url = new URL(s);
  } catch {
    throw new Error("That doesn't look like a web address. It should look like https://next-chapter.example.workers.dev");
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('The address should start with https://');
  }
  return url.origin;
}

/** The pattern to ask Chrome for, so the helper may talk to her app. */
export function originPattern(base) {
  const u = new URL(base);
  return `${u.protocol}//${u.hostname}/*`;
}

export async function getSettings() {
  const { apiBase = '', apiKey = '' } = await chrome.storage.local.get(['apiBase', 'apiKey']);
  return { apiBase, apiKey };
}

export async function saveSettings({ apiBase, apiKey, name }) {
  await chrome.storage.local.set({ apiBase, apiKey, userName: name || '' });
}

export async function clearSettings() {
  await chrome.storage.local.remove(['apiBase', 'apiKey', 'userName']);
}

export async function isSetUp() {
  const { apiBase, apiKey } = await getSettings();
  return !!(apiBase && apiKey);
}

async function request(path, { method = 'GET', body, base, key, timeoutMs = 30000 } = {}) {
  if (!base || !key) {
    const s = await getSettings();
    base = base || s.apiBase;
    key = key || s.apiKey;
  }
  if (!base || !key) throw new ApiError('The helper is not set up yet.', 0);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: {
        'X-Api-Key': key,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new ApiError('Next Chapter took too long to answer. Please try again in a minute.', 0);
    }
    throw new ApiError(
      "We couldn't reach Next Chapter. Check that the computer is online and that the app address is right.",
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401) {
    throw new ApiError(
      "The browser helper key didn't work. In Next Chapter, open Settings, copy the \"Browser helper key\" again and paste it here.",
      401,
    );
  }
  if (!res.ok) {
    const msg = data && typeof data.error === 'string' && data.error ? data.error : `Something went wrong (error ${res.status}).`;
    throw new ApiError(msg, res.status);
  }
  if (data === null) throw new ApiError('Next Chapter sent back something unexpected. Is the app address right?', res.status);
  return data;
}

export const api = {
  profile: (opts) => request('/api/ext/profile', opts),
  applications: (opts) => request('/api/ext/applications', opts),
  files: (id, opts) => request(`/api/ext/applications/${encodeURIComponent(id)}/files`, { timeoutMs: 60000, ...opts }),
  answers: (id, opts) => request(`/api/ext/applications/${encodeURIComponent(id)}/answers`, opts),
  answer: (applicationId, question, maxChars, opts) =>
    request('/api/ext/answer', {
      method: 'POST',
      body: { application_id: applicationId, question, ...(maxChars ? { max_chars: maxChars } : {}) },
      timeoutMs: 120000,
      ...opts,
    }),
  filled: (id, opts) => request(`/api/ext/applications/${encodeURIComponent(id)}/filled`, { method: 'POST', body: {}, ...opts }),
};
