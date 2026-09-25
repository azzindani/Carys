// Digest files served as RCSB's own .cif.gz: bytes to text, un-gzipping
// unless the server already did (a server that sends Content-Encoding
// hands the browser's fetch plain text).
export async function gzipText(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
