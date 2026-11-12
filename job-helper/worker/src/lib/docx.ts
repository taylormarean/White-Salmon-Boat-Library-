// Turns the app's resume / cover-letter markdown into a clean, ATS-friendly Word document.
// Supported subset: "# Name", "## Section", "### Role line", "- bullet", **bold**, paragraphs.
import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TextRun } from 'docx';

const FONT = 'Calibri';

function runs(text: string, size: number, baseBold = false): TextRun[] {
  const out: TextRun[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  for (const p of parts) {
    const bold = p.startsWith('**') && p.endsWith('**');
    out.push(new TextRun({ text: bold ? p.slice(2, -2) : p.replace(/\*\*/g, ''), bold: bold || baseBold, size, font: FONT }));
  }
  return out;
}

export function markdownToParagraphs(md: string, kind: 'resume' | 'letter'): Paragraph[] {
  const lines = md.replace(/\r/g, '').split('\n');
  const paras: Paragraph[] = [];
  let sawName = false;
  let afterName = false;
  let buffer: string[] = [];

  const flush = () => {
    if (!buffer.length) return;
    paras.push(new Paragraph({ children: runs(buffer.join(' '), 22), spacing: { after: kind === 'letter' ? 200 : 100, line: 276 } }));
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
      paras.push(new Paragraph({ alignment: AlignmentType.CENTER, children: runs(line.replace(/^#\s+/, ''), 36, true), spacing: { after: 60 } }));
      continue;
    }
    if (/^##\s+/.test(line)) {
      flush();
      afterName = false;
      paras.push(new Paragraph({
        children: runs(line.replace(/^##\s+/, '').toUpperCase(), 22, true),
        spacing: { before: 240, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 2 } },
      }));
      continue;
    }
    if (/^###\s+/.test(line)) {
      flush();
      paras.push(new Paragraph({ children: runs(line.replace(/^###\s+/, ''), 22, true), spacing: { before: 120, after: 40 }, keepNext: true }));
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      flush();
      paras.push(new Paragraph({ children: runs(line.replace(/^\s*[-*•]\s+/, ''), 21), bullet: { level: 0 }, spacing: { after: 40 } }));
      continue;
    }
    if (/^-{3,}$/.test(line.trim())) {
      flush();
      continue;
    }
    if (sawName && afterName && kind === 'resume') {
      // contact line(s) right under the name
      paras.push(new Paragraph({ alignment: AlignmentType.CENTER, children: runs(line, 20), spacing: { after: 60 } }));
      continue;
    }
    buffer.push(line);
  }
  flush();
  return paras;
}

export async function markdownToDocxBase64(md: string, kind: 'resume' | 'letter'): Promise<string> {
  const margin = kind === 'resume' ? 900 : 1300; // twips (1440 = 1 inch)
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: margin, bottom: margin, left: margin, right: margin } } }, children: markdownToParagraphs(md, kind) }],
  });
  return Packer.toBase64String(doc);
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function docFilename(name: string, what: string): string {
  const safe = (name || 'Applicant').replace(/[^A-Za-z0-9 ]+/g, '').trim().replace(/\s+/g, '_');
  return `${safe}_${what}.docx`;
}
