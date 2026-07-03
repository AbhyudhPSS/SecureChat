// Sealed-sender verification. A sender delivers a message authorized ONLY by the
// recipient's opaque delivery token — the POST carries NO sender authentication.
// The server stores an opaque blob with no sender/conversation columns; only the
// recipient can open it and discover who sent it.
import {
  ready,
  generateDeviceIdentity,
  generateSignedPreKey,
  generateOneTimePreKeys,
  toBase64,
  fromBase64,
  utf8ToBytes,
  bytesToUtf8,
  sealTo,
  openSealed,
} from '@securechat/crypto';

const BASE = 'http://localhost:4000';
let pass = 0,
  fail = 0;
const check = (n, ok) => ((ok ? pass++ : fail++), console.log(`  ${ok ? '✓' : '✗'} ${n}`));

await ready();

async function register(name) {
  const identity = generateDeviceIdentity();
  const signedPreKey = generateSignedPreKey(identity, 1);
  const oneTimePreKeys = generateOneTimePreKeys(5, 1);
  const upload = {
    registrationId: 1 + Math.floor(Math.random() * 2_000_000_000),
    deviceName: 'verify',
    signingPublicKey: toBase64(identity.signing.publicKey),
    identityPublicKey: toBase64(identity.dh.publicKey),
    signedPreKey: {
      keyId: signedPreKey.keyId,
      publicKey: toBase64(signedPreKey.keyPair.publicKey),
      signature: toBase64(signedPreKey.signature),
    },
    oneTimePreKeys: oneTimePreKeys.map((k) => ({ keyId: k.keyId, publicKey: toBase64(k.keyPair.publicKey) })),
  };
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: name, displayName: name, password: 'super-secret-passphrase-123', device: upload }),
  });
  const b = await res.json();
  return { identity, userId: b.user.id, deviceId: b.deviceId, token: b.accessToken };
}

const sfx = Date.now().toString(36);
const sender = await register('seal_s_' + sfx);
const recipient = await register('seal_r_' + sfx);

// Recipient fetches their own delivery token (would be shared with contacts over E2EE).
const tokenRes = await fetch(`${BASE}/sealed/token`, { headers: { authorization: `Bearer ${recipient.token}` } });
const { deliveryToken } = await tokenRes.json();
check('recipient obtained a delivery token', !!deliveryToken);

// Sender fetches the recipient's PUBLIC identity key (to seal to it).
const idRes = await fetch(`${BASE}/keys/${recipient.userId}/identity`, { headers: { authorization: `Bearer ${sender.token}` } });
const recipIdentityPub = (await idRes.json()).devices.find((d) => d.deviceId === recipient.deviceId).identityPublicKey;

// Build a sealed blob: sender identity + body live INSIDE the seal.
const payload = JSON.stringify({ senderUserId: sender.userId, senderDeviceId: sender.deviceId, body: 'sealed hello — server cannot see who sent me' });
const sealed = toBase64(sealTo(fromBase64(recipIdentityPub), utf8ToBytes(payload)));

// Deliver WITHOUT any Authorization header (anonymous; authorized by the token only).
let res = await fetch(`${BASE}/sealed`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ recipientDeviceId: recipient.deviceId, deliveryToken, sealed }),
});
check('sealed delivery accepted with NO sender auth (201)', res.status === 201);

// Wrong token is rejected.
res = await fetch(`${BASE}/sealed`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ recipientDeviceId: recipient.deviceId, deliveryToken: 'wrong-token', sealed }),
});
check('wrong delivery token rejected (403)', res.status === 403);

// Recipient fetches inbox and opens the sealed blob.
res = await fetch(`${BASE}/sealed/inbox`, { headers: { authorization: `Bearer ${recipient.token}` } });
const inbox = await res.json();
check('recipient inbox has the sealed message', inbox.length >= 1);
const opened = JSON.parse(bytesToUtf8(openSealed(recipient.identity.dh, fromBase64(inbox[0].sealed))));
check('recipient recovered the hidden sender identity', opened.senderUserId === sender.userId);
check('recipient recovered the plaintext body', opened.body.startsWith('sealed hello'));

// A different user cannot open it (no sender key needed, but recipient key is required).
const attacker = await register('seal_a_' + sfx);
let attackerFailed = false;
try {
  openSealed(attacker.identity.dh, fromBase64(inbox[0].sealed));
} catch {
  attackerFailed = true;
}
check('a non-recipient cannot open the sealed blob', attackerFailed);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
