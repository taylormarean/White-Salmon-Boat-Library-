import { describe, expect, it } from 'vitest';
import { APP_ROUTES, HELP_ARTICLES, HELP_CATEGORIES, linksIn, parseBlocks, parseInline, safeHref, searchArticles } from '../../shared/help-articles';
import { cleanConversation, publicHelpRoute, SUPPORT_SYSTEM } from '../src/support';

const top = (q: string) => searchArticles(q, 3).map((a) => a.slug);

describe('help search', () => {
  it.each([
    ['gmail disconnected', 'gmail-disconnected'],
    ['pricing', 'credit-and-pricing'],
    ['how much does it cost', 'credit-and-pricing'],
    ['How do I add my resume?', 'add-your-resume'],
    ['Why are emails going to my own inbox?', 'emails-to-my-own-inbox'],
    ['How do I install the browser helper?', 'browser-helper'],
    ['google hasn’t verified this app', 'sign-in-with-google'],
    ['block a company', 'block-a-company'],
    ['didn’t get the morning email', 'no-morning-email'],
    ['referral payout', 'referrals'],
    ['invite my daughter to help', 'helpers'],
    ['out of credit', 'out-of-credit'],
    ['delete my account', 'delete-account-get-help'],
    ['interview prep', 'interviews'],
    ['spending limit', 'monthly-limit'],
  ])('“%s” → %s', (q, slug) => {
    expect(top(q)[0]).toBe(slug);
  });

  it('matches partial words while typing', () => {
    expect(top('pric')).toContain('credit-and-pricing');
  });

  it('returns nothing for empty or stop-word-only queries', () => {
    expect(searchArticles('')).toEqual([]);
    expect(searchArticles('the and of')).toEqual([]);
  });

  it('respects n', () => {
    expect(searchArticles('job', 2).length).toBeLessThanOrEqual(2);
  });
});

describe('help articles', () => {
  it('have unique slugs, known categories and real content', () => {
    const slugs = HELP_ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(HELP_ARTICLES.length).toBeGreaterThanOrEqual(25);
    for (const a of HELP_ARTICLES) {
      expect(a.slug).toMatch(/^[a-z0-9-]+$/);
      expect(HELP_CATEGORIES as readonly string[]).toContain(a.category);
      expect(a.title.trim()).not.toBe('');
      expect(a.summary.trim()).not.toBe('');
      expect(a.body.trim().length).toBeGreaterThan(200);
      expect(a.keywords.length).toBeGreaterThan(0);
    }
  });

  it('only link to known app screens, existing articles, or https pages', () => {
    const slugs = new Set(HELP_ARTICLES.map((a) => a.slug));
    const bad: string[] = [];
    for (const a of HELP_ARTICLES) {
      for (const href of linksIn(a.body)) {
        if (href.startsWith('#/help/')) {
          if (!slugs.has(href.slice('#/help/'.length))) bad.push(`${a.slug}: ${href}`);
        } else if (href.startsWith('#/')) {
          if (!(APP_ROUTES as readonly string[]).includes(href)) bad.push(`${a.slug}: ${href}`);
        } else if (!href.startsWith('https://')) {
          bad.push(`${a.slug}: ${href}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('every category has articles', () => {
    for (const c of HELP_CATEGORIES) expect(HELP_ARTICLES.some((a) => a.category === c)).toBe(true);
  });
});

describe('markdown subset', () => {
  it('parses headings, lists and paragraphs', () => {
    const b = parseBlocks('Intro line\n\n## Steps\n1. One\n2. Two\n\n- a\n- b\nAfter');
    expect(b.map((x) => x.type)).toEqual(['p', 'h2', 'ol', 'ul', 'p']);
  });
  it('parses bold and links', () => {
    expect(parseInline('Open **Settings** or [Billing](#/billing).')).toEqual([
      { type: 'text', text: 'Open ' }, { type: 'bold', text: 'Settings' }, { type: 'text', text: ' or ' },
      { type: 'link', text: 'Billing', href: '#/billing' }, { type: 'text', text: '.' },
    ]);
  });
  it('only allows in-app and https links', () => {
    expect(safeHref('#/help/test-week')).toBe('#/help/test-week');
    expect(safeHref('https://example.com/x')).toBe('https://example.com/x');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('http://example.com')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
  });
});

describe('support API helpers', () => {
  it('keeps the last 12 turns, starting and ending with the user', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i}` }));
    const c = cleanConversation([{ role: 'assistant', text: 'Hi! How can I help?' }, ...many, { role: 'system', text: 'x' }]);
    expect(c.length).toBeLessThanOrEqual(12);
    expect(c[0].role).toBe('user');
    expect(c[c.length - 1].role).toBe('user');
    expect(cleanConversation('nope')).toEqual([]);
    expect(cleanConversation([{ role: 'user', text: 'x'.repeat(5000) }])[0].text.length).toBe(2000);
  });

  it('serves the public help list and articles', async () => {
    const list = await publicHelpRoute('/api/help')!.json() as { articles: { slug: string }[] };
    expect(list.articles.length).toBe(HELP_ARTICLES.length);
    const one = await publicHelpRoute('/api/help/test-week')!.json() as { body: string };
    expect(one.body).toContain('test mode');
    expect(publicHelpRoute('/api/help/nope')!.status).toBe(404);
    expect(publicHelpRoute('/api/other')).toBeNull();
    expect(publicHelpRoute('/api/help', 'POST')).toBeNull();
  });

  it('puts every article in the assistant’s instructions', () => {
    for (const a of HELP_ARTICLES) expect(SUPPORT_SYSTEM).toContain(`slug="${a.slug}"`);
    expect(SUPPORT_SYSTEM).toContain('support@nextchapterjobhunter.com');
  });
});
