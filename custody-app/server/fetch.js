// Fetching a calendar someone pasted (Google / iCloud / Outlook secret address) without letting it reach
// the server's own network (SSRF):
//  - https only (webcal:// is rewritten to https://);
//  - the host name is resolved by our own lookup, every address is checked, and the connection is made to the
//    checked address (no second DNS lookup an attacker could answer differently); TLS still verifies the
//    certificate against the host name (SNI);
//  - no redirects, a 15 second timeout, and a hard 5 MB cap on the body, enforced while it streams.
// `allowPrivate` (ALLOW_PRIVATE_FEEDS=1, development and tests only) lifts the address and https checks.
import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import { bad } from './http.js';

export const MAX_CALENDAR_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15000;

function v4ToInt(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
const inV4 = (ip, base, bits) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((v4ToInt(ip) & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
};
const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

/** Expands an IPv6 address to 8 16-bit groups (handles :: and an embedded dotted IPv4 tail). */
function v6Groups(ip) {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  let tail = [];
  const m = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) {
    const n = v4ToInt(m[1]);
    tail = [(n >>> 16) & 0xffff, n & 0xffff];
    s = s.slice(0, -m[1].length).replace(/:$/, '') || ':';
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1);
  }
  const [head, rest] = s.includes('::') ? s.split('::') : [s, null];
  const h = head ? head.split(':').filter(Boolean).map(x => parseInt(x, 16)) : [];
  const r = rest != null ? rest.split(':').filter(Boolean).map(x => parseInt(x, 16)) : [];
  const fill = 8 - tail.length - h.length - r.length;
  return [...h, ...(rest != null ? Array(Math.max(0, fill)).fill(0) : []), ...r, ...tail];
}

/** True for loopback, private, link-local, CGNAT, documentation, benchmarking, multicast and reserved addresses (v4 and v6). */
export function isPrivate(ip) {
  const kind = isIP(String(ip).replace(/^\[|\]$/g, '').split('%')[0]);
  if (kind === 4) return V4_BLOCKED.some(([b, bits]) => inV4(ip, b, bits));
  if (kind !== 6) return true; // not an address: refuse
  const g = v6Groups(ip);
  if (g.length !== 8 || g.some(x => !Number.isInteger(x) || x < 0 || x > 0xffff)) return true;
  const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (g.slice(0, 7).every(x => x === 0)) return true;                                         // :: and ::1 (and ::a.b.c.d, deprecated)
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return isPrivate(v4);             // ::ffff:a.b.c.d (IPv4-mapped)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return isPrivate(v4); // 64:ff9b::/96 (NAT64)
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;                            // 64:ff9b:1::/48 (local NAT64)
  if ((g[0] & 0xfe00) === 0xfc00) return true;                                                // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true;                                                // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true;                                                // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true;                                                // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                                        // 2001:db8::/32 documentation
  if (g[0] === 0x2002) return isPrivate(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`); // 6to4 embeds an IPv4 address
  if (g[0] === 0x0100 && g.slice(1, 4).every(x => x === 0)) return true;                      // 100::/64 discard
  return false;
}

/** dns.lookup replacement for http(s).request: resolves, refuses if any address is private, returns only checked addresses. */
function checkedLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  dnsLookup(hostname, { all: true }, (err, addrs) => {
    if (err) return callback(Object.assign(new Error('Could not resolve calendar host'), { code: 'ENOTFOUND' }));
    if (!addrs.length || addrs.some(a => isPrivate(a.address))) return callback(Object.assign(new Error('That calendar address is not allowed'), { code: 'EBLOCKED' }));
    const wanted = options.family ? addrs.filter(a => a.family === options.family) : addrs;
    const list = wanted.length ? wanted : addrs;
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

/** GET a calendar feed as text. Throws a 400 HttpError with a user-facing message. */
export async function fetchCalendar(rawUrl, { allowPrivate = false, maxBytes = MAX_CALENDAR_BYTES, timeoutMs = TIMEOUT_MS } = {}) {
  let u;
  try { u = new URL(String(rawUrl).trim().replace(/^webcals?:\/\//i, 'https://')); } catch { throw bad('Enter a valid calendar URL'); }
  if (u.protocol !== 'https:' && !(allowPrivate && u.protocol === 'http:')) throw bad('Calendar URL must use https');
  if (u.username || u.password) throw bad('Calendar URL must not contain a user name or password');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && isIP(host) && isPrivate(host)) throw bad('That calendar address is not allowed');

  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    let settled = false, timer = null;
    const fail = (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } };
    const req = mod.request({
      protocol: u.protocol, hostname: host, port: u.port || undefined, path: `${u.pathname}${u.search}`, method: 'GET',
      headers: { 'User-Agent': 'CoParentHub/1.0 (calendar sync)', Accept: 'text/calendar, */*', 'Accept-Encoding': 'identity' },
      servername: isIP(host) ? undefined : host,
      ...(allowPrivate ? {} : { lookup: checkedLookup }),
      agent: false,
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); return fail(bad('The calendar address redirects; paste the final address')); }
      if (res.statusCode !== 200) { res.resume(); return fail(bad(`Calendar server returned ${res.statusCode}`)); }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) { res.destroy(); return fail(bad('Calendar is too large (5 MB at most)')); }
      const chunks = []; let size = 0;
      res.on('data', (ch) => {
        size += ch.length;
        if (size > maxBytes) { res.destroy(); req.destroy(); fail(bad('Calendar is too large (5 MB at most)')); return; }
        chunks.push(ch);
      });
      res.on('end', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf8')); } });
      res.on('error', () => fail(bad('The calendar download was interrupted')));
    });
    timer = setTimeout(() => { req.destroy(); fail(bad('The calendar server took too long to answer')); }, timeoutMs);
    timer.unref?.();
    req.on('timeout', () => { req.destroy(); fail(bad('The calendar server took too long to answer')); });
    req.on('error', (e) => fail(bad(e.code === 'EBLOCKED' ? 'That calendar address is not allowed' : e.code === 'ENOTFOUND' ? 'Could not resolve calendar host' : `Could not fetch the calendar (${e.code || e.message})`)));
    req.end();
  });
}
