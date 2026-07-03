// End-to-end smoke test: generate real key material with @securechat/crypto and
// register through the live API into Postgres. Run with the server up.
import {
  ready,
  generateDeviceIdentity,
  generateSignedPreKey,
  generateOneTimePreKeys,
  buildPublicBundle,
} from '@securechat/crypto';

await ready();

const id = generateDeviceIdentity();
const spk = generateSignedPreKey(id, 1);
const otks = generateOneTimePreKeys(5, 1);
const bundle = buildPublicBundle(id, spk, otks[0]);

const username = 'verify_' + Date.now().toString(36);

const payload = {
  username,
  displayName: 'Verify Bot',
  password: 'correct-horse-battery-staple',
  device: {
    registrationId: 1234,
    deviceName: 'Verify CLI',
    signingPublicKey: bundle.signingPublicKey,
    identityPublicKey: bundle.identityPublicKey,
    signedPreKey: bundle.signedPreKey,
    oneTimePreKeys: otks.map((k) => ({
      keyId: k.keyId,
      publicKey: buildPublicBundle(id, spk, k).oneTimePreKey.publicKey,
    })),
  },
};

const res = await fetch('http://localhost:4000/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

const body = await res.json();
console.log('HTTP', res.status);
console.log(JSON.stringify({ ok: res.ok, user: body.user, deviceId: body.deviceId, hasToken: !!body.accessToken }, null, 2));
process.exit(res.ok ? 0 : 1);
