import { api, ApiError, deriveProof, newSalt, setExpiredHandler, setToken } from './api';
import { categorize } from './categories';
import { mergeLists } from '../../worker/merge.js';
import { toast } from './ui.svelte';
import type { Doc, Item, ListData, ListMeta } from './types';

const K = { user: 'listoff.user', token: 'listoff.token', owner: 'listoff.owner', lists: 'listoff.lists', users: 'listoff.users', doc: 'listoff.doc.' };
const POLL_MS = 15_000;
const SAVE_DEBOUNCE_MS = 250; // coalesces a burst of ticks into one gist commit

const uid = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const plain = <T>(v: T): T => $state.snapshot(v) as T;
function read<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

function normalize(data: ListData): ListData {
  data.items ||= []; data.shelf ||= {}; data.log ||= [];
  data.items.forEach((it, i) => { if (it.pos === undefined) it.pos = i; }); // v1 lists relied on array order
  return data;
}

class Store {
  user = $state<string | null>(localStorage.getItem(K.user));
  token = $state<string | null>(localStorage.getItem(K.token));
  lists = $state<ListMeta[]>(read(K.lists, []));
  users = $state<string[]>(read(K.users, []));
  docs = $state<Record<string, Doc>>({});
  online = $state(navigator.onLine);
  saveFails = $state(0);
  listsLoaded = $state(false);
  expired = $state(false);
  dragging = false;

  private flushing = false;
  private saveSeq = 0;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private lastPoll = 0;

  constructor() {
    setToken(this.token);
    setExpiredHandler(() => this.expire());
    if (this.user) this.loadDocs();
    addEventListener('online', () => { this.online = true; this.flushNow(); });
    addEventListener('offline', () => { this.online = false; });
    // iOS doesn't reliably fire beforeunload, so edits persist on each mutation; this only resumes syncing.
    const wake = () => { if (!document.hidden) this.flushNow(); };
    document.addEventListener('visibilitychange', wake);
    addEventListener('pageshow', wake);
    addEventListener('storage', (e) => this.onStorage(e));
    if (this.token) this.flushNow();
  }

  get dirtyCount() { return Object.values(this.docs).filter((d) => d.dirty).length; }
  get status(): 'saved' | 'saving' | 'offline' | 'retrying' {
    if (!this.dirtyCount) return 'saved';
    if (!this.online) return 'offline';
    return this.saveFails ? 'retrying' : 'saving';
  }

