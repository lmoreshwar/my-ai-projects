// SSRF guard for user-supplied URLs: block private/internal destinations before the server fetches them.
const dns = require('node:dns').promises;
const net = require('node:net');

class SsrfError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SsrfError';
    this.statusCode = 400;
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let int = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    int = int * 256 + n;
  }
  return int >>> 0;
}

function inCidr4(ip, base, maskBits) {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

// Loopback, private, link-local, CGNAT, unspecified, broadcast, and special-use IPv4 ranges.
const BLOCKED_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
];

function isBlockedIpv4(ip) {
  return BLOCKED_V4.some(([base, bits]) => inCidr4(ip, base, bits));
}

function isBlockedIpv6(ip) {
  const addr = String(ip).toLowerCase().split('%')[0]; // drop any zone id
  if (addr === '::1' || addr === '::') return true; // loopback / unspecified
  const mapped = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/); // IPv4-mapped ::ffff:a.b.c.d
  if (mapped) return isBlockedIpv4(mapped[1]);
  const first = parseInt(addr.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7  unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8  multicast
  return false;
}

function isBlockedIp(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return true; // not a resolvable IP literal → fail closed
}

/**
 * Resolve a user-supplied URL and throw SsrfError unless it targets a public destination.
 * Flow: validate protocol → parse hostname → (literal IP check | DNS resolve) → block private/internal IPs.
 * `lookup` is injectable for tests; defaults to the real resolver.
 */
async function assertPublicUrl(rawUrl, { lookup = dns.lookup } = {}) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw new SsrfError('Invalid URL.');
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new SsrfError(`Blocked URL scheme "${parsed.protocol}" — only http and https are allowed.`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (!hostname) throw new SsrfError('URL has no host.');

  // A literal IP host is checked directly — no DNS needed.
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new SsrfError(`Blocked address ${hostname} — private/internal destinations are not allowed.`);
    }
    return parsed.href;
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new SsrfError(`Could not resolve host "${hostname}".`);
  }
  const list = Array.isArray(addresses) ? addresses : [addresses];
  if (!list.length) throw new SsrfError(`Host "${hostname}" did not resolve.`);
  for (const entry of list) {
    const address = entry && entry.address;
    if (!address || isBlockedIp(address)) {
      throw new SsrfError(`Blocked host "${hostname}" — it resolves to a private/internal address.`);
    }
  }
  return parsed.href;
}

module.exports = { assertPublicUrl, isBlockedIp, SsrfError };
