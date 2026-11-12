// Minimal .docx text extraction (a .docx is a zip; the text lives in word/document.xml).
// Uses the runtime's DecompressionStream — no dependencies.

function u16(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8); }
function u32(b: Uint8Array, o: number) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZipEntry(zip: Uint8Array, name: string): Promise<Uint8Array | null> {
  // Find the end-of-central-directory record (scan back from the end).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (u32(zip, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = u16(zip, eocd + 10);
  let p = u32(zip, eocd + 16);
  for (let n = 0; n < count && p + 46 <= zip.length; n++) {
    if (u32(zip, p) !== 0x02014b50) return null;
    const method = u16(zip, p + 10);
    const compSize = u32(zip, p + 20);
    const nameLen = u16(zip, p + 28);
    const extraLen = u16(zip, p + 30);
    const commentLen = u16(zip, p + 32);
    const localOffset = u32(zip, p + 42);
    const entryName = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (entryName === name) {
      const lNameLen = u16(zip, localOffset + 26);
      const lExtraLen = u16(zip, localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const raw = zip.subarray(start, start + compSize);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** Plain text of a .docx: one line per paragraph, tabs and line breaks kept. */
export async function docxToText(bytes: Uint8Array): Promise<string> {
  const xmlBytes = await readZipEntry(bytes, 'word/document.xml');
  if (!xmlBytes) throw new Error('Not a readable Word document');
  const xml = new TextDecoder().decode(xmlBytes);
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
