// listoff - shared shopping lists. Plain JS, no build step.
const API = 'https://listoff-api.shmuli9.workers.dev'; // adjusted after deploy if subdomain differs

const state = {
  user: localStorage.getItem('listoff.user') || null,
  token: localStorage.getItem('listoff.token') || null,
  lists: [],
  current: null,      // {id, name, members, version, data}
  pollTimer: null,
};

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
let toastTimer = null;

function toast(msg, undoFn) {
  $toast.innerHTML = '';
  $toast.appendChild(document.createTextNode(msg));
  if (undoFn) {
    const b = document.createElement('button');
    b.textContent = 'Undo';
    b.onclick = () => { hideToast(); undoFn(); };
    $toast.appendChild(b);
  }
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}
function hideToast() { $toast.hidden = true; }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// Password stretching happens client-side (OWASP-baseline PBKDF2-HMAC-SHA256);
// the worker only ever sees the derived proof, never the password.
async function deriveProof(password, saltHex, iters) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: iters, hash: 'SHA-256' }, km, 256);
  return bytesToHex(new Uint8Array(bits));
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && state.token) { logout(); throw new Error('session expired'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'request failed');
  return data;
}

function logout() {
  localStorage.removeItem('listoff.token');
  localStorage.removeItem('listoff.user');
  state.user = null; state.token = null; state.current = null;
  location.hash = '#/login';
}

function saveLocal() {
  localStorage.setItem('listoff.token', state.token);
  localStorage.setItem('listoff.user', state.user);
}

// ---------- categories ----------
const CATEGORY_KEYWORDS = {
  'Produce': ['apple','banana','orange','grape','strawberr','blueberr','raspberr','lemon','lime','avocado','tomato','cucumber','lettuce','spinach','kale','carrot','potato','onion','garlic','pepper','broccoli','cauliflower','mushroom','courgette','zucchini','aubergine','celery','ginger','herb','coriander','parsley','salad','melon','pear','peach','plum','mango','pineapple','kiwi','spring onion','radish','beetroot','cabbage','leek'],
  'Dairy & Eggs': ['milk','cheese','cheddar','mozzarella','yogurt','yoghurt','butter','cream','egg','margarine','feta','parmesan','cottage cheese','sour cream','mascarpone'],
  'Bakery': ['bread','bagel','roll','croissant','challah','wrap','tortilla','pitta','pita','bun','baguette','cake','muffin','doughnut','donut','pastry','cracker'],
  'Meat & Fish': ['chicken','beef','lamb','mince','steak','salmon','tuna','cod','prawn','shrimp','turkey','bacon','sausage','ham','fish','brisket','schnitzel'],
  'Frozen': ['frozen','ice cream','chips','peas','pizza'],
  'Pantry': ['rice','pasta','flour','sugar','salt','oil','olive oil','vinegar','sauce','ketchup','mayonnaise','mustard','honey','jam','peanut butter','cereal','oats','tin','canned','beans','lentils','chickpeas','tahini','soy sauce','spice','cumin','paprika','stock','noodle','couscous','quinoa','baking','chocolate','cocoa','tea','coffee'],
  'Snacks': ['crisps','chips','nuts','almonds','popcorn','biscuit','cookie','sweet','candy','pretzel','granola bar'],
  'Drinks': ['water','juice','cola','coke','lemonade','beer','wine','milk drink','soda','fizzy','squash','kiddush'],
  'Household': ['foil','cling','baking paper','parchment','napkin','paper towel','toilet roll','toilet paper','bin bag','detergent','washing up','dish soap','sponge','bleach','cleaner','wipes','candle','battery','light bulb','laundry','softener','air freshener','zip bag','freezer bag'],
  'Toiletries': ['shampoo','conditioner','soap','toothpaste','toothbrush','deodorant','tissues','sunscreen','moisturiser','razor','shaving','hand wash','body wash','nappy','nappies','diaper'],
};
function categorize(name) {
  const n = ' ' + name.toLowerCase() + ' ';
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const w of words) if (n.includes(w)) return cat;
  }
  return 'Other';
}
const CATEGORY_ORDER = Object.keys(CATEGORY_KEYWORDS).concat(['Other']);

