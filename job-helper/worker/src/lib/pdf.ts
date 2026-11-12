// Turns the app's resume / cover-letter markdown into a clean, ATS-friendly PDF (real, selectable text).
// Same markdown subset and visual style as ./docx.ts:
//   "# Name", contact line(s) under the name (resume), "## Section", "### Role line",
//   "- bullet" / "* bullet" / "• bullet", **bold**, paragraphs, "---" ignored.
// Uses pdf-lib with the built-in Helvetica fonts (no fs, no browser) so it runs in Workers.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export const PDF_MIME = 'application/pdf';

// US Letter, in points (72 pt = 1 inch).
const PAGE_W = 612;
const PAGE_H = 792;

// ---------- text sanitising (standard fonts only speak WinAnsi) ----------

// Characters Helvetica can't encode (or that we normalise) -> close equivalents. Typographic characters that ARE in
// WinAnsi (curly quotes, en/em dashes, "·", "•", "…") are kept: they render natively and extract correctly.
const REPLACEMENTS: Record<string, string> = {
  '\u00A0': ' ', '\u2007': ' ', '\u202F': ' ', '\u2002': ' ', '\u2003': ' ', '\u2009': ' ', '\u200A': ' ', '\u3000': ' ', '\t': ' ',
  '\u201B': "'", '\u2032': "'", '\u02BC': "'", '\u201F': '"', '\u2033': '"',
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2015': '\u2014', '\u2212': '-', '\u00AD': '',
  '\u2023': '\u2022', '\u2043': '-', '\u25CF': '\u2022', '\u25AA': '\u2022', '\u25A0': '\u2022', '\u25E6': '\u2022', '\u2219': '\u00B7',
  '\u2192': '->', '\u2190': '<-', '\u2194': '<->', '\u21D2': '=>', '\u2264': '<=', '\u2265': '>=', '\u2260': '!=', '\u2248': '~',
  '\u2116': 'No.', '\u2713': '', '\u2714': '', '\u2705': '', '\u2717': 'x', '\u2718': 'x', '\u2715': 'x',
  '\u2153': '1/3', '\u2154': '2/3',
};
// invisible / joiner characters: drop
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\uFE00-\uFE0F\u{E0020}-\u{E007F}\u{1F3FB}-\u{1F3FF}]/gu;

/** Map text onto characters the font can encode; never throws. */
function makeSanitizer(font: PDFFont): (s: string) => string {
  const ok = new Set(font.getCharacterSet());
  ok.delete(0x0a);
  ok.delete(0x0d);
  return (s: string) => {
    let out = '';
    for (const ch of s.replace(INVISIBLE, '')) {
      const rep = REPLACEMENTS[ch];
      if (rep !== undefined) {
        out += rep;
        continue;
      }
      const cp = ch.codePointAt(0)!;
      if (cp >= 0x20 && cp < 0x7f) {
        out += ch;
        continue;
      }
      if (ok.has(cp)) {
        out += ch;
        continue;
      }
      // accented letters outside WinAnsi (e.g. ā, ł, ő): strip the accent if that helps
      const base = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
      if (base && base !== ch && [...base].every((c) => ok.has(c.codePointAt(0)!))) {
        out += base;
        continue;
      }
      out += '?';
    }
    return out;
  };
}

// ---------- inline runs + word wrapping ----------

interface Seg { text: string; bold: boolean }
type Word = Seg[]; // a word can mix bold / regular, e.g. "**Acme**,"

function parseRuns(text: string, baseBold: boolean): Seg[] {
  const out: Seg[] = [];
  for (const p of text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)) {
    const bold = p.startsWith('**') && p.endsWith('**') && p.length > 4;
    out.push({ text: bold ? p.slice(2, -2) : p.replace(/\*\*/g, ''), bold: bold || baseBold });
  }
  return out;
}

function toWords(segs: Seg[]): Word[] {
  const words: Word[] = [];
  let cur: Word = [];
  for (const s of segs) {
    for (const piece of s.text.split(/(\s+)/)) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) {
        if (cur.length) words.push(cur);
        cur = [];
      } else {
        cur.push({ text: piece, bold: s.bold });
      }
    }
  }
  if (cur.length) words.push(cur);
  return words;
}

interface Fonts { regular: PDFFont; bold: PDFFont }

const segWidth = (s: Seg, f: Fonts, size: number) => (s.bold ? f.bold : f.regular).widthOfTextAtSize(s.text, size);
const wordWidth = (w: Word, f: Fonts, size: number) => w.reduce((n, s) => n + segWidth(s, f, size), 0);

