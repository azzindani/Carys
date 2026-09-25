// Carys access gate: Thoth's token model (Thoth app/src/proxy.ts), in nginx
// through njs, because the image is static files with no app server.
//
// With CARYS_ACCESS_KEY set, every request except /healthz needs one of:
//   - ?token=<key>: answered with a 30-day session cookie and a redirect to
//     the same URL without the token, so the key leaves the address bar;
//   - the carys_session cookie: "<exp>.<HMAC-SHA256(key, exp)>", checked for
//     its signature and its expiry, and renewed on every page load, so daily
//     use never lapses;
//   - Authorization: Bearer <key>, for scripts (they get no cookie).
// Anything else gets a plain 401 page, with no WWW-Authenticate header (a
// browser password popup can never be satisfied by a token). A wrong
// ?token= is a 401 too, not a silent pass-through. Unset: the site is open
// (local runs and CI), and deploy/start.sh says so when nginx starts.
//
// Rotating the key invalidates every session: the signature no longer
// verifies. deploy/nginx.conf wires the three variables below.
import crypto from 'crypto';

const KEY = process.env.CARYS_ACCESS_KEY || '';
const COOKIE = 'carys_session';
const TTL_S = 30 * 24 * 60 * 60;

/** Constant-time compare: njs has no crypto.timingSafeEqual. */
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function sign(exp) {
  return crypto.createHmac('sha256', KEY).update(`carys-session.${exp}`).digest('base64url');
}

function sessionValid(v) {
  const m = /^(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(v || '');
  return Boolean(m) && Number(m[1]) > Date.now() / 1000 && same(m[2], sign(m[1]));
}

function bearer(r) {
  const h = r.headersIn.Authorization || '';
  return h.startsWith('Bearer ') && same(h.slice(7), KEY);
}

/** A page load (not an asset): the sliding renewal rides on these. */
function pageLoad(r) {
  return r.method === 'GET' && (r.uri.endsWith('/') || r.uri.endsWith('.html'));
}

/** $carys_gate: open | pass | renew | login | deny. */
function gate(r) {
  if (!KEY) return 'open';
  if (r.uri === '/healthz') return 'pass';
  if (r.args.token !== undefined) return same(r.args.token, KEY) ? 'login' : 'deny';
  if (bearer(r)) return 'pass';
  if (sessionValid(r.variables[`cookie_${COOKIE}`])) return pageLoad(r) ? 'renew' : 'pass';
  return 'deny';
}

/** $carys_set_cookie: a fresh session on login and page loads, else empty
 *  (nginx sends no header for an empty add_header value). */
function setCookie(r) {
  const g = gate(r);
  if (g !== 'login' && g !== 'renew') return '';
  const exp = Math.floor(Date.now() / 1000) + TTL_S;
  const secure = r.headersIn['X-Forwarded-Proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_S}${secure}`;
}

/** $carys_dest: where a ?token= login lands, the same URL without it. */
function dest(r) {
  const at = r.variables.request_uri.indexOf('?');
  if (at < 0) return r.variables.request_uri;
  const path = r.variables.request_uri.slice(0, at);
  const kept = r.variables.request_uri.slice(at + 1).split('&')
    .filter((p) => p !== '' && p !== 'token' && !p.startsWith('token='));
  return kept.length ? `${path}?${kept.join('&')}` : path;
}

export default { gate, setCookie, dest };
