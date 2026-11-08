<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();
  let el: HTMLDialogElement;
  $effect(() => { el.showModal(); });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={el} class="sheet" aria-label={title} {onclose} onclick={(e) => { if (e.target === el) el.close(); }}>
  <div class="sheet-body">
    <div class="sheet-handle"></div>
    <h2>{title}</h2>
    {@render children()}
  </div>
</dialog>
