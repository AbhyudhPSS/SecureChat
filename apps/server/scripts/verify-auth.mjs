// Integration test for the Pass 2 auth flow. Run with the server + infra up.
// Exercises: register → me → login → refresh (rotation) → reuse detection → logout.
import {
  ready,
  generateDeviceIdentity,
  generateSignedPreKey,
  generateOneTimePreKeys,
  buildPublicBundle,
} from '@securechat/crypto';

const BASE = 'http://localhost:4000';
let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function getRefreshCookie(res) {
  const cookies = res.headers.getSetCookie?.() ?? [];
  for (const c of cookies) {
    const m = /sc_refresh=([^;]+)/.exec(c);
    if (m) return m[1];
  }
  return null;
}

await ready();

function makeDevice(registrationId) {
  const id = generateDeviceIdentity();
  const spk = generateSignedPreKey(id, 1);
  const otks = generateOneTimePreKeys(5, 1);
  return {
    registrationId,
    deviceName: 'Verify CLI',
    signingPublicKey: buildPublicBundle(id, spk).signingPublicKey,
    identityPublicKey: buildPublicBundle(id, spk).identityPublicKey,
    signedPreKey: buildPublicBundle(id, spk).signedPreKey,
    oneTimePreKeys: otks.map((k) => ({
      keyId: k.keyId,
      publicKey: buildPublicBundle(id, spk, k).oneTimePreKey.publicKey,
    })),
  };
}

const username = 'auth_' + Date.now().toString(36);
const password = 'correct-horse-battery-staple';

// 1) Register
let res = await fetch(`${BASE}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, displayName: 'Auth Bot', password, device: makeDevice(1) }),
});
let body = await res.json();
check('register → 201', res.status === 201);
check('register returns accessToken', !!body.accessToken);
const accessToken = body.accessToken;
check('register sets refresh cookie', !!getRefreshCookie(res));

// 2) GET /users/me with the access token
res = await fetch(`${BASE}/users/me`, { headers: { authorization: `Bearer ${accessToken}` } });
body = await res.json();
check('me → 200', res.status === 200);
check('me returns same username', body.username === username);

// 2b) /users/me without a token is rejected
res = await fetch(`${BASE}/users/me`);
check('me without token → 401', res.status === 401);

// 3) Login
res = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password, device: makeDevice(1) }),
});
check('login → 200', res.status === 200);
const cookie1 = getRefreshCookie(res);
check('login sets refresh cookie', !!cookie1);

// 3b) Wrong password is rejected
res = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password: 'wrong-password-here', device: makeDevice(1) }),
});
check('login wrong password → 401', res.status === 401);

// 4) Refresh with cookie1 → rotates to cookie2
res = await fetch(`${BASE}/auth/refresh`, {
  method: 'POST',
  headers: { cookie: `sc_refresh=${cookie1}` },
});
check('refresh → 200', res.status === 200);
const cookie2 = getRefreshCookie(res);
check('refresh rotates cookie', !!cookie2 && cookie2 !== cookie1);

// 5) Reuse the OLD cookie1 → must be rejected (theft detection)
res = await fetch(`${BASE}/auth/refresh`, {
  method: 'POST',
  headers: { cookie: `sc_refresh=${cookie1}` },
});
check('reused old refresh → 401', res.status === 401);

// 5b) Because reuse burned the family, cookie2 is now revoked too
res = await fetch(`${BASE}/auth/refresh`, {
  method: 'POST',
  headers: { cookie: `sc_refresh=${cookie2}` },
});
check('family revoked after reuse → 401', res.status === 401);

// 6) Fresh login, then logout
res = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password, device: makeDevice(1) }),
});
const cookie3 = getRefreshCookie(res);
res = await fetch(`${BASE}/auth/logout`, {
  method: 'POST',
  headers: { cookie: `sc_refresh=${cookie3}` },
});
check('logout → 200', res.status === 200);
res = await fetch(`${BASE}/auth/refresh`, {
  method: 'POST',
  headers: { cookie: `sc_refresh=${cookie3}` },
});
check('refresh after logout → 401', res.status === 401);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
