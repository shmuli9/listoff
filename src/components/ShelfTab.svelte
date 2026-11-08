<script lang="ts">
  import { Check, Plus, Star } from '@lucide/svelte';
  import { store } from '../lib/store.svelte';
  import { haptic } from '../lib/ui.svelte';
  import type { Doc } from '../lib/types';

  let { id, doc }: { id: string; doc: Doc } = $props();
  let q = $state('');

  const on = $derived(new Set(doc.data.items.filter((i) => !i.deleted && !i.done).map((i) => i.name.toLowerCase())));
  const entries = $derived(Object.entries(doc.data.shelf)
    .filter(([, s]) => s.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort(([, a], [, b]) => (Number(b.fav ?? 0) - Number(a.fav ?? 0)) || (b.lastAt - a.lastAt)));
</script>

<input class="search" bind:value={q} type="search" placeholder="Search favourites and recent items" aria-label="Search">

{#each entries as [key, s] (key)}
  {@const isOn = on.has(s.name.toLowerCase())}
  <div class="shelf-row">
    <button class="star" class:on={s.fav} aria-pressed={!!s.fav} aria-label={`Favourite ${s.name}`} onclick={() => store.toggleFav(id, key)}>
      <Star size={20} fill={s.fav ? 'currentColor' : 'none'} />
    </button>
    <div class="shelf-main">
      <div>{s.name}</div>
      <small>{s.category}{s.count > 1 ? ` · added ${s.count} times` : ''}</small>
    </div>
    <button class="round" class:added={isOn} disabled={isOn} aria-label={isOn ? `${s.name} is on the list` : `Add ${s.name}`}
      onclick={() => { store.addItem(id, { name: s.name }); haptic(); }}>
      {#if isOn}<Check size={18} />{:else}<Plus size={18} />{/if}
    </button>
  </div>
{:else}
  <p class="empty">{q ? 'No matches.' : 'Items you add show up here for quick re-adding.'}</p>
{/each}
