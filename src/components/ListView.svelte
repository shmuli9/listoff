<script lang="ts">
  import { ListChecks, Star, History, SlidersHorizontal } from '@lucide/svelte';
  import { store } from '../lib/store.svelte';
  import TopBar from './TopBar.svelte';
  import ListTab from './ListTab.svelte';
  import ShelfTab from './ShelfTab.svelte';
  import ActivityTab from './ActivityTab.svelte';
  import ManageTab from './ManageTab.svelte';

  let { id, tab }: { id: string; tab: string } = $props();
  let failed = $state('');

  $effect(() => store.watch(id));
  $effect(() => {
    if (!store.docs[id]) store.refreshDoc(id).catch((e) => { failed = e.message; });
  });

  const doc = $derived(store.docs[id]);
  const progress = $derived.by(() => {
    if (!doc || tab !== 'list') return undefined;
    const live = doc.data.items.filter((i) => !i.deleted);
    return live.length ? live.filter((i) => i.done).length / live.length : 0;
  });
  const tabs = [
    { key: 'list', label: 'List', icon: ListChecks, path: '' },
    { key: 'shelf', label: 'Favourites', icon: Star, path: '/shelf' },
    { key: 'activity', label: 'Activity', icon: History, path: '/activity' },
    { key: 'manage', label: 'Manage', icon: SlidersHorizontal, path: '/manage' },
  ];
</script>

<TopBar title={doc?.name ?? ''} back="#/" {progress} />

{#if !doc}
  <main class="page">
    {#if failed}<p class="empty">{failed}</p>{:else}<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>{/if}
  </main>
{:else}
  <main class="page with-nav">
    {#if tab === 'list'}<ListTab {id} {doc} />
    {:else if tab === 'shelf'}<ShelfTab {id} {doc} />
    {:else if tab === 'activity'}<ActivityTab {doc} />
    {:else}<ManageTab {id} {doc} />{/if}
  </main>
  <nav class="bottom-nav" aria-label="List sections">
    {#each tabs as t (t.key)}
      <a href={'#/list/' + id + t.path} class:active={tab === t.key} aria-current={tab === t.key ? 'page' : undefined}>
        <t.icon size={22} /><span>{t.label}</span>
      </a>
    {/each}
  </nav>
{/if}
