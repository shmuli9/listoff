<script lang="ts">
  import { flushSync, untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';
  import { SvelteSet } from 'svelte/reactivity';
  import { store } from '../lib/store.svelte';
  import { CATEGORY_ORDER } from '../lib/categories';
  import { haptic, reducedMotion } from '../lib/ui.svelte';
  import type { Doc, Item } from '../lib/types';
  import AddBar from './AddBar.svelte';
  import ItemRow from './ItemRow.svelte';
  import ItemEditor from './ItemEditor.svelte';

  let { id, doc }: { id: string; doc: Doc } = $props();

  type Row = { key: string; kind: 'head'; cat: string; count?: number } | { key: string; kind: 'item'; cat: string; item: Item };

  // Ticked rows stay put briefly, so the row under your thumb doesn't jump between quick ticks.
  const settling = new SvelteSet<string>();
  let settleTimer: ReturnType<typeof setTimeout>;
  function tick(itemId: string) {
    store.toggle(id, itemId);
    settling.add(itemId);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => settling.clear(), 900);
  }

  const catOf = (i: Item) => i.category || 'Other';
  const live = $derived(doc.data.items.filter((i) => !i.deleted));
  const activeRows = $derived.by<Row[]>(() => {
    const groups = new Map<string, Item[]>();
    for (const it of live) {
      if (it.done && !settling.has(it.id)) continue;
      const c = catOf(it);
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c)!.push(it);
    }
    const known = CATEGORY_ORDER.filter((c) => groups.has(c));
    const custom = [...groups.keys()].filter((c) => !CATEGORY_ORDER.includes(c)).sort();
    return [...known, ...custom].flatMap((cat) => [
      { key: 'h:' + cat, kind: 'head' as const, cat },
      ...groups.get(cat)!.sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)).map((item) => ({ key: item.id, kind: 'item' as const, cat, item })),
    ]);
  });
  const doneItems = $derived(live.filter((i) => i.done && !settling.has(i.id)).sort((a, b) => b.updatedAt - a.updatedAt));
  const doneRows = $derived<Row[]>(doneItems.length ? [
    { key: 'h:__done', kind: 'head', cat: 'Done', count: doneItems.length },
    ...doneItems.map((item) => ({ key: item.id, kind: 'item' as const, cat: 'Done', item })),
  ] : []);
  const rows = $derived([...activeRows, ...doneRows]);
  const allDone = $derived(live.length > 0 && activeRows.length === 0);

  let editing = $state<string | null>(null);
  const editingItem = $derived(editing ? live.find((i) => i.id === editing) : undefined);

  // ---- drag reorder: transforms only (compositor-driven), the model changes once on drop ----
  let rowsEl: HTMLElement;
  let noFlip = $state(false), dragHint = $state<{ id: string; cat: string } | null>(null);

  const motion = () => (reducedMotion() || noFlip ? 0 : 220);

  function place(itemId: string, others: Row[], t: number) {
    const prev = others[t - 1], next = others[t];
    if (!prev) return;
    const cat = prev.cat;
    const a = prev.kind === 'item' ? prev.item.pos ?? 0 : null;
    const b = next?.kind === 'item' && next.cat === cat ? next.item.pos ?? 0 : null;
    const pos = a !== null && b !== null ? (a + b) / 2 : a !== null ? a + 1 : b !== null ? b - 1 : 0;
    store.move(id, itemId, cat, pos);
  }

  function startDrag(e: PointerEvent, itemId: string) {
    e.preventDefault();
    const grip = e.currentTarget as HTMLElement;
    try { grip.setPointerCapture(e.pointerId); } catch {}
    const snapshot = untrack(() => activeRows);
    const byKey = new Map(snapshot.map((r) => [r.key, r]));
    const scroll0 = scrollY;
    const slots = [...rowsEl.querySelectorAll<HTMLElement>('[data-active]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { el, row: byKey.get(el.dataset.key!)!, top: r.top + scroll0, h: r.height };
    }).filter((s) => s.row);
    const from = slots.findIndex((s) => s.row.key === itemId);
    if (from < 0) return;
    const self = slots[from], others = slots.filter((_, i) => i !== from);
    const homeCat = self.row.cat;
    const grabOffset = e.clientY + scroll0 - self.top;
    let pointerY = e.clientY, target = from, raf = 0;

    store.dragging = true;
    rowsEl.classList.add('reordering');
    self.el.classList.add('lifted');
    haptic(12);

    const update = () => {
      const top = pointerY + scrollY - grabOffset;
      self.el.style.transform = `translate3d(0,${top - self.top}px,0)`;
      const center = top + self.h / 2;
      let t = others.filter((o) => o.top + (o.top > self.top ? -self.h : 0) + o.h / 2 < center).length;
      t = Math.max(1, t); // never above the first heading
      if (t !== target) { target = t; haptic(4); }
      others.forEach((o, i) => {
        const origin = slots.indexOf(o);
        let shift = 0;
        if (origin < from && i >= t) shift = self.h;
        else if (origin > from && i < t) shift = -self.h;
        o.el.style.transform = shift ? `translate3d(0,${shift}px,0)` : '';
      });
      const prev = others[t - 1];
      dragHint = prev && prev.row.cat !== homeCat ? { id: itemId, cat: prev.row.cat } : null;
    };
    const loop = () => {
      const edge = 90;
      if (pointerY < edge) scrollBy(0, -10);
      else if (pointerY > innerHeight - edge) scrollBy(0, 10);
      update();
      raf = requestAnimationFrame(loop);
    };
    const move = (ev: PointerEvent) => { pointerY = ev.clientY; };
    const end = (ev: PointerEvent) => {
      cancelAnimationFrame(raf);
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end);
      store.dragging = false;
      noFlip = true; dragHint = null;
      rowsEl.classList.remove('reordering');
      self.el.classList.remove('lifted');
      slots.forEach((s) => { s.el.style.transform = ''; });
      if (ev.type === 'pointerup' && target !== from) {
        place(itemId, others.map((o) => o.row), target);
        haptic(8);
      }
      flushSync();
      noFlip = false;
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    raf = requestAnimationFrame(loop);
  }

  function nudge(itemId: string, dir: -1 | 1) {
    const from = activeRows.findIndex((r) => r.key === itemId);
    const others = activeRows.filter((r) => r.key !== itemId);
    const t = from + dir;
    if (t < 1 || t > others.length) return;
    place(itemId, others, t);
    requestAnimationFrame(() => rowsEl.querySelector<HTMLElement>(`[data-key="${itemId}"] .grip`)?.focus());
  }
