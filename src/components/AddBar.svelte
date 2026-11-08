<script lang="ts">
  import { Plus } from '@lucide/svelte';
  import { store } from '../lib/store.svelte';
  import { parseEntry } from '../lib/parse';
  import { haptic } from '../lib/ui.svelte';
  import type { Doc } from '../lib/types';

  let { id, doc }: { id: string; doc: Doc } = $props();
  let text = $state(''), focused = $state(false), active = $state(-1);
  let input: HTMLInputElement;

  const parsed = $derived(parseEntry(text));
  const suggestions = $derived.by(() => {
    if (!focused) return [];
    const q = parsed.name.toLowerCase();
    const on = new Set(doc.data.items.filter((i) => !i.deleted && !i.done).map((i) => i.name.toLowerCase()));
    return Object.values(doc.data.shelf)
      .filter((s) => !on.has(s.name.toLowerCase()) && (!q || s.name.toLowerCase().includes(q)))
      .sort((a, b) => (Number(b.fav ?? 0) - Number(a.fav ?? 0)) || (b.count - a.count) || (b.lastAt - a.lastAt))
      .slice(0, 6);
  });

  function add(name?: string) {
    const entry = name ? { name, qty: parsed.qty, note: parsed.note } : parsed;
    if (!entry.name) return;
    store.addItem(id, entry);
    haptic();
    text = ''; active = -1;
    input.focus();
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' && suggestions.length) { e.preventDefault(); active = (active + 1) % suggestions.length; }
    else if (e.key === 'ArrowUp' && suggestions.length) { e.preventDefault(); active = (active - 1 + suggestions.length) % suggestions.length; }
    else if (e.key === 'Escape') { input.blur(); }
  }
  function submit(e: Event) {
    e.preventDefault();
    add(active >= 0 ? suggestions[active]?.name : undefined);
  }
</script>

<form class="addbar" onsubmit={submit}>
  <input bind:this={input} bind:value={text} {onkeydown} oninput={() => (active = -1)}
    onfocus={() => (focused = true)} onblur={() => (focused = false)}
    placeholder="Add an item, e.g. 2 x milk" aria-label="Add an item" autocomplete="off" autocapitalize="sentences" enterkeyhint="done"
    role="combobox" aria-expanded={suggestions.length > 0} aria-controls="suggestions">
  <button class="add-btn" aria-label="Add" onpointerdowncapture={(e) => e.preventDefault()}><Plus size={22} /></button>
  {#if suggestions.length}
    <!-- preventDefault keeps the input focused, so the keyboard stays up between adds -->
    <div class="suggest" id="suggestions" role="listbox" tabindex="-1" onpointerdowncapture={(e) => e.preventDefault()}>
      {#each suggestions as s, i (s.name)}
        <button type="button" role="option" aria-selected={i === active} class:active={i === active} onclick={() => add(s.name)}>
          <span>{s.name}</span><small>{s.category}</small>
        </button>
      {/each}
    </div>
  {/if}
</form>
