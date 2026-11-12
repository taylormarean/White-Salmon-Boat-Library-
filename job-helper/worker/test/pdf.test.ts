import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { markdownToPdfBase64, PDF_MIME } from '../src/lib/pdf';

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const header = (b64: string) => new TextDecoder().decode(decode(b64).slice(0, 5));
const pages = async (b64: string) => (await PDFDocument.load(decode(b64))).getPageCount();

const RESUME = `# Jane Doe
White Salmon, WA · (509) 555-0100 · jane@example.com

## Summary
Operations lead with **15 years** of experience running small teams.

## Experience
### Office Manager — Acme Co. | 2015–2024
- Ran payroll and scheduling for **40** staff
* Cut supply costs 20%
• Trained new hires

---

## Education
### B.A., Business — State University
`;

describe('markdownToPdfBase64', () => {
  it('produces a one-page PDF for a short resume', async () => {
    const b64 = await markdownToPdfBase64(RESUME, 'resume');
    expect(header(b64)).toBe('%PDF-');
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/); // standard base64, no data: prefix
    expect(await pages(b64)).toBe(1);
    expect(PDF_MIME).toBe('application/pdf');
  });

  it('breaks a long resume onto multiple pages', async () => {
    const bullets = Array.from({ length: 80 }, (_, i) => `- Accomplishment number ${i + 1}: improved a process that saved the team time and money every week.`).join('\n');
    const md = `# Jane Doe\njane@example.com\n\n## Experience\n### Role — Company\n${bullets}\n`;
    const b64 = await markdownToPdfBase64(md, 'resume');
    expect(header(b64)).toBe('%PDF-');
    expect(await pages(b64)).toBeGreaterThan(1);
  });

  it('wraps long paragraphs and very long words without throwing', async () => {
    const para = 'This is a fairly long sentence that should wrap across several lines on the page. '.repeat(60);
    const url = 'https://example.com/' + 'a'.repeat(400);
    const b64 = await markdownToPdfBase64(`# Jane Doe\n\nDear Hiring Manager,\n\n${para}\n\n${url}\n\nSincerely,\nJane`, 'letter');
    expect(header(b64)).toBe('%PDF-');
    expect(await pages(b64)).toBeGreaterThan(1);
  });

  it('never throws on Unicode outside WinAnsi', async () => {
    const md = [
      '# Zoë Łukasiewicz-Ōtani 🚀',
      'Portland, OR · zoë@example.com\u00a0| ☎ 555',
      '## Skills ✨',
      '- “Curly quotes” and ‘single’ — em dash – en dash … ellipsis • bullet',
      '- Emoji 👩‍💻 👍🏽 ❤️, arrows → ←, math ≤ ≥ ≠, check ✓, CJK 日本語, Greek αβγ, zero\u200bwidth',
      '- Lone surrogate \ud83d and tab\there',
    ].join('\n');
    for (const kind of ['resume', 'letter'] as const) {
      const b64 = await markdownToPdfBase64(md, kind);
      expect(header(b64)).toBe('%PDF-');
      expect(await pages(b64)).toBe(1);
    }
  });

  it('handles empty input', async () => {
    const b64 = await markdownToPdfBase64('', 'letter');
    expect(await pages(b64)).toBe(1);
  });
});