</script>

<AddBar {id} {doc} />

{#if !live.length}
  <p class="empty">Your list is empty.<br>Add something above, or pick from <a href={'#/list/' + id + '/shelf'}>Favourites</a>.</p>
{:else if allDone}
  <p class="empty done-msg">All done. Nice shop.</p>
{/if}

<div class="rows" bind:this={rowsEl}>
  {#each rows as row (row.key)}
    <div class="row" data-key={row.key} data-active={row.cat === 'Done' && (row.kind === 'head' || row.item.done) ? undefined : ''}
      animate:flip={{ duration: motion() }} transition:slide={{ duration: reducedMotion() ? 0 : 170 }}>
      {#if row.kind === 'head'}
        <h3 class="cat-head">{row.cat}{#if row.count}<span> {row.count}</span>{/if}</h3>
      {:else}
        {@const it = row.item}
        <ItemRow item={it} ontick={() => tick(it.id)} onremove={() => store.remove(id, it.id)} onedit={() => (editing = it.id)}
          ongrip={it.done ? undefined : (e) => startDrag(e, it.id)} onmove={(d) => nudge(it.id, d)}
          hint={dragHint?.id === it.id ? '→ ' + dragHint.cat : undefined} />
      {/if}
    </div>
  {/each}
</div>

{#if doneItems.length}
  <button class="ghost clear" onclick={() => store.clearDone(id)}>Clear {doneItems.length} done</button>
{/if}

{#if editingItem}
  <ItemEditor {id} {doc} item={editingItem} onclose={() => (editing = null)} />
{/if}
