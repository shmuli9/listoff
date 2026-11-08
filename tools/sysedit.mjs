// Test/cleanup helper: edit the system gist registry directly.
// Usage: node tools/sysedit.mjs <remove-member|remove-list> <value> [listId]
import { webcrypto, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TextEncoder } from 'node:util';

const crypto = webcrypto;
const env = Object.fromEntries(readFileSync('/tmp/listoff-secrets.env', 'utf8').trim().split('\n').map((l) => l.split('=')));
const [op, value, listId] = process.argv.slice(2);

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
const H = { Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'listoff-sysedit' };
const gist = await (await fetch('https://api.github.com/gists/' + env.SYSTEM_GIST_ID, { headers: H })).json();
const system = JSON.parse(await decrypt(gist.files['system.json.enc'].content.trim()));

if (op === 'remove-member') {
  const l = system.lists.find((x) => x.id === listId);
  l.members = l.members.filter((m) => m !== value);
} else if (op === 'remove-list') {
  system.lists = system.lists.filter((x) => x.id !== value);
} else { console.error('unknown op'); process.exit(1); }

const content = await encrypt(JSON.stringify(system));
const res = await fetch('https://api.github.com/gists/' + env.SYSTEM_GIST_ID, { method: 'PATCH', headers: H, body: JSON.stringify({ files: { 'system.json.enc': { content } } }) });
console.log(res.ok ? 'done' : 'failed ' + res.status);