/** Break a single word that is wider than the line (long URLs etc.) into pieces that fit. */
function splitLongWord(w: Word, f: Fonts, size: number, maxW: number): Word[] {
  const pieces: Word[] = [];
  let cur: Word = [];
  let curW = 0;
  for (const s of w) {
    const font = s.bold ? f.bold : f.regular;
    let buf = '';
    for (const ch of s.text) {
      const cw = font.widthOfTextAtSize(ch, size);
      if (curW + cw > maxW && (cur.length || buf)) {
        if (buf) cur.push({ text: buf, bold: s.bold });
        pieces.push(cur);
        cur = [];
        curW = 0;
        buf = '';
      }
      buf += ch;
      curW += cw;
    }
    if (buf) cur.push({ text: buf, bold: s.bold });
  }
  if (cur.length) pieces.push(cur);
  return pieces;
}

/** Greedy word wrap. Each returned line is a list of segments with the spaces already included. */
function wrap(segs: Seg[], f: Fonts, size: number, maxW: number): Seg[][] {
  const space = f.regular.widthOfTextAtSize(' ', size);
  const lines: Seg[][] = [];
  let line: Word[] = [];
  let lineW = 0;
  const push = () => {
    if (line.length) lines.push(joinWords(line));
    line = [];
    lineW = 0;
  };
  for (const word of toWords(segs)) {
    const ww = wordWidth(word, f, size);
    if (ww > maxW) {
      push();
      const parts = splitLongWord(word, f, size, maxW);
      parts.slice(0, -1).forEach((p) => lines.push(p));
      line = [parts[parts.length - 1]];
      lineW = wordWidth(line[0], f, size);
      continue;
    }
    if (line.length && lineW + space + ww > maxW) push();
    lineW += (line.length ? space : 0) + ww;
    line.push(word);
  }
  push();
  return lines;
}

function joinWords(words: Word[]): Seg[] {
  const out: Seg[] = [];
  words.forEach((w, i) => {
    w.forEach((s, j) => {
      const text = i > 0 && j === 0 ? ' ' + s.text : s.text;
      const last = out[out.length - 1];
      if (last && last.bold === s.bold) last.text += text;
      else out.push({ text, bold: s.bold });
    });
  });
  return out;
}

// ---------- blocks (one per markdown construct, mirrors docx.ts) ----------

interface Block {
  segs: Seg[];
  size: number; // pt
  align: 'left' | 'center';
  before: number; // pt of space above
  after: number; // pt of space below
  lineFactor: number; // line height as a multiple of font size
  indent?: number; // left indent for the text (bullets)
  bullet?: boolean;
  rule?: boolean; // thin line under the block (section headings)
  keepNext?: boolean;
}

// Word's default single line for these fonts is ~1.2 em; docx.ts asks for 1.15x that on paragraphs.
const SINGLE = 1.2;