// ---------- rendering shell ----------
function topbar(title, actionsHtml, backHash) {
  return '<div class="topbar">' +
    (backHash ? '<a href="' + backHash + '">&#8592;</a>' : '') +
    '<h1>' + esc(title) + '</h1>' + (actionsHtml || '') + '</div>';
}

function render() {
  clearInterval(state.pollTimer); state.pollTimer = null;
  const hash = location.hash || '#/';
  if (!state.token) { renderLogin(); return; }
  if (hash === '#/' || hash === '') return renderLists();
  let m = hash.match(/^#\/list\/([A-Za-z0-9]+)(\/shelf|\/activity|\/import|\/members)?$/);
  if (m) return renderList(m[1], m[2] || '');
  if (hash === '#/account') return renderAccount();
  renderLists();
}

function renderLogin() {
  $app.innerHTML = '<div class="login-wrap">' +
    '<h1>listoff</h1><p class="sub">Shared shopping lists</p>' +
    '<form id="loginForm">' +
    '<label for="u">Username</label><input id="u" autocomplete="username" required>' +
    '<label for="p">Password</label><input id="p" type="password" autocomplete="current-password" required>' +
    '<button class="primary" type="submit">Sign in</button>' +
    '<div class="error-text" id="loginErr"></div></form></div>';
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('loginErr');
    err.textContent = '';
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const params = await api('/api/login-params', { method: 'POST', body: { u: u.value.trim() } });
      const proof = await deriveProof(p.value, params.salt, params.iters);
      const r = await api('/api/login', { method: 'POST', body: { u: u.value.trim(), proof } });
      state.token = r.token; state.user = r.user; saveLocal();
      location.hash = '#/';
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  };
}

async function renderLists() {
  $app.innerHTML = topbar('listoff', '<a href="#/account">&#9881;</a>') +
    '<div class="content"><div class="loading">Loading&hellip;</div></div>';
  let lists;
  try { lists = (await api('/api/lists')).lists; }
  catch (e) { $app.querySelector('.content').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; return; }
  state.lists = lists;
  let html = topbar('listoff', '<a href="#/account">&#9881;</a>') + '<div class="content">';
  html += '<button class="primary" id="newListBtn" style="margin:4px 0 16px">+ New list</button>';
  html += '<div id="newListForm" hidden style="margin-bottom:16px"><input id="newListName" placeholder="List name" style="margin-bottom:8px"><div id="newListMembers" style="margin-bottom:8px"></div><button class="primary" id="createListBtn">Create list</button></div>';
  if (!lists.length) html += '<div class="empty">No lists yet. Create one to get started.</div>';
  for (const l of lists) {
    html += '<a class="list-card" href="#/list/' + l.id + '"><div><div class="name">' + esc(l.name) + '</div>' +
      '<div class="meta">' + l.members.map(esc).join(', ') + '</div></div><span class="chev">&#8250;</span></a>';
  }
  html += '<div class="footer-note">Signed in as ' + esc(state.user) + '</div></div>';
  $app.innerHTML = html;
  document.getElementById('newListBtn').onclick = async () => {
    const form = document.getElementById('newListForm');
    form.hidden = !form.hidden;
    if (!form.hidden && !form.dataset.loaded) {
      try {
        const r = await api('/api/users');
        document.getElementById('newListMembers').innerHTML = 'Share with: ' + r.users.filter((u) => u !== state.user)
          .map((u) => '<label style="margin-right:12px"><input type="checkbox" class="nlMember" value="' + esc(u) + '"> ' + esc(u) + '</label>').join('');
        form.dataset.loaded = '1';
      } catch (e) { toast(e.message); }
    }
  };
  document.getElementById('createListBtn').onclick = () => {
    const name = document.getElementById('newListName').value.trim();
    if (!name) return;
    const members = [...document.querySelectorAll('.nlMember:checked')].map((c) => c.value);
    api('/api/lists', { method: 'POST', body: { name, members } })
      .then((r) => { location.hash = '#/list/' + r.id; })
      .catch((e) => toast(e.message));
  };
}

