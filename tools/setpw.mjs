// Test-only: set a user's password hash directly in the system gist.
// Usage: node tools/setpw.mjs <user> <iters>   (reads secrets from /tmp/listoff-secrets.env)
// Writes the new password to /tmp/listoff-test-pw.txt (mode 600), prints nothing sensitive.
import { webcrypto, randomBytes, pbkdf2Sync, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { TextEncoder } from 'node:util';

const crypto = webcrypto;
const env = Object.fromEntries(readFileSync('/tmp/listoff-secrets.env', 'utf8').trim().split('\n').map((l) => l.split('=')));
const [user, itersArg] = process.argv.slice(2);
const iters = parseInt(itersArg || '100000', 10);

function passwordHash(password, saltHex, iters, pepper) {
  const bits = pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), iters, 32, 'sha256');
  return createHmac('sha256', pepper).update(bits).digest('hex');
}
async function decrypt(b64) {
  const raw = Buffer.from(b64, 'base64');
  const key = await crypto.subtle.importKey('raw', Buffer.from(env.DATA_KEY, 'base64'), { name: 'AES-GCM' }, false, ['decrypt']);
  return Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12))).toString();
}
async function encrypt(plain) {
  const iv = randomBytes(12);
  const key = await crypto.subtle.importKey('raw', Buffer.from(env.DATA_KEY, 'base64'), { name: 'AES-GCM' }, false, ['encrypt']);
  const cipher = Buffer.from(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  return Buffer.concat([iv, cipher]).toString('base64');
}
const H = { Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'listoff-setpw' };
const gist = await (await fetch('https://api.github.com/gists/' + env.SYSTEM_GIST_ID, { headers: H })).json();
const system = JSON.parse(await decrypt(gist.files['system.json.enc'].content.trim()));
const pw = randomBytes(12).toString('base64url');
const salt = randomBytes(16).toString('hex');
system.users[user] = { salt, iters, hash: passwordHash(pw, salt, iters, env.PEPPER) };
const content = await encrypt(JSON.stringify(system));
const res = await fetch('https://api.github.com/gists/' + env.SYSTEM_GIST_ID, { method: 'PATCH', headers: H, body: JSON.stringify({ files: { 'system.json.enc': { content } } }) });
if (!res.ok) { console.error('update failed', res.status); process.exit(1); }
writeFileSync('/tmp/listoff-test-pw.txt', pw + '\n', { mode: 0o600 });
console.log('password set for', user);