function markdownToBlocks(md: string, kind: 'resume' | 'letter', clean: (s: string) => string): Block[] {
  const lines = md.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let sawName = false;
  let afterName = false;
  let buffer: string[] = [];
  const runs = (t: string, bold = false) => parseRuns(clean(t), bold);

  const flush = () => {
    if (!buffer.length) return;
    if (kind === 'letter') {
      // In a letter, line breaks inside a paragraph are deliberate ("Thanks so much,\nLinda").
      buffer.forEach((l, i) => blocks.push({ segs: runs(l), size: 11, align: 'left', before: 0, after: i === buffer.length - 1 ? 10 : 0, lineFactor: SINGLE * 1.15 }));
    } else {
      blocks.push({ segs: runs(buffer.join(' ')), size: 11, align: 'left', before: 0, after: 5, lineFactor: SINGLE * 1.15 });
    }
    buffer = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^#\s+/.test(line)) {
      flush();
      sawName = true;
      afterName = true;
      blocks.push({ segs: runs(line.replace(/^#\s+/, ''), true), size: 18, align: 'center', before: 0, after: 3, lineFactor: SINGLE, keepNext: true });
      continue;
    }
    if (/^##\s+/.test(line)) {
      flush();
      afterName = false;
      blocks.push({ segs: runs(line.replace(/^##\s+/, '').toUpperCase(), true), size: 11, align: 'left', before: 12, after: 4, lineFactor: SINGLE, rule: true, keepNext: true });
      continue;
    }
    if (/^###\s+/.test(line)) {
      flush();
      blocks.push({ segs: runs(line.replace(/^###\s+/, ''), true), size: 11, align: 'left', before: 6, after: 2, lineFactor: SINGLE, keepNext: true });
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      flush();
      blocks.push({ segs: runs(line.replace(/^\s*[-*•]\s+/, '')), size: 10.5, align: 'left', before: 0, after: 2, lineFactor: SINGLE, indent: 18, bullet: true });
      continue;
    }
    if (/^-{3,}$/.test(line.trim())) {
      flush();
      continue;
    }
    if (sawName && afterName && kind === 'resume') {
      // contact line(s) right under the name
      blocks.push({ segs: runs(line), size: 10, align: 'center', before: 0, after: 3, lineFactor: SINGLE, keepNext: true });
      continue;
    }
    buffer.push(line);
  }
  flush();
  return blocks;
}

// ---------- layout + drawing ----------

const RULE_GAP = 2; // pt between heading text and its rule
const RULE_COLOR = rgb(0.6, 0.6, 0.6); // #999999, as in docx.ts
const TEXT_COLOR = rgb(0, 0, 0);

interface Laid { block: Block; lines: Seg[][]; lineH: number }

export async function markdownToPdfBase64(md: string, kind: 'resume' | 'letter'): Promise<string> {
  const doc = await PDFDocument.create();
  const fonts: Fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const clean = makeSanitizer(fonts.regular);

  const margin = kind === 'resume' ? 45 : 65; // same as docx.ts (900 / 1300 twips)
  const contentW = PAGE_W - margin * 2;
  const top = PAGE_H - margin;
  const bottom = margin;

  const laid: Laid[] = markdownToBlocks(md || '', kind, clean).map((block) => ({
    block,
    lines: wrap(block.segs, fonts, block.size, contentW - (block.indent ?? 0)),
    lineH: block.size * block.lineFactor,
  })).filter((l) => l.lines.length > 0);

  const name = laid.find((l) => l.block.size === 18);
  if (name) doc.setTitle(`${name.lines.flat().map((s) => s.text).join('')} - ${kind === 'resume' ? 'Resume' : 'Cover Letter'}`);
  doc.setCreator('Next Chapter');
  doc.setProducer('Next Chapter');

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = top; // top of the next line
  let atTop = true;
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = top;
    atTop = true;
  };
  const extra = (b: Block) => (b.rule ? RULE_GAP + 1 : 0);

  // height a block needs to put its first line on the page (plus, for keep-with-next blocks, the next block's first line)
  const leadHeight = (i: number, depth = 0): number => {
    const l = laid[i];
    if (!l) return 0;
    const own = (atTop && depth === 0 ? 0 : l.block.before) + l.lineH + extra(l.block);
    if (!l.block.keepNext || depth > 3 || !laid[i + 1]) return own;
    const rest = l.lines.length > 1 ? (l.lines.length - 1) * l.lineH : 0;
    return own + rest + l.block.after + leadHeight(i + 1, depth + 1);
  };

  for (let i = 0; i < laid.length; i++) {
    const { block: b, lines, lineH } = laid[i];
    const need = leadHeight(i);
    // keep a heading with what follows — unless the group is taller than a whole page anyway
    if (!atTop && y - need < bottom && need <= top - bottom) newPage();
    if (!atTop) y -= b.before;

    lines.forEach((segs, li) => {
      if (y - lineH < bottom && !atTop) newPage();
      atTop = false;
      const font = (s: Seg) => (s.bold ? fonts.bold : fonts.regular);
      const width = segs.reduce((n, s) => n + font(s).widthOfTextAtSize(s.text, b.size), 0);
      const textX = b.align === 'center' ? (PAGE_W - width) / 2 : margin + (b.indent ?? 0);
      // baseline: centre the glyph box (~1.2 em: 0.93 ascent / 0.27 descent for Helvetica) inside the line
      const baseline = y - (lineH - b.size * SINGLE) / 2 - b.size * 0.93;
      if (b.bullet && li === 0) {
        // a real "•" glyph (not a drawn shape) so text extraction sees a bullet, as with Word's list bullets
        page.drawText('\u2022', { x: margin + 5, y: baseline, size: b.size, font: fonts.regular, color: TEXT_COLOR });
      }
      let x = textX;
      for (const s of segs) {
        page.drawText(s.text, { x, y: baseline, size: b.size, font: font(s), color: TEXT_COLOR });
        x += font(s).widthOfTextAtSize(s.text, b.size);
      }
      y -= lineH;
    });

    if (b.rule) {
      y -= RULE_GAP;
      page.drawLine({ start: { x: margin, y }, end: { x: PAGE_W - margin, y }, thickness: 0.75, color: RULE_COLOR });
      y -= 1;
    }
    y -= b.after;
  }

  return doc.saveAsBase64();
}

export function pdfFilename(name: string, what: string): string {
  const safe = (name || 'Applicant').replace(/[^A-Za-z0-9 ]+/g, '').trim().replace(/\s+/g, '_');
  return `${safe}_${what}.pdf`;
}