function renderAccount() {
  $app.innerHTML = topbar('Account', '', '#/') + '<div class="content">' +
    '<div class="section-title">Signed in as</div><div style="padding:0 4px">' + esc(state.user) + '</div>' +
    '<div class="section-title">Change password</div>' +
    '<form id="pwForm" style="padding:0 4px">' +
    '<label for="cur">Current password</label><input id="cur" type="password" autocomplete="current-password" required>' +
    '<label for="nxt">New password (8+ characters)</label><input id="nxt" type="password" autocomplete="new-password" required minlength="8">' +
    '<button class="primary" type="submit">Change password</button>' +
    '<div class="error-text" id="pwErr"></div><div id="pwOk" class="small" style="color:var(--green);margin-top:8px"></div></form>' +
    '<div class="action-row" style="margin-top:28px"><button class="danger" id="logoutBtn">Sign out</button></div></div>';
  document.getElementById('logoutBtn').onclick = logout;
  document.getElementById('pwForm').onsubmit = async (e) => {
    e.preventDefault();
    pwErr.textContent = ''; pwOk.textContent = '';
    try {
      const params = await api('/api/login-params', { method: 'POST', body: { u: state.user } });
      const oldProof = await deriveProof(cur.value, params.salt, params.iters);
      const newSalt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
      const newProof = await deriveProof(nxt.value, newSalt, 600000);
      await api('/api/change-password', { method: 'POST', body: { oldProof, newSalt, newProof } });
      pwOk.textContent = 'Password changed.'; cur.value = ''; nxt.value = '';
    } catch (ex) { pwErr.textContent = ex.message; }
  };
}

// ---------- list view ----------
async function fetchList(id) {
  const r = await api('/api/list/' + id);
  state.current = r;
  return r;
}

function scheduleSave() {
  if (state.saveInFlight) { state.saveAgain = true; return; }
  state.saveInFlight = true; state.saving = true;
  (async () => {
    try {
      while (true) {
        state.saveAgain = false;
        const c = state.current;
        if (!c) break;
        const r = await api('/api/list/' + c.id, { method: 'PUT', body: { baseVersion: c.version, data: c.data } });
        if (state.current === c) {
          c.version = r.version;
          if (!state.saveAgain) c.data = r.data; // local edits happened mid-save: keep them, loop saves again
        }
        if (!state.saveAgain) break;
      }
    } catch (e) { toast('Save failed: ' + e.message); }
    finally { state.saveInFlight = false; state.saving = false; }
  })();
}

function logAction(action, itemName) {
  state.current.data.log.push({ id: uid('e'), ts: Date.now(), user: state.user, action, itemName });
}

function shelfAdd(name, category) {
  const key = name.toLowerCase();
  const shelf = state.current.data.shelf;
  const prev = shelf[key];
  shelf[key] = { name: prev ? prev.name : name, category: category || (prev && prev.category) || 'Other',
    lastAt: Date.now(), count: (prev ? prev.count : 0) + 1 };
}

function activeItems() { return state.current.data.items.filter((i) => !i.deleted && !i.done); }
function doneItems() { return state.current.data.items.filter((i) => !i.deleted && i.done); }

async function renderList(id, tab) {
  $app.innerHTML = topbar('Loading&hellip;', '', '#/') + '<div class="content"><div class="loading">Loading&hellip;</div></div>';
  try { await fetchList(id); } catch (e) {
    $app.innerHTML = topbar('listoff', '', '#/') + '<div class="content"><div class="empty">' + esc(e.message) + '</div></div>'; return;
  }
  drawList(id, tab);
  // light polling for shared edits
  state.pollTimer = setInterval(async () => {
    if (!state.current || state.current.id !== id || state.saving) return;
    try {
      const r = await api('/api/list/' + id);
      if (state.saving) return;
      if (r.version !== state.current.version) { state.current = r; drawList(id, tab, true); }
    } catch (e) { /* offline - keep showing local state */ }
  }, 15000);
}

