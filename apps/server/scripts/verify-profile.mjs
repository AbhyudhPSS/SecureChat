// Profile editing verification: update display name + bio, change username (with a
// taken-username conflict), and set/fetch an avatar (presigned upload → resolvable
// avatar URL).
import {
  ready,
  generateDeviceIdentity,
  generateSignedPreKey,
  generateOneTimePreKeys,
  toBase64,
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
  const b = await res.json();
  return { userId: b.user.id, token: b.accessToken, username: name };
}

const sfx = Date.now().toString(36);
const alice = await register('pf_a_' + sfx);
const bob = await register('pf_b_' + sfx);

// Update display name + bio.
let res = await fetch(`${BASE}/users/me`, {
  method: 'PATCH',
  headers: authH(alice.token),
  body: JSON.stringify({ displayName: 'Alice Updated', bio: 'hello from my bio' }),
});
let me = await res.json();
check('display name + bio updated', me.displayName === 'Alice Updated' && me.bio === 'hello from my bio');

// Change username to a free one.
const newName = 'pf_alice2_' + sfx;
res = await fetch(`${BASE}/users/me`, { method: 'PATCH', headers: authH(alice.token), body: JSON.stringify({ username: newName }) });
me = await res.json();
check('username changed', res.status === 200 && me.username === newName);

// Changing to a taken username is rejected.
res = await fetch(`${BASE}/users/me`, { method: 'PATCH', headers: authH(alice.token), body: JSON.stringify({ username: bob.username }) });
check('taken username rejected (409)', res.status === 409);

// Set an avatar: presign-upload an image, then point the profile at the blob key.
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const { blobKey, uploadUrl } = await (await fetch(`${BASE}/attachments/presign-upload`, { method: 'POST', headers: authH(alice.token), body: '{}' })).json();
const put = await fetch(uploadUrl, { method: 'PUT', body: Buffer.from(png) });
check('avatar image uploaded to storage', put.ok);

res = await fetch(`${BASE}/users/me`, { method: 'PATCH', headers: authH(alice.token), body: JSON.stringify({ avatarUrl: blobKey }) });
me = await res.json();
check('avatar blob key saved on profile', me.avatarUrl === blobKey);

// Any authenticated user can resolve the avatar to a download URL.
const avatarRes = await (await fetch(`${BASE}/users/${alice.userId}/avatar`, { headers: authH(bob.token) })).json();
check('avatar resolves to a presigned URL (visible to contacts)', typeof avatarRes.url === 'string' && avatarRes.url.includes(blobKey));

// A user with no avatar resolves to null.
const bobAvatar = await (await fetch(`${BASE}/users/${bob.userId}/avatar`, { headers: authH(alice.token) })).json();
check('no-avatar user resolves to null', bobAvatar.url === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
