<script lang="ts">
  import { untrack } from 'svelte';
  import { store } from '../lib/store.svelte';
  import { CATEGORY_ORDER } from '../lib/categories';
  import type { Doc, Item } from '../lib/types';
  import Sheet from './Sheet.svelte';

  let { id, doc, item, onclose }: { id: string; doc: Doc; item: Item; onclose: () => void } = $props();

  // A private draft, so a background sync can't overwrite what's being typed.
  const start = untrack(() => ({ name: item.name, qty: item.qty || '', note: item.note || '', category: item.category || 'Other' }));
  let name = $state(start.name), qty = $state(start.qty), note = $state(start.note), category = $state(start.category);

  const cats = $derived([...new Set([...CATEGORY_ORDER, ...doc.data.items.filter((i) => !i.deleted && i.category).map((i) => i.category)])]);
  const numeric = $derived(/^\d+$/.test(qty) || qty === '');
  const step = (d: number) => { qty = String(Math.max(1, (parseInt(qty, 10) || (d > 0 ? 0 : 2)) + d)); };

  function save(e: Event) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const patch = { name: n, qty: qty.trim(), note: note.trim(), category: category.trim() || 'Other' };
    if (patch.name !== start.name || patch.qty !== start.qty || patch.note !== start.note || patch.category !== start.category) store.updateItem(id, item.id, patch);
    onclose();
  }
</script>

<Sheet title="Edit item" {onclose}>
  <form onsubmit={save}>
    <label for="en">Name</label>
    <input id="en" bind:value={name} required autocomplete="off">
    <div class="two">
      <div>
        <label for="eq">Quantity</label>
        <div class="stepper">
          {#if numeric}<button type="button" aria-label="Less" onclick={() => step(-1)}>−</button>{/if}
          <input id="eq" bind:value={qty} autocomplete="off">
          {#if numeric}<button type="button" aria-label="More" onclick={() => step(1)}>+</button>{/if}
        </div>
      </div>
      <div>
        <label for="ec">Category</label>
        <select id="ec" bind:value={category}>{#each cats as c}<option>{c}</option>{/each}</select>
      </div>
    </div>
    <label for="eo">Note</label>
    <input id="eo" bind:value={note} autocomplete="off">
    <button class="primary">Save</button>
    <button type="button" class="ghost danger wide" onclick={() => { store.remove(id, item.id); onclose(); }}>Delete item</button>
  </form>
</Sheet>
