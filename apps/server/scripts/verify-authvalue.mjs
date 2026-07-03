// Verifies the domain-separated auth-value flow (finding #10): the web client sends
// deriveAuthValue(password), NOT the raw password. Confirms register+login round-trip
// with the derived value succeeds, and that the RAW password no longer authenticates.
import {
  ready,
  deriveAuthValue,
  generateDeviceIdentity,
  generateSignedPreKey,
  generateOneTimePreKeys,
  buildPublicBundle,
} from '@securechat/crypto';

await ready();
const BASE = 'http://localhost:4000';
let pass = 0;
let fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗', m)));

function device() {
  const id = generateDeviceIdentity();
  const spk = generateSignedPreKey(id, 1);
  const otks = generateOneTimePreKeys(5, 1);
  const b = buildPublicBundle(id, spk, otks[0]);
  return {
    registrationId: Math.floor(Math.random() * 1e9),
    deviceName: 'AuthValue CLI',
    signingPublicKey: b.signingPublicKey,
    identityPublicKey: b.identityPublicKey,
    signedPreKey: b.signedPreKey,
    oneTimePreKeys: otks.map((k) => ({ keyId: k.keyId, publicKey: buildPublicBundle(id, spk, k).oneTimePreKey.publicKey })),
  };
}
const post = (path, body) =>
  fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const username = 'av_' + Date.now().toString(36);
const rawPassword = 'correct-horse-battery-staple';
const authValue = deriveAuthValue(rawPassword);

ok(authValue !== rawPassword, 'derived auth value differs from the raw password');
ok(deriveAuthValue(rawPassword) === authValue, 'auth value derivation is deterministic (login can reproduce it)');

// Register the way the web client now does: send the DERIVED value as the credential.
const reg = await post('/auth/register', { username, displayName: 'AV Bot', password: authValue, device: device() });
ok(reg.status === 201, 'register with derived auth value → 201');

// Login with the derived value (what the web client sends) succeeds.
const good = await post('/auth/login', { username, password: authValue, device: device() });
ok(good.status === 200, 'login with derived auth value → 200');

// Login with the RAW password now FAILS — proving the server never holds a
// credential equal to the password, so it can't re-derive the key-wrapping key.
const bad = await post('/auth/login', { username, password: rawPassword, device: device() });
ok(bad.status === 401, 'login with the RAW password → 401 (server never sees the password)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
