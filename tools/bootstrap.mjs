// Bootstrap for listoff: generates secrets, user accounts, and the encrypted system gist.
// Usage:
//   GITHUB_TOKEN=<classic PAT with gist scope> node tools/bootstrap.mjs <iters> <user1> <user2> ...
// Writes passwords to /tmp/listoff-pw-<user>.txt (never printed) and all Worker secrets
// to /tmp/listoff-secrets.env for `wrangler secret put`.
import { webcrypto, randomBytes, pbkdf2Sync, createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { TextEncoder, TextDecoder } from 'node:util';

const crypto = webcrypto;
const [, , itersArg, ...users] = process.argv;
const iters = parseInt(itersArg || '210000', 10);
if (!users.length) { console.error('need at least one username'); process.exit(1); }
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) { console.error('GITHUB_TOKEN env required'); process.exit(1); }

const hex = (b) => Buffer.from(b).toString('hex');

function passwordHash(password, saltHex, iters, pepper) {
  const bits = pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), iters, 256 / 8, 'sha256');
  return createHmac('sha256', pepper).update(bits).digest('hex');
}

async function encryptText(plain, dataKeyB64) {
  const iv = randomBytes(12);
  const key = await crypto.subtle.importKey('raw', Buffer.from(dataKeyB64, 'base64'), { name: 'AES-GCM' }, false, ['encrypt']);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  const out = Buffer.concat([iv, Buffer.from(cipher)]);
  return out.toString('base64');
}

const SESSION_SECRET = hex(randomBytes(32));
const PEPPER = hex(randomBytes(32));
const DATA_KEY = randomBytes(32).toString('base64');

const system = { users: {}, lists: [] };
for (const u of users) {
  const pw = randomBytes(12).toString('base64url');
  const salt = hex(randomBytes(16));
  system.users[u] = { salt, iters, hash: passwordHash(pw, salt, iters, PEPPER) };
  writeFileSync('/tmp/listoff-pw-' + u + '.txt', pw + '\n', { mode: 0o600 });
}

const content = await encryptText(JSON.stringify(system), DATA_KEY);
const res = await fetch('https://api.github.com/gists', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + GITHUB_TOKEN, Accept: 'application/vnd.github+json',
    'User-Agent': 'listoff-bootstrap', 'Content-Type': 'application/json' },
  body: JSON.stringify({ description: 'listoff system record', public: false,
    files: { 'system.json.enc': { content } } }),
});
if (!res.ok) { console.error('gist create failed', res.status, await res.text()); process.exit(1); }
const gist = await res.json();

writeFileSync('/tmp/listoff-secrets.env',
  'SESSION_SECRET=' + SESSION_SECRET + '\n' +
  'PEPPER=' + PEPPER + '\n' +
  'DATA_KEY=' + DATA_KEY + '\n' +
  'GITHUB_TOKEN=' + GITHUB_TOKEN + '\n' +
  'SYSTEM_GIST_ID=' + gist.id + '\n', { mode: 0o600 });
console.log('system gist created:', gist.id);
console.log('passwords: /tmp/listoff-pw-<user>.txt for', users.join(', '));
console.log('secrets: /tmp/listoff-secrets.env');