  private loadDocs() {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!k.startsWith(K.doc)) continue;
      const d = read<Doc | null>(k, null);
      if (d) this.docs[d.id] = { ...d, rev: 0, data: normalize(d.data) };
    }
  }
  private persist(doc: Doc) {
    try { localStorage.setItem(K.doc + doc.id, JSON.stringify(doc)); } catch { /* quota: the server remains the source of truth */ }
  }
  private onStorage(e: StorageEvent) {
    if (!e.key?.startsWith(K.doc) || !e.newValue) return;
    const d = JSON.parse(e.newValue) as Doc;
    const mine = this.docs[d.id];
    if (!mine) { this.docs[d.id] = { ...d, rev: 0 }; return; }
    mine.data = normalize(mergeLists(plain(mine.data), d.data));
    mine.version = d.version;
  }
  private wipeLocal() {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)!.startsWith(K.doc)) keys.push(localStorage.key(i)!);
    keys.forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem(K.lists); localStorage.removeItem(K.users);
    this.docs = {}; this.lists = []; this.users = [];
  }
  private saveLists() { localStorage.setItem(K.lists, JSON.stringify(this.lists)); }

  // ---- session ----
  async login(u: string, password: string) {
    const params = await api('/api/login-params', { method: 'POST', body: { u } });
    const proof = await deriveProof(password, params.salt, params.iters);
    const r = await api('/api/login', { method: 'POST', body: { u, proof } });
    if (localStorage.getItem(K.owner) !== r.user) this.wipeLocal(); // an expired session keeps its unsynced edits
    localStorage.setItem(K.owner, r.user); localStorage.setItem(K.user, r.user); localStorage.setItem(K.token, r.token);
    this.user = r.user; this.token = r.token; this.expired = false;
    setToken(r.token);
    this.loadDocs();
    this.flushNow();
  }
  private expire() {
    localStorage.removeItem(K.token);
    this.token = null; this.expired = true;
    setToken(null);
  }
  logout() {
    this.expire(); this.expired = false;
    this.wipeLocal();
    localStorage.removeItem(K.user); localStorage.removeItem(K.owner);
    this.user = null;
    location.hash = '#/';
  }
  async changePassword(current: string, next: string) {
    const params = await api('/api/login-params', { method: 'POST', body: { u: this.user } });
    const oldProof = await deriveProof(current, params.salt, params.iters);
    const salt = newSalt();
    const newProof = await deriveProof(next, salt, 600000);
    await api('/api/change-password', { method: 'POST', body: { oldProof, newSalt: salt, newProof } });
    this.expire();
    toast('Password changed. Sign in again.');
  }

  // ---- loading (stale-while-revalidate: views render cached state first) ----
  async refreshLists() {
    const { lists } = await api<{ lists: ListMeta[] }>('/api/lists');
    this.lists = lists; this.listsLoaded = true;
    this.saveLists();
    const live = new Set(lists.map((l) => l.id));
    for (const id of Object.keys(this.docs)) if (!live.has(id) && !this.docs[id].dirty) this.forget(id);
    // Warm every list so any of them opens instantly, and works offline, later.
    for (const l of lists) await this.refreshDoc(l.id).catch(() => {});
  }
  async refreshUsers() {
    const { users } = await api<{ users: string[] }>('/api/users');
    this.users = users;
    localStorage.setItem(K.users, JSON.stringify(users));
  }
  private forget(id: string) { delete this.docs[id]; localStorage.removeItem(K.doc + id); }

  async refreshDoc(id: string) {
    const seq = this.saveSeq;
    let r: Doc;
    try { r = await api<Doc>('/api/list/' + id); }
    catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        this.forget(id); this.lists = this.lists.filter((l) => l.id !== id);
      }
      throw e;
    }
    // A save that landed while this GET was in flight makes the response stale.
    if (seq !== this.saveSeq || this.flushing || this.dragging) return;
    const doc = this.docs[id];
    if (!doc) { this.docs[id] = { ...r, data: normalize(r.data), dirty: false, rev: 0 }; this.persist(this.docs[id]); return; }
    doc.name = r.name; doc.members = r.members;
    if (r.version === doc.version) return;
    if (doc.dirty) doc.data = normalize(mergeLists(r.data, plain(doc.data)));
    else { this.announce(doc.data, r.data); doc.data = normalize(r.data); }
    doc.version = r.version;
    this.persist(doc);
  }
  private announce(before: ListData, after: ListData) {
    const seen = new Set(before.log.map((e) => e.id));
    const fresh = (after.log || []).filter((e) => !seen.has(e.id) && e.user !== this.user);
    if (fresh.length === 1) toast(`${fresh[0].user} ${fresh[0].action} ${fresh[0].itemName}`.trim());
    else if (fresh.length > 1) toast(`${fresh[0].user} made ${fresh.length} changes`);
  }
  watch(id: string) {
    const tick = (force = false) => {
      if (document.hidden || !navigator.onLine) return;
      if (!force && Date.now() - this.lastPoll < 3000) return;
      this.lastPoll = Date.now();
      this.refreshDoc(id).catch(() => {});
    };
    tick(true);
    const t = setInterval(() => tick(true), POLL_MS); // the GitHub API budget is why this isn't faster
    const wake = () => tick();
    document.addEventListener('visibilitychange', wake);
    addEventListener('focus', wake); addEventListener('online', wake);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', wake);
      removeEventListener('focus', wake); removeEventListener('online', wake);
    };
  }

  // ---- saving ----
  private mutate(id: string, fn: (d: ListData) => void) {
    const doc = this.docs[id];
    if (!doc) return;
    fn(doc.data);
    doc.dirty = true; doc.rev++;
    this.persist(doc);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }
  private flushNow() { clearTimeout(this.saveTimer); this.flush(); }
  private async flush() {
    if (this.flushing || !this.token) return;
    this.flushing = true;
    clearTimeout(this.retryTimer);
    let failed = false;
    try {
      for (;;) {
        const doc = Object.values(this.docs).find((d) => d.dirty);
        if (!doc) break;
        const rev = doc.rev;
        try {
          const r = await api<{ version: string; data: ListData }>('/api/list/' + doc.id, { method: 'PUT', body: { baseVersion: doc.version, data: plain(doc.data) } });
          this.saveSeq++;
          doc.version = r.version;
          if (doc.rev === rev) { doc.data = normalize(r.data); doc.dirty = false; }
          else doc.data = normalize(mergeLists(r.data, plain(doc.data))); // edited mid-save: go round again
          this.persist(doc);
          this.saveFails = 0;
        } catch (e) {
          const status = e instanceof ApiError ? e.status : 0;
          if (status === 403 || status === 404) {
            toast(`You no longer have access to ${doc.name}`);
            this.forget(doc.id); this.lists = this.lists.filter((l) => l.id !== doc.id);
            continue;
          }
          failed = true;
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
    if (failed && this.token) {
      this.saveFails++;
      this.retryTimer = setTimeout(() => this.flush(), Math.min(2000 * 2 ** (this.saveFails - 1), 30_000));
    }
  }

  // ---- item actions ----
  private log(d: ListData, action: string, itemName = '') {
    d.log.push({ id: uid('e'), ts: Date.now(), user: this.user!, action, itemName });
  }
  private shelf(d: ListData, name: string, category: string) {
    const key = name.toLowerCase(), prev = d.shelf[key];
    d.shelf[key] = { ...prev, name: prev?.name ?? name, category, lastAt: Date.now(), count: (prev?.count ?? 0) + 1 };
  }
  categoryFor(id: string, name: string) {
    return this.docs[id]?.data.shelf[name.toLowerCase()]?.category || categorize(name); // remembers manual corrections
  }
  toggleFav(id: string, key: string) {
    this.mutate(id, (d) => { const s = d.shelf[key]; if (s) { s.fav = !s.fav; s.lastAt = Date.now(); } });
  }

  addItem(id: string, e: { name: string; qty?: string; note?: string; category?: string }) {
    const d0 = this.docs[id]?.data;
    if (!d0) return;
    const name = e.name.trim();
    if (!name) return;
    const existing = d0.items.find((i) => !i.deleted && i.name.toLowerCase() === name.toLowerCase());
    if (existing && !existing.done) {
      if (e.qty && e.qty !== existing.qty) this.updateItem(id, existing.id, { qty: e.qty });
      toast(`${existing.name} is already on the list`);
      return;
    }
    const category = e.category || this.categoryFor(id, name);
    this.mutate(id, (d) => {
      const now = Date.now();
      if (existing) Object.assign(existing, { done: false, qty: e.qty || existing.qty, note: e.note || existing.note, updatedAt: now });
      else d.items.push({ id: uid('i'), name, qty: e.qty || '', note: e.note || '', category, done: false, addedBy: this.user!, addedAt: now, updatedAt: now, pos: now });
      this.shelf(d, name, category);
      this.log(d, 'added', name);
    });
  }
  private item(id: string, itemId: string) { return this.docs[id]?.data.items.find((i) => i.id === itemId); }

  restore(id: string, befores: Item[], action = 'restored') {
    this.mutate(id, (d) => {
      for (const b of befores) {
        const it = d.items.find((i) => i.id === b.id);
        if (it) Object.assign(it, b, { deleted: b.deleted ?? false, updatedAt: Date.now() });
      }
      this.log(d, action, befores.length === 1 ? befores[0].name : `${befores.length} items`);
    });
  }
  toggle(id: string, itemId: string) {
    const it = this.item(id, itemId);
    if (!it) return;
    this.mutate(id, (d) => {
      it.done = !it.done; it.updatedAt = Date.now();
      this.log(d, it.done ? 'ticked' : 'unticked', it.name);
    });
  }
  remove(id: string, itemId: string) {
    const it = this.item(id, itemId);
    if (!it) return;
    const before = plain(it);
    this.mutate(id, (d) => { it.deleted = true; it.updatedAt = Date.now(); this.log(d, 'removed', it.name); });
    toast(`Removed ${before.name}`, () => this.restore(id, [before]));
  }
  clearDone(id: string) {
    const d0 = this.docs[id]?.data;
    if (!d0) return;
    const done = d0.items.filter((i) => i.done && !i.deleted);
    const befores = done.map((i) => plain(i));
    this.mutate(id, (d) => {
      done.forEach((i) => { i.deleted = true; i.updatedAt = Date.now(); });
      this.log(d, 'cleared done items');
    });
    toast(`Cleared ${done.length} item${done.length === 1 ? '' : 's'}`, () => this.restore(id, befores));
  }
  updateItem(id: string, itemId: string, patch: Partial<Item>) {
    const it = this.item(id, itemId);
    if (!it) return;
    this.mutate(id, (d) => {
      Object.assign(it, patch, { updatedAt: Date.now() });
      if (patch.category) this.shelf(d, it.name, patch.category);
      this.log(d, 'edited', it.name);
    });
  }
  move(id: string, itemId: string, category: string, pos: number) {
    const it = this.item(id, itemId);
    if (!it) return;
    const before = plain(it);
    const recat = category !== it.category;
    this.mutate(id, (d) => {
      it.category = category; it.pos = pos; it.updatedAt = Date.now();
      if (recat) { this.shelf(d, it.name, category); this.log(d, `moved to ${category}`, it.name); }
    });
    if (recat) toast(`Moved ${it.name} to ${category}`, () => this.restore(id, [before], 'moved back'));
  }
  importRows(id: string, rows: { name: string; qty: string; note: string; category: string }[]) {
    const d0 = this.docs[id]?.data;
    if (!d0) return 0;
    const on = new Set(d0.items.filter((i) => !i.deleted && !i.done).map((i) => i.name.toLowerCase()));
    let added = 0;
    this.mutate(id, (d) => {
      const now = Date.now();
      for (const r of rows) {
        this.shelf(d, r.name, r.category);
        const k = r.name.toLowerCase();
        if (on.has(k)) continue;
        on.add(k);
        d.items.push({ ...r, id: uid('i'), done: false, addedBy: this.user!, addedAt: now, updatedAt: now, pos: now + added++ });
      }
      this.log(d, `imported ${added} items`);
    });
    return added;
  }

  // ---- list actions (these need the server) ----
  async createList(name: string, members: string[]) {
    const r = await api<ListMeta>('/api/lists', { method: 'POST', body: { name, members } });
    this.lists.push(r);
    this.saveLists();
    await this.refreshDoc(r.id);
    return r.id;
  }
  async rename(id: string, name: string) {
    const r = await api('/api/list/' + id + '/rename', { method: 'POST', body: { name } });
    const doc = this.docs[id]; if (doc) { doc.name = r.name; this.persist(doc); }
    const l = this.lists.find((x) => x.id === id); if (l) l.name = r.name;
    this.saveLists();
  }
  async setMembers(id: string, members: string[]) {
    const r = await api('/api/list/' + id + '/members', { method: 'POST', body: { members } });
    const doc = this.docs[id]; if (doc) { doc.members = r.members; this.persist(doc); }
    const l = this.lists.find((x) => x.id === id); if (l) l.members = r.members;
    this.saveLists();
  }
  async deleteList(id: string) {
    await api('/api/list/' + id + '/delete', { method: 'POST', body: {} });
    this.forget(id);
    this.lists = this.lists.filter((l) => l.id !== id);
    this.saveLists();
  }
}

export const store = new Store();
