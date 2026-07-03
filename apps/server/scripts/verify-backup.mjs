// Encrypted chat backup verification: store/fetch/delete an opaque blob the server
// cannot read, scoped per user, plus a real passphrase encrypt/decrypt round-trip.
import {
  ready,
  generateDeviceIdentity,
  generateSignedPreKey,
  generateOneTimePreKeys,
  toBase64,
  encryptKeystore,
  decryptKeystore,
} from '@securechat/crypto';

const BASE = 'http://localhost:4000';
let pass = 0,
  fail = 0;
const check = (n, ok) => ((ok ? pass++ : fail++), console.log(`  ${ok ? '✓' : '✗'} ${n}`));
const authH = (t) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}` });

await ready();

async function register(name) {
  const id = generateDeviceIdentity();
  const spk = generateSignedPreKey(id, 1);
  const otks = generateOneTimePreKeys(3, 1);
  const upload = {
    registrationId: 1 + Math.floor(Math.random() * 2_000_000_000),
    deviceName: 'verify',
    signingPublicKey: toBase64(id.signing.publicKey),
    identityPublicKey: toBase64(id.dh.publicKey),
    signedPreKey: { keyId: 1, publicKey: toBase64(spk.keyPair.publicKey), signature: toBase64(spk.signature) },
    oneTimePreKeys: otks.map((k) => ({ keyId: k.keyId, publicKey: toBase64(k.keyPair.publicKey) })),
  };
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: name, displayName: name, password: 'super-secret-passphrase-123', device: upload }),
  });
  return (await res.json()).accessToken;
}

const sfx = Date.now().toString(36);
const alice = await register('bk_a_' + sfx);
const bob = await register('bk_b_' + sfx);

// Client-side encrypt a backup bundle with a passphrase.
const bundle = { v: 1, messages: { c1: [{ id: 'm1', text: 'remembered history 🔐' }] } };
const blob = JSON.stringify(encryptKeystore('backup-passphrase-123', bundle));
check('encrypted backup does not contain plaintext', !blob.includes('remembered history'));

// Store it.
let res = await fetch(`${BASE}/backup`, { method: 'PUT', headers: authH(alice), body: JSON.stringify({ blob }) });
check('backup stored (PUT)', res.ok);

// Info reflects it.
const info = await (await fetch(`${BASE}/backup/info`, { headers: authH(alice) })).json();
check('backup info: exists + size', info.exists === true && info.size > 0);

// Fetch + decrypt with the right passphrase.
const got = await (await fetch(`${BASE}/backup`, { headers: authH(alice) })).json();
check('fetched blob matches stored', got.blob === blob);
const restored = decryptKeystore('backup-passphrase-123', JSON.parse(got.blob));
check('restore with correct passphrase yields the bundle', restored.messages.c1[0].text === 'remembered history 🔐');

// Wrong passphrase fails.
let wrongFailed = false;
try {
  decryptKeystore('wrong-passphrase', JSON.parse(got.blob));
} catch {
  wrongFailed = true;
}
check('restore with wrong passphrase fails', wrongFailed);

// Per-user isolation: Bob has no backup.
const bobInfo = await (await fetch(`${BASE}/backup/info`, { headers: authH(bob) })).json();
check("another user's backup is separate (none)", bobInfo.exists === false);

// Delete.
res = await fetch(`${BASE}/backup`, { method: 'DELETE', headers: authH(alice) });
const afterInfo = await (await fetch(`${BASE}/backup/info`, { headers: authH(alice) })).json();
check('backup deleted', res.ok && afterInfo.exists === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
