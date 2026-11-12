// Google Calendar: put interviews on her calendar, and find times she's actually free.
import type { Env } from '../env';
import { accessToken, gmailStatus } from './gmail';

const API = 'https://www.googleapis.com/calendar/v3';

async function cal<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${await accessToken(env)}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`Calendar ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

export async function calendarReady(env: Env): Promise<boolean> {
  const s = await gmailStatus(env);
  return s.connected && s.calendar;
}

export async function createEvent(env: Env, e: { title: string; startsAt: string; minutes: number; description?: string; location?: string }): Promise<string> {
  const start = new Date(e.startsAt);
  const end = new Date(start.getTime() + e.minutes * 60_000);
  const r = await cal<{ id: string }>(env, '/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify({
      summary: e.title, description: e.description, location: e.location,
      start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }, { method: 'popup', minutes: 1440 }] },
    }),
  });
  return r.id;
}

/** Free 30-minute windows on weekdays between 9am and 5pm local time, for the next few business days. */
export function freeWindows(busy: { start: string; end: string }[], from: Date, days: number, timeZone: string, max = 6): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  const spans = busy.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()] as const);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  // Walk forward in 30-minute steps from the next half hour (+1 day lead time).
  let t = Math.ceil((from.getTime() + 86_400_000) / 1_800_000) * 1_800_000;
  const stop = from.getTime() + (days + 3) * 86_400_000;
  let lastDay = '';
  let perDay = 0;
  while (t < stop && out.length < max) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    const hour = Number(parts.hour);
    const weekday = parts.weekday;
    if (weekday !== lastDay) { lastDay = weekday; perDay = 0; }
    const okHour = hour >= 9 && hour < 17 && !(hour === 16 && Number(parts.minute) > 0);
    if (!['Sat', 'Sun'].includes(weekday) && okHour && perDay < 2) {
      const end = t + 3_600_000; // need an hour clear
      if (!spans.some(([s, e]) => s < end && e > t)) {
        out.push({ start: new Date(t), end: new Date(t + 1_800_000) });
        perDay++;
        t += 3 * 3_600_000; // spread suggestions out
        continue;
      }
    }
    t += 1_800_000;
  }
  return out;
}

export async function suggestTimes(env: Env, timeZone: string): Promise<string[]> {
  if (!(await calendarReady(env))) return [];
  const now = new Date();
  const r = await cal<{ calendars: { primary?: { busy: { start: string; end: string }[] } } }>(env, '/freeBusy', {
    method: 'POST',
    body: JSON.stringify({ timeMin: now.toISOString(), timeMax: new Date(now.getTime() + 10 * 86_400_000).toISOString(), timeZone, items: [{ id: 'primary' }] }),
  });
  const label = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  return freeWindows(r.calendars.primary?.busy ?? [], now, 5, timeZone).map((w) => label.format(w.start));
}