function drawList(id, tab, keepFocus) {
  const c = state.current;
  const tabs = '<div class="tabbar">' +
    '<a href="#/list/' + id + '" class="' + (tab === '' ? 'active' : '') + '">List</a>' +
    '<a href="#/list/' + id + '/shelf" class="' + (tab === '/shelf' ? 'active' : '') + '">Previously added</a>' +
    '<a href="#/list/' + id + '/activity" class="' + (tab === '/activity' ? 'active' : '') + '">Activity</a>' +
    '<a href="#/list/' + id + '/import" class="' + (tab === '/import' ? 'active' : '') + '">Import</a>' +
    '<a href="#/list/' + id + '/members" class="' + (tab === '/members' ? 'active' : '') + '">Members</a></div>';
  let html = topbar(c.name, '', '#/') + tabs + '<div class="content">';
  if (tab === '') html += listTabHtml(c);
  else if (tab === '/shelf') html += shelfTabHtml(c);
  else if (tab === '/activity') html += activityTabHtml(c);
  else if (tab === '/import') html += importTabHtml(c);
  else if (tab === '/members') html += '<div id="memberEditor" class="empty">Loading members\u2026</div>';
  html += '</div>';
  $app.innerHTML = html;
  if (tab === '') bindListTab(id);
  else if (tab === '/shelf') bindShelfTab(id);
  else if (tab === '/import') bindImportTab(id);
  else if (tab === '/members') bindMembersTab(id);
}

// ---------- members tab ----------
async function bindMembersTab(id) {
  const box = document.getElementById('memberEditor');
  try {
    const r = await api('/api/users');
    const cur = state.current.members || [];
    box.className = '';
    box.innerHTML = '<p>Who can see and edit this list:</p>' +
      r.users.map((u) => '<label style="display:block;margin-bottom:8px"><input type="checkbox" class="memBox" value="' + esc(u) + '"' + (cur.includes(u) ? ' checked' : '') + '> ' + esc(u) + '</label>').join('') +
      '<button class="primary" id="saveMembers">Save members</button>' +
      '<hr style="margin:18px 0"><button id="deleteList" style="color:#b00">Delete this list</button>';
    document.getElementById('deleteList').onclick = async (e) => {
      const b = e.target;
      if (!b.dataset.arm) { b.dataset.arm = '1'; b.textContent = 'Tap again to confirm delete'; return; }
      try { await api('/api/list/' + id + '/delete', { method: 'POST', body: {} }); location.hash = '#/'; } catch (err) { toast(err.message); }
    };
    document.getElementById('saveMembers').onclick = async () => {
      const members = [...document.querySelectorAll('.memBox:checked')].map((c) => c.value);
      if (!members.length) { toast('A list needs at least one member'); return; }
      try {
        const r2 = await api('/api/list/' + id + '/members', { method: 'POST', body: { members } });
        state.current.members = r2.members;
        toast('Members updated');
      } catch (e) { toast(e.message); }
    };
  } catch (e) { box.textContent = e.message; }
}

