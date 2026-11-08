// Runs the REAL worker/worker.js in Node. Only GitHub's gist API is faked (in memory).
import http from 'node:http';
import { createHmac, pbkdf2Sync, randomBytes, webcrypto as crypto } from 'node:crypto';
import worker from '../../worker/worker.js';

const PORT = +(process.env.PORT || 8787);
const PASSWORD = 'correct-horse';
const env = {
  ALLOWED_ORIGINS: process.env.ORIGIN || 'http://localhost:4173', PBKDF2_ITERS: '1000',
  GITHUB_TOKEN: 'fake', SESSION_SECRET: 's'.repeat(32), PEPPER: 'p'.repeat(32),
  DATA_KEY: Buffer.alloc(32, 7).toString('base64'), SYSTEM_GIST_ID: 'sys',
};

let gists, seq, failPuts, latency;
const realFetch = globalThis.fetch;

async function enc(plain) {
  const iv = randomBytes(12);
  const key = await crypto.subtle.importKey('raw', Buffer.from(env.DATA_KEY, 'base64'), 'AES-GCM', false, ['encrypt']);
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return Buffer.concat([iv, Buffer.from(c)]).toString('base64');
}
function putGist(id, files) {
  const g = gists.get(id) || { history: [] };
  g.history.unshift({ version: 'v' + ++seq, files: { ...(g.history[0]?.files || {}), ...files } });
  gists.set(id, g);
  return g;
}
const view = (id, g, h = g.history[0]) => ({
  id, history: g.history.map((x) => ({ version: x.version })),
  files: Object.fromEntries(Object.entries(h.files).map(([n, content]) => [n, { content, truncated: false }])),
});
function user() {
  const salt = randomBytes(16).toString('hex');
  const bits = pbkdf2Sync(PASSWORD, Buffer.from(salt, 'hex'), 1000, 32, 'sha256');
  return { salt, iters: 1000, hash: createHmac('sha256', env.PEPPER).update(bits).digest('hex') };
}
const now = () => Date.now();
const it = (id, name, category, extra = {}) => ({ id, name, category, qty: '', note: '', done: false, addedBy: 'alice', addedAt: now(), updatedAt: now(), ...extra });
async function reset() {
  gists = new Map(); seq = 0; failPuts = 0; latency = 0;
  // Deliberately in the legacy v1 shape (no `pos`), proving existing data carries over.
  const list = { name: 'Weekly shop', items: [
    it('i1', 'Milk', 'Dairy & Eggs', { qty: '2' }), it('i2', 'Cheddar', 'Dairy & Eggs'),
    it('i3', 'Apples', 'Produce', { note: 'pink lady' }), it('i4', 'Bananas', 'Produce'), it('i5', 'Bread', 'Bakery'),
  ], shelf: { oats: { name: 'Oats', category: 'Pantry', lastAt: now(), count: 4 }, milk: { name: 'Milk', category: 'Dairy & Eggs', lastAt: now(), count: 9 } },
    log: [{ id: 'e1', ts: now(), user: 'bob', action: 'added', itemName: 'Bread' }] };
  putGist('g1', { 'list.json.enc': await enc(JSON.stringify(list)) });
  const system = { users: { alice: user(), bob: user() }, lists: [{ id: 'l1', name: 'Weekly shop', gistId: 'g1', members: ['alice', 'bob'] }] };
  putGist('sys', { 'system.json.enc': await enc(JSON.stringify(system)) });
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input.url || input);
  if (!url.startsWith('https://api.github.com/gists')) return realFetch(input, init);
  const [id, sha] = url.slice('https://api.github.com/gists'.length).split('/').filter(Boolean);
  const body = init.body ? JSON.parse(init.body) : null;
  const res = (d, s = 200) => new Response(d === null ? null : JSON.stringify(d), { status: s });
  const files = () => Object.fromEntries(Object.entries(body.files).map(([n, f]) => [n, f.content]));
  if (init.method === 'POST') {
    const nid = 'g' + randomBytes(4).toString('hex');
    return res(view(nid, putGist(nid, files())), 201);
  }
  const g = gists.get(id);
  if (!g) return res({ message: 'Not Found' }, 404);
  if (init.method === 'DELETE') { gists.delete(id); return res(null, 204); }
  if (init.method === 'PATCH') return res(view(id, putGist(id, files())));
  return res(view(id, g, sha ? g.history.find((h) => h.version === sha) : undefined));
};

await reset();
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/__')) {
    if (url.pathname === '/__reset') await reset();
    if (url.pathname === '/__config') { const b = JSON.parse(buf); failPuts = b.failPuts ?? failPuts; latency = b.latency ?? latency; }
    const out = url.pathname === '/__gists' ? { ids: [...gists.keys()] } : { ok: true };
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(out));
  }
  if (latency) await new Promise((r) => setTimeout(r, latency));
  if (req.method === 'PUT' && failPuts > 0) {
    failPuts--;
    res.writeHead(500, { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGINS, 'Content-Type': 'application/json' });
    return res.end('{"error":"injected"}');
  }
  const r = await worker.fetch(new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, body: buf.length ? buf : undefined }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => console.log('mock api on', PORT));
