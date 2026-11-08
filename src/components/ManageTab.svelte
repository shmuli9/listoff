<script lang="ts">
  import { untrack } from 'svelte';
  import { store } from '../lib/store.svelte';
  import { parseImport } from '../lib/parse';
  import { go, toast } from '../lib/ui.svelte';
  import type { Doc } from '../lib/types';

  let { id, doc }: { id: string; doc: Doc } = $props();
  let name = $state(untrack(() => doc.name));
  let members = $state<string[]>(untrack(() => [...doc.members]));
  let text = $state(''), armed = $state(false);

  $effect(() => { store.refreshUsers().catch(() => {}); });
  const rows = $derived(parseImport(text));
  const everyone = $derived([...new Set([...store.users, ...doc.members])].sort());

  const attempt = async (f: () => Promise<unknown>, ok: string) => {
    try { await f(); toast(ok); } catch (e: any) { toast(e.status === 0 ? 'This needs a connection' : e.message); }
  };
  const toBuy = $derived(rows.filter((r) => !r.checked));
  const history = $derived(rows.filter((r) => r.checked).length);
  const plural = (n: number) => `${n.toLocaleString()} item${n === 1 ? '' : 's'}`;

  function doImport() {
    const added = store.importRows(id, rows);
    toast(`Imported ${plural(added)}${history ? `, ${history.toLocaleString()} in Favourites` : ''}`);
    text = '';
    go('#/list/' + id);
  }
  function copy() {
    const items = doc.data.items.filter((i) => !i.deleted && !i.done);
    const out = items.map((i) => `${i.qty ? i.qty + ' x ' : ''}${i.name}${i.note ? ` (${i.note})` : ''}`).join('\n');
    if (navigator.share) navigator.share({ title: doc.name, text: out }).catch(() => {});
    else navigator.clipboard.writeText(out).then(() => toast('List copied'));
  }
  async function remove() {
    if (!armed) { armed = true; return; }
    try { await store.deleteList(id); go('#/'); toast('List deleted'); } catch (e: any) { toast(e.message); armed = false; }
  }
</script>

<section>
  <label for="rn">List name</label>
  <div class="inline">
    <input id="rn" bind:value={name} maxlength="80">
    <button class="ghost" disabled={!name.trim() || name === doc.name} onclick={() => attempt(() => store.rename(id, name.trim()), 'Renamed')}>Rename</button>
  </div>
</section>

<section>
  <h3 class="cat-head">Shared with</h3>
  {#each everyone as u}<label class="check"><input type="checkbox" value={u} bind:group={members}> {u}</label>{/each}
  <button class="ghost" disabled={!members.length} onclick={() => attempt(() => store.setMembers(id, members), 'Members updated')}>Save members</button>
</section>

<section>
  <h3 class="cat-head">Import</h3>
  <label for="imp">Paste an AnyList export, or any text with one item per line. A line ending in ":" becomes a category.</label>
  <textarea id="imp" rows="6" bind:value={text} placeholder={'Milk\n2 x bread\nCleaning:\nBleach'}></textarea>
  {#if rows.length}
    <p class="muted">
      {#if toBuy.length}{plural(toBuy.length)} to buy: {toBuy.slice(0, 6).map((r) => r.name).join(', ')}{toBuy.length > 6 ? '…' : ''}{/if}
      {#if history}<br>{plural(history)} already ticked off will go in Favourites, ready to re-add.{/if}
    </p>
    <button class="primary" onclick={doImport}>Import {toBuy.length ? plural(toBuy.length) : `${history.toLocaleString()} to Favourites`}</button>
  {/if}
</section>

<section>
  <button class="ghost" onclick={copy}>Share list as text</button>
  <button class="ghost danger" onclick={remove}>{armed ? 'Tap again to delete for everyone' : 'Delete this list'}</button>
</section>