function itemHtml(it) {
  const sub = [it.qty, it.note].filter(Boolean).map(esc).join(' &middot; ');
  return '<div class="item' + (it.done ? ' done' : '') + '" data-id="' + it.id + '">' +
    '<span class="grip" aria-label="drag to reorder" title="Drag to reorder">&#8801;</span>' +
    '<button class="tick' + (it.done ? ' on' : '') + '" aria-label="tick">' + (it.done ? '&#10003;' : '') + '</button>' +
    '<div class="body"><div class="name" role="button">' + esc(it.name) + '</div>' +
    (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>' +
    '<button class="del" aria-label="delete">&times;</button></div>';
}

function listTabHtml(c) {
  let html = '<div class="addbar"><div class="row"><input name="item" placeholder="Add an item&hellip;" autocomplete="off">' +
    '<button class="primary" id="addBtn" style="width:auto;margin:0;padding:12px 18px">Add</button></div>' +
    '<div class="extras"><input name="qty" placeholder="Qty (e.g. 2)"><input name="note" placeholder="Note (optional)"></div>' +
    '<div class="suggestions" id="sugg" hidden></div></div>';
  const act = activeItems();
  const done = doneItems();
  if (!act.length && !done.length) html += '<div class="empty">Empty list. Add your first item above, or check Previously added.</div>';
  const groups = {};
  for (const it of act) { const cat = it.category || 'Other'; (groups[cat] = groups[cat] || []).push(it); }
  for (const cat of CATEGORY_ORDER) {
    if (!groups[cat]) continue;
    html += '<div class="category"><h3>' + esc(cat) + '</h3>' + groups[cat].map(itemHtml).join('') + '</div>';
    delete groups[cat];
  }
  for (const cat of Object.keys(groups).sort()) {
    html += '<div class="category"><h3>' + esc(cat) + '</h3>' + groups[cat].map(itemHtml).join('') + '</div>';
  }
  if (done.length) {
    html += '<div class="category"><h3>Done (' + done.length + ')</h3>' + done.map(itemHtml).join('') + '</div>';
    html += '<div class="action-row"><button id="clearDone">Clear done items</button></div>';
  }
  return html;
}

function bindListTab(id) {
  const input = $app.querySelector('input[name=item]');
  const qty = $app.querySelector('input[name=qty]');
  const note = $app.querySelector('input[name=note]');
  const sugg = document.getElementById('sugg');

  async function addItem(name) {
    name = (name || input.value).trim();
    if (!name) return;
    const cat = categorize(name);
    state.current.data.items.push({ id: uid('i'), name, qty: qty.value.trim(), note: note.value.trim(),
      category: cat, done: false, addedBy: state.user, addedAt: Date.now(), updatedAt: Date.now() });
    shelfAdd(name, cat);
    logAction('added', name);
    input.value = ''; qty.value = ''; note.value = ''; sugg.hidden = true;
    drawList(id, ''); $app.querySelector('input[name=item]').focus();
    scheduleSave();
  }

  document.getElementById('addBtn').onclick = () => addItem();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { sugg.hidden = true; return; }
    const onList = new Set(activeItems().map((i) => i.name.toLowerCase()));
    const matches = Object.values(state.current.data.shelf)
      .filter((s) => s.name.toLowerCase().includes(q) && !onList.has(s.name.toLowerCase()))
      .sort((a, b) => (b.count - a.count) || (b.lastAt - a.lastAt)).slice(0, 6);
    if (!matches.length) { sugg.hidden = true; return; }
    sugg.innerHTML = matches.map((s) =>
      '<button data-name="' + esc(s.name) + '">' + esc(s.name) + '<span class="cat">' + esc(s.category) + '</span></button>').join('');
    sugg.hidden = false;
    sugg.querySelectorAll('button').forEach((b) => { b.onmousedown = (e) => { e.preventDefault(); addItem(b.dataset.name); }; });
  });
  input.addEventListener('blur', () => setTimeout(() => { sugg.hidden = true; }, 150));

  $app.querySelectorAll('.item').forEach((row) => {
    const itemId = row.dataset.id;
    const it = state.current.data.items.find((i) => i.id === itemId);
    if (!it) return;
    row.querySelector('.tick').onclick = async () => {
      const wasDone = it.done;
      it.done = !it.done; it.updatedAt = Date.now();
      logAction(it.done ? 'ticked' : 'unticked', it.name);
      drawList(id, '');
      if (it.done) toast('Ticked ' + it.name, async () => {
        const cur = state.current && state.current.data.items.find((x) => x.id === itemId);
        if (!cur) return;
        cur.done = false; cur.updatedAt = Date.now(); logAction('unticked', cur.name);
        drawList(id, ''); scheduleSave();
      });
      scheduleSave();
    };
    row.querySelector('.del').onclick = async () => {
      it.deleted = true; it.updatedAt = Date.now(); logAction('removed', it.name);
      drawList(id, '');
      scheduleSave();
    };
    row.querySelector('.name').onclick = () => {
      const cats = [...new Set(state.current.data.items.filter((x) => !x.deleted && x.category).map((x) => x.category))];
      row.classList.add('editing');
      row.innerHTML = '<div class="editform">' +
        '<input class="eName" value="' + esc(it.name) + '" placeholder="Item">' +
        '<div class="extras"><input class="eQty" placeholder="Qty" value="' + esc(it.qty || '') + '"><input class="eNote" placeholder="Note" value="' + esc(it.note || '') + '"></div>' +
        '<input class="eCat" placeholder="Category (e.g. Produce)" list="catList" value="' + esc(it.category || '') + '">' +
        '<datalist id="catList">' + cats.map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
        '<div class="row" style="gap:8px"><button class="primary eSave" style="margin:0">Save</button><button class="eCancel">Cancel</button></div></div>';
      row.querySelector('.eSave').onclick = () => {
        const name = row.querySelector('.eName').value.trim();
        if (!name) return;
        it.name = name;
        it.qty = row.querySelector('.eQty').value.trim();
        it.note = row.querySelector('.eNote').value.trim();
        it.category = row.querySelector('.eCat').value.trim();
        it.updatedAt = Date.now();
        logAction('edited', it.name);
        drawList(id, '');
        scheduleSave();
      };
      row.querySelector('.eCancel').onclick = () => drawList(id, '');
    };
    const grip = row.querySelector('.grip');
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { grip.setPointerCapture(e.pointerId); } catch {}
      const rows = [...$app.querySelectorAll('.item')];
      let target = null, before = true;
      const move = (ev) => {
        target = null;
        for (const r of rows) {
          if (r === row || r.classList.contains('editing')) continue;
          const rect = r.getBoundingClientRect();
          if (ev.clientY >= rect.top && ev.clientY <= rect.bottom) { target = r; before = ev.clientY < rect.top + rect.height / 2; break; }
        }
        rows.forEach((r) => r.classList.remove('drop-before', 'drop-after'));
        if (target) target.classList.add(before ? 'drop-before' : 'drop-after');
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        rows.forEach((r) => r.classList.remove('drop-before', 'drop-after'));
        if (!target) return;
        const items = state.current.data.items;
        const tgt = items.find((x) => x.id === target.dataset.id);
        if (!tgt || tgt === it) return;
        items.splice(items.indexOf(it), 1);
        let toIdx = items.indexOf(tgt);
        if (!before) toIdx++;
        if ((tgt.category || '') !== (it.category || '')) it.category = tgt.category || '';
        items.splice(toIdx, 0, it);
        it.updatedAt = Date.now();
        logAction('reordered', it.name);
        drawList(id, '');
        scheduleSave();
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
  });

  const clearBtn = document.getElementById('clearDone');
  if (clearBtn) clearBtn.onclick = async () => {
    for (const it of doneItems()) { it.deleted = true; it.updatedAt = Date.now(); }
    logAction('cleared done items', '');
    drawList(id, '');
    scheduleSave();
  };
}

