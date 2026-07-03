// Group-call mesh signaling: an invite fans out to all members; a joiner's `join`
// reaches every other in-call member (so the mesh can form); non-members are
// excluded. (Pairwise offer/answer/ICE relay is covered by verify-calls.mjs.)
import {
  ready,
  generateDeviceIdentity,
  generateSignedPreKey,
  generateOneTimePreKeys,
  toBase64,
} from '@securechat/crypto';
import { WebSocket } from 'ws';

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
const a = await register('gc_a_' + sfx);
const b = await register('gc_b_' + sfx);
const c = await register('gc_c_' + sfx);
const d = await register('gc_d_' + sfx); // not in the group

const group = await (
  await fetch(`${BASE}/conversations/group`, {
    method: 'POST',
    headers: authH(a.token),
    body: JSON.stringify({ title: 'Call Squad', memberUserIds: [b.userId, c.userId] }),
  })
).json();
check('group created', group.type === 'GROUP' && group.memberCount === 3);

const aw = connectWs(a.token);
const bw = connectWs(b.token);
const cw = connectWs(c.token);
const dw = connectWs(d.token);
await Promise.all([aw.ready, bw.ready, cw.ready, dw.ready]);
await Promise.all([
  aw.waitFor((e) => e.type === 'ready'),
  bw.waitFor((e) => e.type === 'ready'),
  cw.waitFor((e) => e.type === 'ready'),
  dw.waitFor((e) => e.type === 'ready'),
]);

const callId = 'gcall-' + sfx;

// A invites B and C.
const bInv = bw.waitFor((e) => e.type === 'call' && e.signal.kind === 'invite');
const cInv = cw.waitFor((e) => e.type === 'call' && e.signal.kind === 'invite');
aw.send({ type: 'call', toUserId: b.userId, conversationId: group.id, signal: { callId, kind: 'invite', media: 'video', isGroup: true } });
aw.send({ type: 'call', toUserId: c.userId, conversationId: group.id, signal: { callId, kind: 'invite', media: 'video', isGroup: true } });
check('invite reached B', (await bInv)?.signal?.callId === callId);
check('invite reached C', (await cInv)?.signal?.callId === callId);

// B accepts → broadcasts `join` to the other members (A and C).
const aJoin = aw.waitFor((e) => e.type === 'call' && e.signal.kind === 'join');
const cJoin = cw.waitFor((e) => e.type === 'call' && e.signal.kind === 'join');
bw.send({ type: 'call', toUserId: a.userId, conversationId: group.id, signal: { callId, kind: 'join' } });
bw.send({ type: 'call', toUserId: c.userId, conversationId: group.id, signal: { callId, kind: 'join' } });
check("A received B's join", (await aJoin)?.fromUserId === b.userId);
check("C received B's join (mesh forms)", (await cJoin)?.fromUserId === b.userId);

// Non-member D is excluded.
const dInv = dw.waitFor((e) => e.type === 'call', 1200);
aw.send({ type: 'call', toUserId: d.userId, conversationId: group.id, signal: { callId, kind: 'invite', media: 'audio', isGroup: true } });
check('non-member is not invited into the group call', (await dInv) === null);

aw.ws.close();
bw.ws.close();
cw.ws.close();
dw.ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
