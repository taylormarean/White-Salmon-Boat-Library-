// Follow-up schedule — pure logic, unit tested.
import type { Prefs } from './prefs';
import { parseSqlDate } from './db';

export type NextStep =
  | { type: 'none' }
  | { type: 'follow_up'; number: number; kind: 'follow_up' | 'interview_check_in' }
  | { type: 'close'; reason: string };

export interface FollowUpState {
  status: string;
  submitted_at: string | null;
  last_contact_at: string | null;
  follow_up_count: number;
}

const DAY = 86_400_000;

export function nextStep(app: FollowUpState, now: Date, cfg: Prefs['autopilot']): NextStep {
  const last = parseSqlDate(app.last_contact_at) ?? parseSqlDate(app.submitted_at);
  if (!last) return { type: 'none' };
  const days = (now.getTime() - last.getTime()) / DAY;

  if (app.status === 'submitted' || app.status === 'following_up') {
    const schedule = cfg.follow_up_days;
    if (app.follow_up_count < schedule.length) {
      return days >= schedule[app.follow_up_count]
        ? { type: 'follow_up', number: app.follow_up_count + 1, kind: 'follow_up' }
        : { type: 'none' };
    }
    return days >= cfg.close_after_days
      ? { type: 'close', reason: `No response after ${app.follow_up_count} follow-up${app.follow_up_count === 1 ? '' : 's'}` }
      : { type: 'none' };
  }

  if (app.status === 'interviewing') {
    // Two gentle check-ins after an interview; never auto-close an active interview.
    if (app.follow_up_count < 2 && days >= cfg.interview_check_in_days) {
      return { type: 'follow_up', number: app.follow_up_count + 1, kind: 'interview_check_in' };
    }
  }
  return { type: 'none' };
}

/** Business hours in her timezone — auto-sent email only goes out Mon–Fri 8am–5pm. */
export function isBusinessHours(now: Date, timeZone: string): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  return !['Sat', 'Sun'].includes(wd) && hour >= 8 && hour < 17;
}

export function localHour(now: Date, timeZone: string): number {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now), 10);
}

export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
