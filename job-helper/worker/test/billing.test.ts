import { describe, expect, it } from 'vitest';
import { chargeFor, meter, priceFor, referralCut } from '../src/billing';
import { freeWindows } from '../src/lib/calendar';
import type { Env } from '../src/env';

const env = {} as Env;

describe('pricing math', () => {
  it('prices Opus 5.5 tokens, cache, and web searches', () => {
    // 3,000 in × $4 + 800 out × $20 + 2,000 cache reads × $0.20 + 1,000 cache writes × $5 (1.25 × input) + 2 searches × $0.01
    const m = meter('claude-opus-5-5', { input_tokens: 3000, output_tokens: 800, cache_read_input_tokens: 2000, cache_creation_input_tokens: 1000, server_tool_use: { web_search_requests: 2 } });
    expect(m.costMicro).toBe(12000 + 16000 + 400 + 5000 + 20000);
  });
  it('prices each model that ran when a refusal fallback kicks in', () => {
    const m = meter('claude-opus-4-8', {
      input_tokens: 0, output_tokens: 0,
      iterations: [
        { type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 0 },
        { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 1000, output_tokens: 100 },
      ],
    });
    expect(m.costMicro).toBe(1000 * 4 + 1000 * 5 + 100 * 25);
  });
  it('unknown models are priced conservatively', () => {
    expect(priceFor('claude-something-new').input).toBe(5);
  });
  it('customers pay 2×; referrers get half the profit', () => {
    expect(chargeFor(28_400, env)).toBe(56_800);
    expect(referralCut(28_400, 56_800, env)).toBe(14_200);
    expect(chargeFor(1000, { PRICE_MULTIPLIER: '3' } as Env)).toBe(3000);
    expect(referralCut(1000, 500, env)).toBe(0); // never negative
  });
});

describe('suggesting interview times', () => {
  it('offers weekday business-hours slots that avoid busy blocks, a day out', () => {
    const from = new Date('2026-11-16T16:00:00Z'); // Monday 8am Pacific
    const busy = [{ start: '2026-11-17T17:00:00Z', end: '2026-11-17T20:00:00Z' }]; // Tue 9am–12pm Pacific
    const w = freeWindows(busy, from, 5, 'America/Los_Angeles');
    expect(w.length).toBeGreaterThan(0);
    for (const s of w) {
      const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(s.start));
      const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(s.start);
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(17);
      expect(['Sat', 'Sun']).not.toContain(day);
      expect(s.start.getTime() - from.getTime()).toBeGreaterThanOrEqual(86_400_000);
      expect(busy.some((b) => new Date(b.start) < new Date(s.start.getTime() + 3_600_000) && new Date(b.end) > s.start)).toBe(false);
    }
  });
});
