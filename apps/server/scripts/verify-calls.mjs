// Call signaling verification. Proves the gateway relays WebRTC signaling
// (offer/answer/ICE/end) between two members of a conversation, and refuses to
// relay to a user who is not a member. (Media itself is peer-to-peer / DTLS-SRTP
// and is not exercised here.)
import { WebSocket } from 'ws';
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
  return { userId: b.user.id, token: b.accessToken };
}
function connectWs(token) {
  const events = [];
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`);
  ws.on('message', (d) => events.push(JSON.parse(d.toString())));
  const ready = new Promise((r) => ws.once('open', r));
  const waitFor = (pred, ms = 3000) =>
    new Promise((resolve) => {
      const i = setInterval(() => {
        const f = events.find(pred);
        if (f) (clearInterval(i), resolve(f));
      }, 30);
      setTimeout(() => (clearInterval(i), resolve(null)), ms);
    });
  return { ws, ready, waitFor, send: (o) => ws.send(JSON.stringify(o)) };
}

const sfx = Date.now().toString(36);
const alice = await register('call_a_' + sfx);
const bob = await register('call_b_' + sfx);
const eve = await register('call_e_' + sfx); // not in the conversation

// Alice opens a DIRECT conversation with Bob.
const convo = await (
  await fetch(`${BASE}/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ peerUserId: bob.userId }),
  })
).json();

const aliceWs = connectWs(alice.token);
const bobWs = connectWs(bob.token);
const eveWs = connectWs(eve.token);
await Promise.all([aliceWs.ready, bobWs.ready, eveWs.ready]);
// Wait until each socket is fully subscribed server-side (pub/sub has no buffering).
await Promise.all([
  aliceWs.waitFor((e) => e.type === 'ready'),
  bobWs.waitFor((e) => e.type === 'ready'),
  eveWs.waitFor((e) => e.type === 'ready'),
]);

const callId = 'call-' + sfx;

// Offer A → B
const bobOfferP = bobWs.waitFor((e) => e.type === 'call' && e.signal.kind === 'offer');
aliceWs.send({ type: 'call', toUserId: bob.userId, conversationId: convo.id, signal: { callId, kind: 'offer', media: 'video', sdp: 'v=0 fake-offer' } });
const bobOffer = await bobOfferP;
check('bob received the call offer', bobOffer?.signal?.callId === callId && bobOffer.fromUserId === alice.userId);

// Answer B → A
const aliceAnsP = aliceWs.waitFor((e) => e.type === 'call' && e.signal.kind === 'answer');
bobWs.send({ type: 'call', toUserId: alice.userId, conversationId: convo.id, signal: { callId, kind: 'answer', sdp: 'v=0 fake-answer' } });
check('alice received the answer', (await aliceAnsP)?.signal?.kind === 'answer');

// ICE A → B
const bobIceP = bobWs.waitFor((e) => e.type === 'call' && e.signal.kind === 'ice');
aliceWs.send({ type: 'call', toUserId: bob.userId, conversationId: convo.id, signal: { callId, kind: 'ice', candidate: { candidate: 'fake', sdpMLineIndex: 0 } } });
check('bob received an ICE candidate', !!(await bobIceP));

// End B → A
const aliceEndP = aliceWs.waitFor((e) => e.type === 'call' && e.signal.kind === 'end');
bobWs.send({ type: 'call', toUserId: alice.userId, conversationId: convo.id, signal: { callId, kind: 'end' } });
check('alice received call end', (await aliceEndP)?.signal?.kind === 'end');

// Authorization: relaying to a non-member (Eve) must be refused.
const eveP = eveWs.waitFor((e) => e.type === 'call', 1200);
aliceWs.send({ type: 'call', toUserId: eve.userId, conversationId: convo.id, signal: { callId, kind: 'offer', media: 'audio', sdp: 'x' } });
check('signaling to a non-member is NOT relayed', (await eveP) === null);

aliceWs.ws.close();
bobWs.ws.close();
eveWs.ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
