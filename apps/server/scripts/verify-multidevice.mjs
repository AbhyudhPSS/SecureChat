// Multi-device verification: one user with TWO devices. A message sent from
// device1 also syncs to device2 (own-device fan-out). Then device management:
// list devices, revoke device2, confirm it drops out of prekey bundles and can no
// longer refresh its session.
import { WebSocket } from 'ws';
import {
  ready,
  generateDeviceIdentity,
  generateSignedPreKey,
  generateOneTimePreKeys,
  toBase64,
  utf8ToBytes,
  bytesToUtf8,
  x3dhInitiate,
  x3dhRespond,
  initRatchetInitiator,
  initRatchetResponder,
  ratchetEncrypt,
  ratchetDecrypt,
} from '@securechat/crypto';

const BASE = 'http://localhost:4000';
let pass = 0,
  fail = 0;
const check = (n, ok) => ((ok ? pass++ : fail++), console.log(`  ${ok ? '✓' : '✗'} ${n}`));

await ready();

function makeBundle() {
  const identity = generateDeviceIdentity();
  const signedPreKey = generateSignedPreKey(identity, 1);
  const oneTimePreKeys = generateOneTimePreKeys(10, 1);
  const upload = {
    registrationId: 1 + Math.floor(Math.random() * 2_000_000_000),
    deviceName: 'verify-device',
    signingPublicKey: toBase64(identity.signing.publicKey),
    identityPublicKey: toBase64(identity.dh.publicKey),
    signedPreKey: {
      keyId: signedPreKey.keyId,
      publicKey: toBase64(signedPreKey.keyPair.publicKey),
      signature: toBase64(signedPreKey.signature),
    },
    oneTimePreKeys: oneTimePreKeys.map((k) => ({ keyId: k.keyId, publicKey: toBase64(k.keyPair.publicKey) })),
  };
  return { identity, signedPreKey, oneTimePreKeys, upload };
}
function refreshCookie(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = /sc_refresh=([^;]+)/.exec(c);
    if (m) return m[1];
  }
  return null;
}
async function register(username, password) {
  const b = makeBundle();
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, displayName: username, password, device: b.upload }),
  });
  const body = await res.json();
  return { ...b, userId: body.user.id, deviceId: body.deviceId, token: body.accessToken };
}
async function addDevice(username, password) {
  const b = makeBundle();
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, device: b.upload }),
  });
  const body = await res.json();
  return { ...b, userId: body.user.id, deviceId: body.deviceId, token: body.accessToken, refresh: refreshCookie(res) };
}
function connectWs(token) {
  const events = [];
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`);
  ws.on('message', (d) => events.push(JSON.parse(d.toString())));
  const ready = new Promise((r) => ws.once('open', r));
  const waitFor = (pred, ms = 5000) =>
    new Promise((resolve, reject) => {
      const i = setInterval(() => {
        const f = events.find(pred);
        if (f) (clearInterval(i), resolve(f));
      }, 50);
      setTimeout(() => (clearInterval(i), reject(new Error('timeout'))), ms);
    });
  return { ws, ready, waitFor };
}

const sfx = Date.now().toString(36);
const password = 'super-secret-passphrase-123';
const d1 = await register('md_' + sfx, password);
const d2 = await addDevice('md_' + sfx, password);
const peer = await register('mdpeer_' + sfx, password);
check('user has two devices', d1.deviceId !== d2.deviceId && d1.userId === d2.userId);

// device1 opens a conversation with the peer.
let res = await fetch(`${BASE}/conversations`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${d1.token}` },
  body: JSON.stringify({ peerUserId: peer.userId }),
});
const convo = await res.json();

const d2ws = connectWs(d2.token);
await d2ws.ready;
await d2ws.waitFor((e) => e.type === 'ready');

// device1 sends to peer AND to its own device2 (own-device fan-out).
const peerBundle = (await (await fetch(`${BASE}/keys/${peer.userId}/bundle`, { headers: { authorization: `Bearer ${d1.token}` } })).json()).devices[0];
const ownBundles = (await (await fetch(`${BASE}/keys/${d1.userId}/bundle`, { headers: { authorization: `Bearer ${d1.token}` } })).json()).devices;
const d2Bundle = ownBundles.find((d) => d.deviceId === d2.deviceId);
check('own-bundle fetch returns the other device', !!d2Bundle);

const TEXT = 'multi-device sync test ✅';
const toPeer = x3dhInitiate(d1.identity, peerBundle);
const sPeer = initRatchetInitiator(toPeer.sharedSecret, toPeer.responderSignedPreKey);
const ctPeer = ratchetEncrypt(sPeer, utf8ToBytes(TEXT));
const toSelf = x3dhInitiate(d1.identity, d2Bundle);
const sSelf = initRatchetInitiator(toSelf.sharedSecret, toSelf.responderSignedPreKey);
const ctSelf = ratchetEncrypt(sSelf, utf8ToBytes(TEXT));

const d2MsgP = d2ws.waitFor((e) => e.type === 'message');
res = await fetch(`${BASE}/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${d1.token}` },
  body: JSON.stringify({
    conversationId: convo.id,
    senderDeviceId: d1.deviceId,
    envelopes: [
      { recipientDeviceId: peer.deviceId, x3dh: toPeer.message, header: ctPeer.header, ciphertext: ctPeer.body },
      { recipientDeviceId: d2.deviceId, x3dh: toSelf.message, header: ctSelf.header, ciphertext: ctSelf.body },
    ],
  }),
});
check('message accepted', res.status === 201);

// device2 receives its own copy and decrypts it.
const d2Msg = await d2MsgP;
const otk = d2Msg.message.envelope.x3dh.oneTimePreKeyId !== undefined
  ? d2.oneTimePreKeys.find((k) => k.keyId === d2Msg.message.envelope.x3dh.oneTimePreKeyId)
  : undefined;
const ssD2 = x3dhRespond(d2.identity, d2.signedPreKey, d2Msg.message.envelope.x3dh, otk);
const sD2 = initRatchetResponder(ssD2, d2.signedPreKey.keyPair);
const got = bytesToUtf8(ratchetDecrypt(sD2, { header: d2Msg.message.envelope.header, body: d2Msg.message.envelope.ciphertext }));
check('device2 received & decrypted device1’s message (multi-device sync)', got === TEXT);

// Device management: list, then revoke device2.
const devices = await (await fetch(`${BASE}/devices`, { headers: { authorization: `Bearer ${d1.token}` } })).json();
check('GET /devices lists both devices', devices.length === 2);
check('current device flagged correctly', devices.find((d) => d.id === d1.deviceId)?.current === true);

res = await fetch(`${BASE}/devices/${d2.deviceId}`, { method: 'DELETE', headers: { authorization: `Bearer ${d1.token}` } });
check('revoke device2 → ok', res.ok);

const afterDevices = await (await fetch(`${BASE}/devices`, { headers: { authorization: `Bearer ${d1.token}` } })).json();
check('revoked device removed from device list', afterDevices.length === 1);

const bundleAfter = await (await fetch(`${BASE}/keys/${d1.userId}/bundle`, { headers: { authorization: `Bearer ${peer.token}` } })).json();
check('revoked device excluded from prekey bundles', !bundleAfter.devices.some((d) => d.deviceId === d2.deviceId));

res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { cookie: `sc_refresh=${d2.refresh}` } });
check('revoked device cannot refresh its session (401)', res.status === 401);

d2ws.ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
