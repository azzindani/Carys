// multipart/related parser + builder (WADO-RS bodies, STOW-RS requests).
// Operates on bytes so transfer-syntax payloads pass through untouched.

const CRLF = [13, 10];

function indexOfSeq(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function splitHeaderBody(block: Uint8Array): { headers: Record<string, string>; body: Uint8Array } {
  const sep = new Uint8Array([13, 10, 13, 10]);
  const at = indexOfSeq(block, sep);
  if (at < 0) throw new Error('multipart part missing header terminator');
  const raw = new TextDecoder('latin1').decode(block.subarray(0, at));
  const headers: Record<string, string> = {};
  for (const line of raw.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { headers, body: block.subarray(at + sep.length) };
}

function trimTrailingCrlf(body: Uint8Array): Uint8Array {
  // Strip EXACTLY one CRLF: RFC 2046 attaches the delimiter's line break to
  // the delimiter, so one trailing CRLF is framing. Stripping more eats
  // payload bytes when the body itself ends in CRLF (fuzz-found).
  if (body.length >= 2 && body[body.length - 2] === CRLF[0] && body[body.length - 1] === CRLF[1]) {
    return body.subarray(0, body.length - 2);
  }
  return body;
}

/** Parse a multipart/related body. Throws on truncation or bad boundary. */
export function parseMultipartRelated(body: Uint8Array, boundary: string): import('./types.js').MultipartPart[] {
  if (!boundary) throw new Error('multipart/related requires a boundary');
  const enc = new TextEncoder();
  const delim = enc.encode(`--${boundary}`);
  const parts: import('./types.js').MultipartPart[] = [];
  let pos = indexOfSeq(body, delim);
  if (pos < 0) throw new Error('multipart boundary not found');
  for (;;) {
    pos += delim.length;
    // '--' right after the delimiter closes the stream.
    if (body[pos] === 45 && body[pos + 1] === 45) break;
    // consume the CRLF ending the delimiter line
    if (body[pos] === CRLF[0] && body[pos + 1] === CRLF[1]) pos += 2;
    const next = indexOfSeq(body, delim, pos);
    if (next < 0) throw new Error('multipart body truncated: missing closing boundary');
    const { headers, body: raw } = splitHeaderBody(body.subarray(pos, next));
    const contentType = (headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    parts.push({
      headers,
      contentType,
      contentLocation: headers['content-location'] ?? null,
      body: trimTrailingCrlf(raw),
    });
    pos = next;
  }
  return parts;
}

/** Extract the boundary token from a Content-Type header value. */
export function boundaryFromContentType(contentType: string): string {
  const m = /boundary="?([^";]+)"?/i.exec(contentType);
  if (!m) throw new Error('content-type has no boundary parameter');
  return m[1]!;
}

export interface BuildPart {
  contentType: string;
  contentLocation?: string;
  body: Uint8Array;
}

/** Build a multipart/related body (STOW-RS requests). Boundary is returned
 * alongside so the caller can set the Content-Type header. */
export function buildMultipartRelated(parts: BuildPart[], boundary?: string): { body: Uint8Array; boundary: string } {
  const b = boundary ?? `carys-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const push = (u: Uint8Array): void => { chunks.push(u); total += u.length; };
  for (const p of parts) {
    push(enc.encode(`--${b}\r\nContent-Type: ${p.contentType}\r\n`));
    if (p.contentLocation) push(enc.encode(`Content-Location: ${p.contentLocation}\r\n`));
    push(enc.encode(`Content-Length: ${p.body.length}\r\n\r\n`));
    push(p.body);
    push(enc.encode('\r\n'));
  }
  push(enc.encode(`--${b}--\r\n`));
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return { body: out, boundary: b };
}

/** Keep only parts with exactly this content-type (parameters stripped at
 * parse time, so 'application/dicom' never matches 'application/dicom+json'). */
export function partsOfType(parts: import('./types.js').MultipartPart[], contentType: string): import('./types.js').MultipartPart[] {
  return parts.filter((p) => p.contentType === contentType);
}