// ---------- shelf (previously added) ----------
function shelfTabHtml(c) {
  let html = '<input id="shelfSearch" placeholder="Search previously added&hellip;" style="margin-bottom:10px">';
  html += '<div id="shelfList"></div>';
  return html;
}

function drawShelfItems(filter) {
  const c = state.current;
  const onList = new Set(activeItems().map((i) => i.name.toLowerCase()));
  let entries = Object.values(c.data.shelf);
  if (filter) entries = entries.filter((s) => s.name.toLowerCase().includes(filter));
  entries.sort((a, b) => (b.lastAt - a.lastAt));
  const el = document.getElementById('shelfList');
  if (!entries.length) { el.innerHTML = '<div class="empty">Nothing here yet. Items you add appear here for quick re-adding.</div>'; return; }
  el.innerHTML = entries.map((s) => {
    const isOn = onList.has(s.name.toLowerCase());
    return '<div class="shelf-item"><div class="body"><div class="name">' + esc(s.name) + '</div>' +
      '<div class="meta">' + esc(s.category) + (s.count > 1 ? ' &middot; added ' + s.count + ' times' : '') + '</div></div>' +
      '<button data-name="' + esc(s.name) + '"' + (isOn ? ' class="onlist" disabled' : '') + '>' + (isOn ? 'On list' : 'Add') + '</button></div>';
  }).join('');
  el.querySelectorAll('button[data-name]').forEach((b) => {
    b.onclick = async () => {
      const name = b.dataset.name;
      const cat = categorize(name);
      c.data.items.push({ id: uid('i'), name, qty: '', note: '', category: cat, done: false,
        addedBy: state.user, addedAt: Date.now(), updatedAt: Date.now() });
      shelfAdd(name, cat); logAction('added', name);
      drawList(c.id, '/shelf');
      scheduleSave();
      toast('Added ' + name);
    };
  });
}

