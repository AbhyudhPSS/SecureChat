// A long-running "user B" bot for browser verification. Registers a user, stays
// online over WebSocket, and auto-replies (with a typing indicator) to any
// inbound message — performing real X3DH + Double Ratchet on its side. Use this
// to chat with from the browser (as user A) and watch live E2EE delivery.
import { WebSocket } from 'ws';
import {
  ready,
  generateDeviceIdentity,
  generateSignedPreKey,
  generateOneTimePreKeys,
  toBase64,
  utf8ToBytes,
  bytesToUtf8,
  x3dhRespond,
  initRatchetResponder,
  ratchetEncrypt,
  ratchetDecrypt,
  pad,
  unpad,
} from '@securechat/crypto';

const BASE = 'http://localhost:4000';
const WS = 'ws://localhost:4000/ws';
const RUN_MS = Number(process.env.BOT_RUN_MS || 240000);

await ready();

const identity = generateDeviceIdentity();
const signedPreKey = generateSignedPreKey(identity, 1);
const oneTimePreKeys = generateOneTimePreKeys(20, 1);
const upload = {
  registrationId: 1000 + Math.floor(Math.random() * 1_000_000),
  deviceName: 'Bot',
  signingPublicKey: toBase64(identity.signing.publicKey),
  identityPublicKey: toBase64(identity.dh.publicKey),
  signedPreKey: {
    keyId: signedPreKey.keyId,
    publicKey: toBase64(signedPreKey.keyPair.publicKey),
    signature: toBase64(signedPreKey.signature),
  },
  oneTimePreKeys: oneTimePreKeys.map((k) => ({ keyId: k.keyId, publicKey: toBase64(k.keyPair.publicKey) })),
};

const username = 'bot_' + Date.now().toString(36);
let res = await fetch(`${BASE}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, displayName: 'Echo Bot', password: 'super-secret-passphrase-123', device: upload }),
});
const reg = await res.json();
const token = reg.accessToken;
const deviceId = reg.deviceId;
console.log('BOT_USERNAME=' + username);
console.log('BOT_USERID=' + reg.user.id);

const sessions = new Map(); // peerDeviceId -> ratchet state

const ws = new WebSocket(`${WS}?token=${encodeURIComponent(token)}`);
ws.on('open', () => console.log('BOT online'));
ws.on('message', async (data) => {
  const ev = JSON.parse(data.toString());
  if (ev.type !== 'message') return;
  const m = ev.message;
  try {
    let state = sessions.get(m.senderDeviceId);
    if (!state) {
      const otk =
        m.envelope.x3dh?.oneTimePreKeyId !== undefined
          ? oneTimePreKeys.find((k) => k.keyId === m.envelope.x3dh.oneTimePreKeyId)
          : undefined;
      const ss = x3dhRespond(identity, signedPreKey, m.envelope.x3dh, otk);
      state = initRatchetResponder(ss, signedPreKey.keyPair);
      sessions.set(m.senderDeviceId, state);
    }
    const raw = bytesToUtf8(unpad(ratchetDecrypt(state, { header: m.envelope.header, body: m.envelope.ciphertext })));
    // Understand the structured message payload (text vs file) like a real client.
    let text = raw;
    try {
      const p = JSON.parse(raw);
      if (p.t === 'text') text = p.body;
      else if (p.t === 'file') text = `[received file: ${p.attachment?.name ?? 'attachment'}]`;
    } catch {
      /* legacy plain text */
    }
    console.log('BOT RECV:', text);

    // read receipt + typing, then echo reply (in the structured text payload format)
    ws.send(JSON.stringify({ type: 'read', conversationId: m.conversationId, messageId: m.id }));
    ws.send(JSON.stringify({ type: 'typing', conversationId: m.conversationId, isTyping: true }));
    setTimeout(async () => {
      ws.send(JSON.stringify({ type: 'typing', conversationId: m.conversationId, isTyping: false }));
      const reply = ratchetEncrypt(state, pad(utf8ToBytes(JSON.stringify({ t: 'text', body: `Echo: ${text}` }))));
      await fetch(`${BASE}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          conversationId: m.conversationId,
          senderDeviceId: deviceId,
          envelopes: [{ recipientDeviceId: m.senderDeviceId, header: reply.header, ciphertext: reply.body }],
        }),
      });
      console.log('BOT SENT reply');
    }, 900);
  } catch (e) {
    console.log('BOT decrypt error:', e.message);
  }
});
ws.on('close', () => console.log('BOT offline'));

setTimeout(() => {
  console.log('BOT shutting down');
  ws.close();
  process.exit(0);
}, RUN_MS);
