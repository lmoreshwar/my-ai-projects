// Regression tests for the SSRF guard — protocol, literal-IP, and DNS-resolution block paths.
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertPublicUrl, isBlockedIp, SsrfError } = require('./ssrf_guard');

// A fake resolver so tests never touch the network: maps a hostname to the IPs it "resolves" to.
const fakeLookup = (map) => async (host) => {
  const ips = map[host];
  if (!ips) throw new Error('ENOTFOUND');
  return ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

test('isBlockedIp classifies private/reserved IPv4 + IPv6', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.5', '192.168.0.1', '169.254.10.10', '0.0.0.0', '100.64.0.1']) {
    assert.equal(isBlockedIp(ip), true, `${ip} must be blocked`);
  }
  for (const ip of ['::1', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isBlockedIp(ip), true, `${ip} must be blocked`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '140.82.112.3', '2606:4700:4700::1111']) {
    assert.equal(isBlockedIp(ip), false, `${ip} must be allowed`);
  }
});

test('rejects a non-http(s) scheme', async () => {
  await assert.rejects(() => assertPublicUrl('file:///etc/passwd'), SsrfError);
  await assert.rejects(() => assertPublicUrl('gopher://evil/'), /only http and https/);
});

test('rejects a malformed URL', async () => {
  await assert.rejects(() => assertPublicUrl('not a url'), SsrfError);
});

test('blocks a literal private-IP host without DNS', async () => {
  await assert.rejects(() => assertPublicUrl('http://169.254.169.254/latest/meta-data/'), /private\/internal/);
  await assert.rejects(() => assertPublicUrl('http://127.0.0.1:5000/'), SsrfError);
  await assert.rejects(() => assertPublicUrl('http://[::1]:8080/'), SsrfError);
});

test('allows a literal public-IP host', async () => {
  assert.equal(await assertPublicUrl('https://8.8.8.8/'), 'https://8.8.8.8/');
});

test('blocks a public-looking host that RESOLVES to a private IP (DNS-rebinding style)', async () => {
  const lookup = fakeLookup({ 'internal.evil.test': ['10.0.0.5'] });
  await assert.rejects(() => assertPublicUrl('https://internal.evil.test/', { lookup }), /private\/internal/);
});

test('blocks when ANY resolved address is private', async () => {
  const lookup = fakeLookup({ 'mixed.evil.test': ['140.82.112.3', '127.0.0.1'] });
  await assert.rejects(() => assertPublicUrl('https://mixed.evil.test/', { lookup }), SsrfError);
});

test('allows a host that resolves only to public IPs', async () => {
  const lookup = fakeLookup({ 'api.github.com': ['140.82.112.6'] });
  assert.equal(await assertPublicUrl('https://api.github.com', { lookup }), 'https://api.github.com/');
});

test('blocks a host that fails to resolve (fail closed)', async () => {
  const lookup = fakeLookup({});
  await assert.rejects(() => assertPublicUrl('https://nope.invalid/', { lookup }), /Could not resolve/);
});