function bindShelfTab(id) {
  drawShelfItems('');
  document.getElementById('shelfSearch').addEventListener('input', (e) => drawShelfItems(e.target.value.trim().toLowerCase()));
}

// ---------- activity ----------
function activityTabHtml(c) {
  const log = [...(c.data.log || [])].reverse();
  if (!log.length) return '<div class="empty">No activity yet.</div>';
  return log.map((e) => {
    const d = new Date(e.ts);
    const when = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return '<div class="log-entry"><span class="who">' + esc(e.user) + '</span> ' + esc(e.action) +
      (e.itemName ? ' <b>' + esc(e.itemName) + '</b>' : '') + '<span class="when">' + when + '</span></div>';
  }).join('');
}

// ---------- import (AnyList "Send a Copy" plain text, or any text list) ----------
function importTabHtml() {
  return '<p class="small muted">Paste a list as plain text - in AnyList use the list menu &gt; Share, Email &amp; Print &gt; Send a Copy, copy the text, and paste it here. One item per line. A line ending in ":" is treated as a category heading.</p>' +
    '<textarea id="importText" rows="10" placeholder="Milk&#10;Bread&#10;Eggs"></textarea>' +
    '<div id="importPreview"></div>' +
    '<div class="action-row"><button id="previewBtn">Preview</button><button id="importBtn" disabled>Import items</button></div>' +
    '<div id="importMsg" class="small" style="margin-top:10px;color:var(--green)"></div>';
}

let parsedImport = [];
function bindImportTab(id) {
  const ta = document.getElementById('importText');
  const prev = document.getElementById('importPreview');
  const importBtn = document.getElementById('importBtn');
  document.getElementById('previewBtn').onclick = () => {
    parsedImport = [];
    let currentCat = null;
    for (let line of ta.value.split('\n')) {
      line = line.replace(/^[\s\-\*\u2022\u25E6\u2610\u2611\u2713\u2714\u00D7x]+/, '').trim();
      if (!line) continue;
      if (line.endsWith(':')) { currentCat = line.slice(0, -1).trim(); continue; }
      parsedImport.push({ name: line, category: currentCat || categorize(line) });
    }
    if (!parsedImport.length) { prev.innerHTML = '<p class="small muted">No items found.</p>'; importBtn.disabled = true; return; }
    prev.innerHTML = '<div class="section-title">' + parsedImport.length + ' items found</div>' +
      parsedImport.slice(0, 50).map((p) => '<div class="log-entry">' + esc(p.name) +
        '<span class="when">' + esc(p.category) + '</span></div>').join('') +
      (parsedImport.length > 50 ? '<p class="small muted">&hellip;and ' + (parsedImport.length - 50) + ' more</p>' : '');
    importBtn.disabled = false;
  };
  importBtn.onclick = async () => {
    const c = state.current;
    const onList = new Set(activeItems().map((i) => i.name.toLowerCase()));
    let added = 0;
    for (const p of parsedImport) {
      shelfAdd(p.name, p.category);
      if (onList.has(p.name.toLowerCase())) continue;
      c.data.items.push({ id: uid('i'), name: p.name, qty: '', note: '', category: p.category, done: false,
        addedBy: state.user, addedAt: Date.now(), updatedAt: Date.now() });
      added++;
    }
    logAction('imported ' + added + ' items', '');
    scheduleSave();
    document.getElementById('importMsg').textContent = added + ' items imported (' + (parsedImport.length - added) + ' already on the list).';
    importBtn.disabled = true;
  };
}

// ---------- boot ----------
window.addEventListener('hashchange', render);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    setInterval(() => reg.update(), 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update(); });
  }).catch(() => {});
  // Reload once when an updated service worker takes control, so bug/security fixes
  // reach open tabs without any manual cache clearing.
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    location.reload();
  });
}
render();
