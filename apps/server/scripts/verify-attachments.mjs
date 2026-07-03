// End-to-end ENCRYPTED ATTACHMENT verification: Alice encrypts a file with a
// per-file key, uploads ciphertext to MinIO via a presigned URL, sends a file
// message; Bob receives it over WS, downloads + decrypts; a non-member (Carol) is
// denied download. Proves the server only ever holds ciphertext blobs.
import { WebSocket } from 'ws';
import {
  ready,
  generateDeviceIdentity,
  generateSignedPreKey,
  generateOneTimePreKeys,
  toBase64,
  fromBase64,
  utf8ToBytes,
  bytesToUtf8,
  encryptFile,
  decryptFile,
  x3dhInitiate,
  x3dhRespond,
  initRatchetInitiator,
  initRatchetResponder,
  ratchetEncrypt,
  ratchetDecrypt,
  sodium,
} from '@securechat/crypto';

const BASE = 'http://localhost:4000';
let pass = 0,
  fail = 0;
const check = (n, ok) => ((ok ? pass++ : fail++), console.log(`  ${ok ? '✓' : '✗'} ${n}`));

await ready();

function newDevice() {
  const identity = generateDeviceIdentity();
  const signedPreKey = generateSignedPreKey(identity, 1);
  const oneTimePreKeys = generateOneTimePreKeys(10, 1);
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
  return { identity, signedPreKey, oneTimePreKeys, upload };
}
async function register(name) {
  const dev = newDevice();
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: name, displayName: name, password: 'super-secret-passphrase-123', device: dev.upload }),
  });
  const b = await res.json();
  return { ...dev, userId: b.user.id, deviceId: b.deviceId, token: b.accessToken };
}
function connectWs(token) {
  const events = [];
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`);
  ws.on('message', (d) => events.push(JSON.parse(d.toString())));
  const ready = new Promise((r) => ws.once('open', r));
  const waitFor = (pred, ms = 5000) =>
    new Promise((resolve, reject) => {
      const found = events.find(pred);
      if (found) return resolve(found);
      const t = setInterval(() => {
        const f = events.find(pred);
        if (f) (clearInterval(t), resolve(f));
      }, 50);
      setTimeout(() => (clearInterval(t), reject(new Error('timeout'))), ms);
    });
  return { ws, ready, waitFor };
}

const sfx = Date.now().toString(36);
const alice = await register('att_a_' + sfx);
const bob = await register('att_b_' + sfx);
const carol = await register('att_c_' + sfx);
check('registered three users', !!alice.userId && !!bob.userId && !!carol.userId);

let res = await fetch(`${BASE}/conversations`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.token}` },
  body: JSON.stringify({ peerUserId: bob.userId }),
});
const convo = await res.json();

const bobWs = connectWs(bob.token);
await bobWs.ready;
await bobWs.waitFor((e) => e.type === 'ready');

// 1) Alice encrypts a "file" and uploads the ciphertext via presigned URL.
const fileData = sodium.randombytes_buf(2048);
const enc = encryptFile(fileData);
res = await fetch(`${BASE}/attachments/presign-upload`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.token}` },
  body: '{}',
});
const { blobKey, uploadUrl } = await res.json();
check('got presigned upload url', !!uploadUrl && !!blobKey);
const put = await fetch(uploadUrl, { method: 'PUT', body: Buffer.from(enc.ciphertext) });
check('uploaded ciphertext to storage', put.ok);

// 2) Alice sends a file message (key travels inside the E2EE body).
const bobBundleRes = await fetch(`${BASE}/keys/${bob.userId}/bundle`, { headers: { authorization: `Bearer ${alice.token}` } });
const bobBundle = (await bobBundleRes.json()).devices.find((d) => d.deviceId === bob.deviceId);
const init = x3dhInitiate(alice.identity, bobBundle);
const aSession = initRatchetInitiator(init.sharedSecret, init.responderSignedPreKey);
const payload = JSON.stringify({
  t: 'file',
  attachment: { kind: 'file', name: 'secret.bin', mime: 'application/octet-stream', size: fileData.length, blobKey, key: enc.key },
});
const ct = ratchetEncrypt(aSession, utf8ToBytes(payload));
const bobMsgP = bobWs.waitFor((e) => e.type === 'message');
res = await fetch(`${BASE}/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.token}` },
  body: JSON.stringify({
    conversationId: convo.id,
    senderDeviceId: alice.deviceId,
    envelopes: [{ recipientDeviceId: bob.deviceId, x3dh: init.message, header: ct.header, ciphertext: ct.body }],
    attachments: [{ blobKey, byteSize: enc.ciphertext.length }],
  }),
});
check('file message accepted', res.status === 201);

// 3) Bob receives, decrypts the body, downloads + decrypts the file.
const bobMsg = await bobMsgP;
const bSession = (() => {
  const otk = bobMsg.message.envelope.x3dh.oneTimePreKeyId !== undefined
    ? bob.oneTimePreKeys.find((k) => k.keyId === bobMsg.message.envelope.x3dh.oneTimePreKeyId)
    : undefined;
  const ss = x3dhRespond(bob.identity, bob.signedPreKey, bobMsg.message.envelope.x3dh, otk);
  return initRatchetResponder(ss, bob.signedPreKey.keyPair);
})();
const decodedPayload = JSON.parse(bytesToUtf8(ratchetDecrypt(bSession, { header: bobMsg.message.envelope.header, body: bobMsg.message.envelope.ciphertext })));
check('bob decrypted file payload (got key + blobKey)', decodedPayload.t === 'file' && !!decodedPayload.attachment.key);

res = await fetch(`${BASE}/attachments/download?blobKey=${encodeURIComponent(decodedPayload.attachment.blobKey)}`, {
  headers: { authorization: `Bearer ${bob.token}` },
});
const { downloadUrl } = await res.json();
const dl = await fetch(downloadUrl);
const cipher = new Uint8Array(await dl.arrayBuffer());
const recovered = decryptFile(fromBase64(decodedPayload.attachment.key), cipher);
check('bob recovered the original file bytes', sodium.to_hex(recovered) === sodium.to_hex(fileData));
check('stored blob is ciphertext, not plaintext', sodium.to_hex(cipher) !== sodium.to_hex(fileData));

// 4) Carol (not a member) is denied.
res = await fetch(`${BASE}/attachments/download?blobKey=${encodeURIComponent(blobKey)}`, {
  headers: { authorization: `Bearer ${carol.token}` },
});
check('non-member download denied (403)', res.status === 403);

bobWs.ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
