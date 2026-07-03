// End-to-end MESSAGING verification with TWO users over real X3DH + Double Ratchet,
// through the HTTP API and the WebSocket gateway. Proves: the server only ever
// stores/forwards ciphertext, real-time delivery works, receipts flow, and a
// reply exercises the bidirectional ratchet. Run with server + infra up.
import { WebSocket } from 'ws';
import {
  ready,
  generateDeviceIdentity,
  generateSignedPreKey,
  generateOneTimePreKeys,
  buildPublicBundle,
  toBase64,
  fromBase64,
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
const WS = 'ws://localhost:4000/ws';
let pass = 0,
  fail = 0;
const check = (name, ok) => {
  (ok ? pass++ : fail++), console.log(`  ${ok ? '✓' : '✗'} ${name}`);
};

await ready();

// ── Local device material (mirrors what the web client does) ──
function newDevice() {
  const identity = generateDeviceIdentity();
  const signedPreKey = generateSignedPreKey(identity, 1);
  const oneTimePreKeys = generateOneTimePreKeys(10, 1);
  const secret = {
    identity,
    signedPreKey,
    oneTimePreKeys,
  };
  const upload = {
    registrationId: (Math.floor(Date.now()) % 2_000_000_000) + Math.floor(Math.random() * 1000),
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
  return { secret, upload };
}

async function registerUser(name) {
  const dev = newDevice();
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: name,
      displayName: name,
      password: 'super-secret-passphrase-123',
      device: dev.upload,
    }),
  });
  const body = await res.json();
  return { ...dev, userId: body.user.id, deviceId: body.deviceId, token: body.accessToken };
}

// A WebSocket client that records inbound events and lets us await them.
function connectWs(token) {
  const events = [];
  const waiters = [];
  const ws = new WebSocket(`${WS}?token=${encodeURIComponent(token)}`);
  ws.on('message', (data) => {
    const ev = JSON.parse(data.toString());
    events.push(ev);
    waiters.forEach((w, i) => {
      if (w.pred(ev)) {
        w.resolve(ev);
        waiters.splice(i, 1);
      }
    });
  });
  const ready = new Promise((r) => ws.once('open', r));
  const waitFor = (pred, ms = 4000) =>
    new Promise((resolve, reject) => {
      const existing = events.find(pred);
      if (existing) return resolve(existing);
      const t = setTimeout(() => reject(new Error('ws wait timeout')), ms);
      waiters.push({ pred, resolve: (ev) => (clearTimeout(t), resolve(ev)) });
    });
  return { ws, ready, waitFor, send: (o) => ws.send(JSON.stringify(o)) };
}

// ── Crypto session helpers (initiator + responder) ──
function initiatorSession(myIdentity, deviceBundle) {
  const init = x3dhInitiate(myIdentity, deviceBundle); // deviceBundle has the public bundle shape
  const session = initRatchetInitiator(init.sharedSecret, init.responderSignedPreKey);
  return { session, x3dh: init.message };
}
function responderSession(secret, x3dhMessage) {
  const otk =
    x3dhMessage.oneTimePreKeyId !== undefined
      ? secret.oneTimePreKeys.find((k) => k.keyId === x3dhMessage.oneTimePreKeyId)
      : undefined;
  const sharedSecret = x3dhRespond(secret.identity, secret.signedPreKey, x3dhMessage, otk);
  return initRatchetResponder(sharedSecret, secret.signedPreKey.keyPair);
}

// ── Scenario ──
const suffix = Date.now().toString(36);
const alice = await registerUser('alice_' + suffix);
const bob = await registerUser('bob_' + suffix);
check('registered two users', !!alice.userId && !!bob.userId);

