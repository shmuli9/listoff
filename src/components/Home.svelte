<script lang="ts">
  import { Plus, Settings, ChevronRight } from '@lucide/svelte';
  import { store } from '../lib/store.svelte';
  import { go, toast } from '../lib/ui.svelte';
  import TopBar from './TopBar.svelte';
  import Sheet from './Sheet.svelte';

  let creating = $state(false), name = $state(''), share = $state<string[]>([]), busy = $state(false);
  let error = $state('');

  $effect(() => { store.refreshLists().catch((e) => { if (!store.lists.length) error = e.message; }); });

  function remaining(id: string) {
    const items = store.docs[id]?.data.items;
    return items ? items.filter((i) => !i.deleted && !i.done).length : null;
  }
  function openCreate() { creating = true; store.refreshUsers().catch(() => {}); }
  async function create(e: Event) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    busy = true;
    try { const id = await store.createList(name.trim(), share); creating = false; go('#/list/' + id); }
    catch (ex: any) { toast(ex.message); }
    busy = false;
  }
</script>

<TopBar title="listoff">
  {#snippet actions()}<a class="icon-btn" href="#/account" aria-label="Account"><Settings size={22} /></a>{/snippet}
</TopBar>

<main class="page">
  {#each store.lists as l (l.id)}
    {@const n = remaining(l.id)}
    <a class="card" href={'#/list/' + l.id}>
      <div class="card-main">
        <div class="card-title">{l.name}</div>
        <div class="card-meta">{n === null ? '' : n === 0 ? 'All done · ' : `${n} to get · `}{l.members.join(', ')}</div>
      </div>
      <ChevronRight size={20} />
    </a>
  {:else}
    {#if store.listsLoaded}<p class="empty">No lists yet. Create your first one.</p>
    {:else if error}<p class="empty">{error}</p>
    {:else}<div class="skeleton"></div><div class="skeleton"></div>{/if}
  {/each}
</main>
<button class="fab" onclick={openCreate}><Plus size={20} /> New list</button>

{#if creating}
  <Sheet title="New list" onclose={() => (creating = false)}>
    <form onsubmit={create}>
      <label for="ln">Name</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="ln" bind:value={name} maxlength="80" autofocus required>
      {#if store.users.filter((u) => u !== store.user).length}
        <fieldset>
          <legend>Share with</legend>
          {#each store.users.filter((u) => u !== store.user) as u}
            <label class="check"><input type="checkbox" value={u} bind:group={share}> {u}</label>
          {/each}
        </fieldset>
      {/if}
      <button class="primary" disabled={busy}>{busy ? 'Creating…' : 'Create list'}</button>
    </form>
  </Sheet>
{/if}
