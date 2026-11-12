// RFC 2822 message builder for the Gmail API (raw, base64url). Pure; unit tested.

export interface Attachment {
  filename: string;
  mimeType: string;
  base64: string; // standard base64
}

export interface MailInput {
  from: string;        // "Linda Smith <linda@gmail.com>"
  to: string;
  subject: string;
  text: string;
  html?: string;       // optional rich version (plain text is always included too)
  inReplyTo?: string | null; // Message-ID we're replying to (keeps the employer's thread together)
  attachments?: Attachment[];
}

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${utf8ToBase64(value)}?=`;
}

function stripCrlf(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim();
}

export function buildMime(m: MailInput, boundary = `nc_${crypto.randomUUID().replace(/-/g, '')}`): string {
  const headers = [
    `From: ${stripCrlf(m.from)}`,
    `To: ${stripCrlf(m.to)}`,
    `Subject: ${encodeHeader(stripCrlf(m.subject))}`,
    'MIME-Version: 1.0',
  ];
  if (m.inReplyTo) {
    headers.push(`In-Reply-To: ${stripCrlf(m.inReplyTo)}`, `References: ${stripCrlf(m.inReplyTo)}`);
  }
  const plainPart = ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap76(utf8ToBase64(m.text))].join('\r\n');
  const alt = `${boundary}_alt`;
  const textPart = m.html
    ? [
      `Content-Type: multipart/alternative; boundary="${alt}"`, '',
      `--${alt}\r\n${plainPart}`,
      `--${alt}\r\n${['Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap76(utf8ToBase64(m.html))].join('\r\n')}`,
      `--${alt}--`,
    ].join('\r\n')
    : plainPart;

  if (!m.attachments?.length) {
    return [...headers, textPart].join('\r\n');
  }
  const parts = [textPart];
  for (const a of m.attachments) {
    const name = stripCrlf(a.filename).replace(/"/g, '');
    parts.push([
      `Content-Type: ${a.mimeType}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(a.base64),
    ].join('\r\n'));
  }
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    ...parts.map((p) => `--${boundary}\r\n${p}`),
    `--${boundary}--`,
  ].join('\r\n');
}

export function toBase64Url(raw: string): string {
  return utf8ToBase64(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
