// Group chat verification: create a group, fan a message out to all members
// (each decrypts via its own pairwise ratchet), enforce admin roles, add/remove
// members, and confirm non-members are rejected. Server only sees ciphertext.
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
const authH = (t) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}` });

await ready();

function makeBundle() {
  const identity = generateDeviceIdentity();
  const signedPreKey = generateSignedPreKey(identity, 1);
  const oneTimePreKeys = generateOneTimePreKeys(20, 1);
  return {
    identity,
    signedPreKey,
    oneTimePreKeys,
    upload: {
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
    },
  };
}
async function register(name) {
  const b = makeBundle();
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: name, displayName: name, password: 'super-secret-passphrase-123', device: b.upload }),
  });
  const body = await res.json();
  const u = { ...b, userId: body.user.id, deviceId: body.deviceId, token: body.accessToken, sessions: new Map() };
  return u;
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

// sender encrypts `text` to each recipient userId and posts one group message.
async function sendGroup(sender, conversationId, recipientUserIds, text) {
  const envelopes = [];
  for (const uid of recipientUserIds) {
    const bundle = (await (await fetch(`${BASE}/keys/${uid}/bundle`, { headers: authH(sender.token) })).json()).devices[0];
    const init = x3dhInitiate(sender.identity, bundle);
    const session = initRatchetInitiator(init.sharedSecret, init.responderSignedPreKey);
    const ct = ratchetEncrypt(session, utf8ToBytes(text));
    envelopes.push({ recipientDeviceId: bundle.deviceId, x3dh: init.message, header: ct.header, ciphertext: ct.body });
  }
  return fetch(`${BASE}/messages`, {
    method: 'POST',
    headers: authH(sender.token),
    body: JSON.stringify({ conversationId, senderDeviceId: sender.deviceId, envelopes }),
  });
}
function decryptInbound(recipient, msg) {
  const otk = msg.envelope.x3dh.oneTimePreKeyId !== undefined
    ? recipient.oneTimePreKeys.find((k) => k.keyId === msg.envelope.x3dh.oneTimePreKeyId)
    : undefined;
  const ss = x3dhRespond(recipient.identity, recipient.signedPreKey, msg.envelope.x3dh, otk);
  const session = initRatchetResponder(ss, recipient.signedPreKey.keyPair);
  return bytesToUtf8(ratchetDecrypt(session, { header: msg.envelope.header, body: msg.envelope.ciphertext }));
}

const sfx = Date.now().toString(36);
const alice = await register('ga_' + sfx); // owner
const bob = await register('gb_' + sfx);
const carol = await register('gc_' + sfx);
const dave = await register('gd_' + sfx); // added later
const eve = await register('ge_' + sfx); // never a member

// Alice creates a group with Bob + Carol.
let res = await fetch(`${BASE}/conversations/group`, {
  method: 'POST',
  headers: authH(alice.token),
  body: JSON.stringify({ title: 'Secret Squad', memberUserIds: [bob.userId, carol.userId] }),
});
const group = await res.json();
check('group created', res.status === 201 && group.type === 'GROUP' && group.memberCount === 3);

// Detail + roles.
const detail = await (await fetch(`${BASE}/conversations/${group.id}`, { headers: authH(alice.token) })).json();
check('owner role assigned to creator', detail.members.find((m) => m.user.id === alice.userId)?.role === 'OWNER');
check('non-member cannot read group detail', (await fetch(`${BASE}/conversations/${group.id}`, { headers: authH(eve.token) })).status === 403);

// Bob + Carol online; Alice sends to the group.
const bobWs = connectWs(bob.token);
const carolWs = connectWs(carol.token);
await Promise.all([bobWs.ready, carolWs.ready]);
await Promise.all([bobWs.waitFor((e) => e.type === 'ready'), carolWs.waitFor((e) => e.type === 'ready')]);

const MSG = 'hello group — encrypted to each member 🔐';
const bobP = bobWs.waitFor((e) => e.type === 'message');
const carolP = carolWs.waitFor((e) => e.type === 'message');
res = await sendGroup(alice, group.id, [bob.userId, carol.userId], MSG);
check('group message accepted', res.status === 201);
const [bobMsg, carolMsg] = await Promise.all([bobP, carolP]);
check('bob decrypted group message', decryptInbound(bob, bobMsg.message) === MSG);
check('carol decrypted group message', decryptInbound(carol, carolMsg.message) === MSG);

// Role enforcement: Bob (member) cannot add; Alice promotes Bob; then Bob can add Dave.
check(
  'non-admin cannot add members (403)',
  (await fetch(`${BASE}/conversations/${group.id}/members`, { method: 'POST', headers: authH(bob.token), body: JSON.stringify({ userIds: [dave.userId] }) })).status === 403,
);
res = await fetch(`${BASE}/conversations/${group.id}/members/${bob.userId}`, { method: 'PATCH', headers: authH(alice.token), body: JSON.stringify({ role: 'ADMIN' }) });
check('owner promoted bob to admin', res.ok);
res = await fetch(`${BASE}/conversations/${group.id}/members`, { method: 'POST', headers: authH(bob.token), body: JSON.stringify({ userIds: [dave.userId] }) });
check('admin (bob) added dave', res.ok);

// Dave now receives a group message.
const daveWs = connectWs(dave.token);
await daveWs.ready;
await daveWs.waitFor((e) => e.type === 'ready');
const daveP = daveWs.waitFor((e) => e.type === 'message');
res = await sendGroup(alice, group.id, [bob.userId, carol.userId, dave.userId], 'welcome dave');
check('message to expanded group accepted', res.status === 201);
check('dave decrypted his first group message', decryptInbound(dave, (await daveP).message) === 'welcome dave');

// Remove Carol; she becomes a non-member.
res = await fetch(`${BASE}/conversations/${group.id}/members/${carol.userId}`, { method: 'DELETE', headers: authH(alice.token) });
check('owner removed carol', res.ok);
const detail2 = await (await fetch(`${BASE}/conversations/${group.id}`, { headers: authH(alice.token) })).json();
check('carol no longer a member', !detail2.members.some((m) => m.user.id === carol.userId));

// Sending an envelope to a non-member device is rejected.
res = await sendGroup(alice, group.id, [carol.userId], 'should fail');
check('sending to non-member device rejected (400)', res.status === 400);

// Self-leave.
res = await fetch(`${BASE}/conversations/${group.id}/members/${dave.userId}`, { method: 'DELETE', headers: authH(dave.token) });
check('member can leave (self)', res.ok);

bobWs.ws.close();
carolWs.ws.close();
daveWs.ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
