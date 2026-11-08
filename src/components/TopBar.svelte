<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronLeft, CloudOff, RefreshCw } from '@lucide/svelte';
  import { store } from '../lib/store.svelte';
  let { title, back, actions, progress }: { title: string; back?: string; actions?: Snippet; progress?: number } = $props();
</script>

<header class="topbar">
  <div class="topbar-row">
    {#if back}<a class="icon-btn" href={back} aria-label="Back"><ChevronLeft size={26} /></a>{/if}
    <h1>{title}</h1>
    {#if store.status === 'offline'}
      <span class="sync" data-testid="sync"><CloudOff size={14} /> Offline, will sync</span>
    {:else if store.status === 'retrying'}
      <span class="sync" data-testid="sync"><RefreshCw size={14} /> Retrying</span>
    {:else if store.status === 'saving'}
      <span class="sync delayed" data-testid="sync">Saving</span>
    {/if}
    {@render actions?.()}
  </div>
  {#if progress !== undefined}
    <div class="progress"><div style="transform:scaleX({progress})"></div></div>
  {/if}
</header>