// Alice opens a conversation with Bob.
let res = await fetch(`${BASE}/conversations`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.token}` },
  body: JSON.stringify({ peerUserId: bob.userId }),
});
const convo = await res.json();
check('opened DIRECT conversation', res.status === 201 && !!convo.id);

// Both connect their sockets.
const aliceWs = connectWs(alice.token);
const bobWs = connectWs(bob.token);
await Promise.all([aliceWs.ready, bobWs.ready]);
await aliceWs.waitFor((e) => e.type === 'ready');
await bobWs.waitFor((e) => e.type === 'ready');
check('both websockets ready', true);

// Alice fetches Bob's key bundle and starts a session.
res = await fetch(`${BASE}/keys/${bob.userId}/bundle`, {
  headers: { authorization: `Bearer ${alice.token}` },
});
const bundles = await res.json();
const bobDeviceBundle = bundles.devices.find((d) => d.deviceId === bob.deviceId);
check('fetched bob key bundle (with one-time prekey)', !!bobDeviceBundle?.oneTimePreKey);

const PLAINTEXT = 'Hello Bob — this is end-to-end encrypted 🔐';
const aSession = initiatorSession(alice.secret.identity, bobDeviceBundle);
const ct = ratchetEncrypt(aSession.session, utf8ToBytes(PLAINTEXT));
const envelope = {
  recipientDeviceId: bob.deviceId,
  x3dh: aSession.x3dh,
  header: ct.header,
  ciphertext: ct.body,
};

// Confirm the ciphertext does NOT contain the plaintext.
check('ciphertext does not leak plaintext', !ct.body.includes('Hello Bob') && ct.body !== PLAINTEXT);

// Alice sends via REST; Bob should receive over WS.
const bobMsgP = bobWs.waitFor((e) => e.type === 'message');
res = await fetch(`${BASE}/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.token}` },
  body: JSON.stringify({ conversationId: convo.id, senderDeviceId: alice.deviceId, envelopes: [envelope] }),
});
const sent = await res.json();
check('message accepted (201)', res.status === 201 && !!sent.messageId);

const bobMsg = await bobMsgP;
check('bob received message over websocket', bobMsg?.message?.id === sent.messageId);

// Bob decrypts using X3DH respond + ratchet.
const bSession = responderSession(bob.secret, bobMsg.message.envelope.x3dh);
const decrypted = bytesToUtf8(
  ratchetDecrypt(bSession, { header: bobMsg.message.envelope.header, body: bobMsg.message.envelope.ciphertext }),
);
check('bob decrypted to original plaintext', decrypted === PLAINTEXT);

// Alice should get a DELIVERED receipt.
const delivered = await aliceWs.waitFor((e) => e.type === 'receipt' && e.state === 'DELIVERED');
check('alice received DELIVERED receipt', delivered?.messageId === sent.messageId);

// Bob reads it → Alice gets READ receipt.
bobWs.send({ type: 'read', conversationId: convo.id, messageId: sent.messageId });
const read = await aliceWs.waitFor((e) => e.type === 'receipt' && e.state === 'READ');
check('alice received READ receipt', read?.messageId === sent.messageId);

// Typing indicator: Bob types → Alice sees it.
const typingP = aliceWs.waitFor((e) => e.type === 'typing');
bobWs.send({ type: 'typing', conversationId: convo.id, isTyping: true });
const typing = await typingP;
check('alice saw bob typing', typing?.userId === bob.userId && typing.isTyping === true);

// Reply path (bidirectional ratchet): Bob → Alice.
const REPLY = 'Got it, fully encrypted on my side too ✅';
const rct = ratchetEncrypt(bSession, utf8ToBytes(REPLY));
const aliceMsgP = aliceWs.waitFor((e) => e.type === 'message');
res = await fetch(`${BASE}/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${bob.token}` },
  body: JSON.stringify({
    conversationId: convo.id,
    senderDeviceId: bob.deviceId,
    envelopes: [{ recipientDeviceId: alice.deviceId, header: rct.header, ciphertext: rct.body }],
  }),
});
check('reply accepted (201)', res.status === 201);
const aliceMsg = await aliceMsgP;
const aliceDecrypted = bytesToUtf8(
  ratchetDecrypt(aSession.session, {
    header: aliceMsg.message.envelope.header,
    body: aliceMsg.message.envelope.ciphertext,
  }),
);
check('alice decrypted bob reply (bidirectional ratchet)', aliceDecrypted === REPLY);

// History: Bob fetches and sees the first message (addressed to his device).
res = await fetch(`${BASE}/conversations/${convo.id}/messages`, {
  headers: { authorization: `Bearer ${bob.token}` },
});
const history = await res.json();
check('bob history contains the first message with x3dh', history.some((m) => m.id === sent.messageId && !!m.envelope.x3dh));

aliceWs.ws.close();
bobWs.ws.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
