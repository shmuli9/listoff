// listoff-api - Cloudflare Worker backend for listoff
// Responsibilities: auth (PBKDF2 + pepper), per-list authorisation, gist storage, AES-GCM encryption at rest.
// No dependencies.

const GISTS_API = 'https://api.github.com/gists';

// ---------- helpers ----------

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function b64urlFromBytes(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexFromBytes(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesFromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function bytesFromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64FromBytes(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// ---------- crypto ----------

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signToken(payload, secret) {
  const body = b64urlFromBytes(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return body + '.' + b64urlFromBytes(new Uint8Array(sig));
}

async function verifyToken(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify('HMAC', key, bytesFromB64url(sig), new TextEncoder().encode(body));
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytesFromB64url(body)));
  } catch {
    return null;
  }
  if (!payload.u || !payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

async function proofHash(proofHex, pepper) {
  // The client sends proof = hex(PBKDF2-HMAC-SHA256(password, salt, iters)).
  // Stored value = HMAC-SHA256(pepper, proof): the gist contents alone cannot be brute-forced,
  // and the worker never sees or handles the actual password.
  const key = await hmacKey(pepper);
  const sig = await crypto.subtle.sign('HMAC', key, bytesFromHex(proofHex));
  return hexFromBytes(new Uint8Array(sig));
}

async function dataKey(env) {
  return crypto.subtle.importKey('raw', bytesFromB64(env.DATA_KEY), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptText(plain, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await dataKey(env);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  const out = new Uint8Array(12 + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), 12);
  return b64FromBytes(out);
}

async function decryptText(b64, env) {
  const raw = bytesFromB64(b64);
  const iv = raw.slice(0, 12);
  const key = await dataKey(env);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, raw.slice(12));
  return new TextDecoder().decode(plain);
}

// ---------- gist storage ----------

async function gistRequest(env, method, path, body) {
  const res = await fetch(GISTS_API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'listoff-worker',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('gist ' + method + ' ' + path + ' -> ' + res.status + ': ' + text.slice(0, 200));
  }
  return res.json();
}

const SYSTEM_FILE = 'system.json.enc';
const LIST_FILE = 'list.json.enc';

async function readEncryptedGist(env, gistId, fileName) {
  const gist = await gistRequest(env, 'GET', '/' + gistId);
  const file = gist.files && gist.files[fileName];
  if (!file) throw new Error('missing file in gist');
  const content = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
  const version = gist.history && gist.history[0] ? gist.history[0].version : null;
  return { version, plain: await decryptText(content.trim(), env) };
}

async function writeEncryptedGist(env, gistId, fileName, plain) {
  const content = await encryptText(plain, env);
  const gist = await gistRequest(env, 'PATCH', '/' + gistId, { files: { [fileName]: { content } } });
  return gist.history && gist.history[0] ? gist.history[0].version : null;
}

async function createEncryptedGist(env, fileName, plain, description) {
  const content = await encryptText(plain, env);
  const gist = await gistRequest(env, 'POST', '', {
    description,
    public: false,
    files: { [fileName]: { content } },
  });
  return gist.id;
}

// ---------- system record (users + list registry) ----------

async function readSystem(env) {
  const { version, plain } = await readEncryptedGist(env, env.SYSTEM_GIST_ID, SYSTEM_FILE);
  return { version, system: JSON.parse(plain) };
}

// ---------- auth ----------

async function authenticatedUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = await verifyToken(token, env.SESSION_SECRET);
  if (!payload) return null;
  // Token version check: changing a password bumps the user's tv, revoking all older tokens.
  const { system } = await readSystem(env);
  const rec = system.users[payload.u];
  if (!rec || (rec.tv || 0) !== (payload.tv || 0)) return null;
  return payload.u;
}

// ---------- list merge (item-level, last-writer-wins per item) ----------

function mergeLists(current, incoming) {
  const items = new Map();
  for (const it of current.items || []) items.set(it.id, it);
  for (const it of incoming.items || []) {
    const prev = items.get(it.id);
    if (!prev || (it.updatedAt || 0) >= (prev.updatedAt || 0)) items.set(it.id, it);
  }
  const shelf = { ...(current.shelf || {}) };
  for (const [k, v] of Object.entries(incoming.shelf || {})) {
    const prev = shelf[k];
    if (!prev) shelf[k] = v;
    else shelf[k] = {
      name: (v.lastAt || 0) >= (prev.lastAt || 0) ? v.name : prev.name,
      category: (v.lastAt || 0) >= (prev.lastAt || 0) ? v.category : prev.category,
      lastAt: Math.max(v.lastAt || 0, prev.lastAt || 0),
      count: Math.max(v.count || 0, prev.count || 0),
    };
  }
  const logMap = new Map();
  for (const e of [...(current.log || []), ...(incoming.log || [])]) logMap.set(e.id, e);
  const log = [...logMap.values()].sort((a, b) => a.ts - b.ts).slice(-500);
  // purge tombstones older than 7 days
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  const mergedItems = [...items.values()].filter((it) => !(it.deleted && (it.updatedAt || 0) < cutoff));
  return { name: incoming.name || current.name, items: mergedItems, shelf, log };
}

// ---------- routes ----------

async function route(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/health') return json({ ok: true, service: 'listoff-api' });

  if (path === '/api/login-params' && method === 'POST') {
    const body = await request.json().catch(() => null);
    const u = body && body.u ? String(body.u) : '';
    const { system } = await readSystem(env);
    const rec = system.users[u];
    if (rec) return json({ salt: rec.salt, iters: rec.iters });
    // Unknown user: return a deterministic fake salt so the endpoint doesn't reveal which usernames exist.
    const key = await hmacKey(env.PEPPER);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('salt:' + u));
    return json({ salt: hexFromBytes(new Uint8Array(sig)).slice(0, 32), iters: parseInt(env.PBKDF2_ITERS || '600000', 10) });
  }

  if (path === '/api/login' && method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body || !body.u || !body.proof) return json({ error: 'username and proof required' }, 400);
    const { system } = await readSystem(env);
    const u = String(body.u);
    const now = Date.now();
    system.loginFails = system.loginFails || {};
    const f = system.loginFails[u];
    if (f && f.lockedUntil && f.lockedUntil > now) return json({ error: 'too many attempts, try again in a few minutes' }, 429);
    const rec = system.users[u];
    const ok = rec && (await proofHash(String(body.proof), env.PEPPER)) === rec.hash;
    if (!ok) {
      const n = ((f && f.n) || 0) + 1;
      system.loginFails[u] = { n, lockedUntil: n >= 5 ? now + 5 * 60 * 1000 : 0 };
      await writeEncryptedGist(env, env.SYSTEM_GIST_ID, SYSTEM_FILE, JSON.stringify(system));
      return json({ error: 'invalid credentials' }, 401);
    }
    if (f && f.n) { delete system.loginFails[u]; await writeEncryptedGist(env, env.SYSTEM_GIST_ID, SYSTEM_FILE, JSON.stringify(system)); }
    const token = await signToken({ u, tv: rec.tv || 0, exp: now + 30 * 24 * 3600 * 1000 }, env.SESSION_SECRET);
    return json({ token, user: u });
  }

  if (path === '/api/users' && method === 'GET') {
    const user = await authenticatedUser(request, env);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const { system } = await readSystem(env);
    return json({ users: Object.keys(system.users).sort() });
  }

  // Everything below requires auth.
  const user = await authenticatedUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  if (path === '/api/change-password' && method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body || !body.oldProof || !body.newSalt || !body.newProof) return json({ error: 'oldProof, newSalt and newProof required' }, 400);
    const { system } = await readSystem(env);
    const rec = system.users[user];
    if (!rec) return json({ error: 'unknown user' }, 400);
    const oldHash = await proofHash(String(body.oldProof), env.PEPPER);
    if (oldHash !== rec.hash) return json({ error: 'current password incorrect' }, 403);
    const iters = parseInt(env.PBKDF2_ITERS || '600000', 10);
    system.users[user] = { salt: String(body.newSalt), iters, hash: await proofHash(String(body.newProof), env.PEPPER), tv: (rec.tv || 0) + 1 };
    await writeEncryptedGist(env, env.SYSTEM_GIST_ID, SYSTEM_FILE, JSON.stringify(system));
    return json({ ok: true });
  }

  if (path === '/api/lists' && method === 'GET') {
    const { system } = await readSystem(env);
    const lists = system.lists
      .filter((l) => l.members.includes(user))
      .map((l) => ({ id: l.id, name: l.name, members: l.members }));
    return json({ lists });
  }

  if (path === '/api/lists' && method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body || !body.name || !Array.isArray(body.members)) return json({ error: 'name and members[] required' }, 400);
    const name = String(body.name).slice(0, 80);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { system } = await readSystem(env);
      const members = [...new Set(body.members.filter((m) => system.users[m]))];
      if (!members.includes(user)) members.push(user);
      const id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const empty = { name, items: [], shelf: {}, log: [{ id: 'e' + Date.now(), ts: Date.now(), user, action: 'create', itemName: name }] };
      const gistId = await createEncryptedGist(env, LIST_FILE, JSON.stringify(empty), 'listoff list: ' + id);
      system.lists.push({ id, name, gistId, members });
      await writeEncryptedGist(env, env.SYSTEM_GIST_ID, SYSTEM_FILE, JSON.stringify(system));
      return json({ id, name, members });
    }
    return json({ error: 'busy, try again' }, 409);
  }

  const listMatch = path.match(/^\/api\/list\/([A-Za-z0-9]+)(\/members|\/rename|\/delete)?$/);
  if (listMatch) {
    const listId = listMatch[1];
    const sub = listMatch[2] || '';
    const { system } = await readSystem(env);
    const entry = system.lists.find((l) => l.id === listId);
    if (!entry) return json({ error: 'not found' }, 404);
    if (!entry.members.includes(user)) return json({ error: 'forbidden' }, 403);

    if (sub === '' && method === 'GET') {
      const { version, plain } = await readEncryptedGist(env, entry.gistId, LIST_FILE);
      return json({ id: entry.id, name: entry.name, members: entry.members, version, data: JSON.parse(plain) });
    }

    if (sub === '' && method === 'PUT') {
      const body = await request.json().catch(() => null);
      if (!body || !body.data) return json({ error: 'data required' }, 400);
      let data = body.data;
      let lastErr = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const read = await readEncryptedGist(env, entry.gistId, LIST_FILE);
          const current = JSON.parse(read.plain);
          if (body.baseVersion !== read.version) data = mergeLists(current, data);
          const newVersion = await writeEncryptedGist(env, entry.gistId, LIST_FILE, JSON.stringify(data));
          // Gist has no conditional write, so verify no commit landed between our read and write:
          // after our commit, history must be [ours, theVersionWeRead, ...].
          const gist = await gistRequest(env, 'GET', '/' + entry.gistId);
          const hist = gist.history || [];
          const headVersion = hist[0] ? hist[0].version : null;
          const prevVersion = hist[1] ? hist[1].version : null;
          if (headVersion === newVersion && prevVersion === read.version) {
            return json({ version: newVersion, data });
          }
          // A writer intervened or followed: merge the newest state with ours and retry.
          const file = gist.files && gist.files[LIST_FILE];
          const content = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
          data = mergeLists(JSON.parse(await decryptText(content.trim(), env)), data);
          body.baseVersion = headVersion;
        } catch (e) {
          lastErr = e;
        }
      }
      if (lastErr) return json({ error: 'write failed: ' + String(lastErr.message || lastErr).slice(0, 120) }, 500);
      return json({ error: 'busy, try again' }, 409);
    }

    if (sub === '/rename' && method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || !body.name) return json({ error: 'name required' }, 400);
      entry.name = String(body.name).slice(0, 80);
      await writeEncryptedGist(env, env.SYSTEM_GIST_ID, SYSTEM_FILE, JSON.stringify(system));
      return json({ ok: true, name: entry.name });
    }

    if (sub === '/delete' && method === 'POST') {
      system.lists = system.lists.filter((l) => l.id !== listId);
      await writeEncryptedGist(env, env.SYSTEM_GIST_ID, SYSTEM_FILE, JSON.stringify(system));
      return json({ ok: true });
    }

    if (sub === '/members' && method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || !Array.isArray(body.members)) return json({ error: 'members[] required' }, 400);
      const members = [...new Set(body.members.filter((m) => system.users[m]))];
      if (members.length === 0) return json({ error: 'a list needs at least one member' }, 400);
      entry.members = members;
      await writeEncryptedGist(env, env.SYSTEM_GIST_ID, SYSTEM_FILE, JSON.stringify(system));
      return json({ ok: true, members });
    }
  }

  return json({ error: 'not found' }, 404);
}

// ---------- CORS ----------

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Debug-Key',
    'Access-Control-Max-Age': '86400',
  };
}

function withCors(res, origin) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const corsOrigin = allowed.includes(origin) ? origin : allowed[0] || '*';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(corsOrigin) });
    try {
      const res = await route(request, env, new URL(request.url));
      return withCors(res, corsOrigin);
    } catch (e) {
      return withCors(json({ error: 'internal error' }, 500), corsOrigin);
    }
  },
};
