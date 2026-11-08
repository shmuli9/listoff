<script lang="ts">
  import { Check, GripVertical, Trash2 } from '@lucide/svelte';
  import { haptic } from '../lib/ui.svelte';
  import type { Item } from '../lib/types';

  let { item, ontick, onremove, onedit, ongrip, onmove, hint }: {
    item: Item; ontick: () => void; onremove: () => void; onedit: () => void;
    ongrip?: (e: PointerEvent) => void; onmove?: (dir: -1 | 1) => void; hint?: string;
  } = $props();

  let row: HTMLElement;
  let dx = $state(0), swiping = $state(false);
  const THRESHOLD = 88;

  function onpointerdown(e: PointerEvent) {
    if (e.pointerType !== 'touch' || (e.target as HTMLElement).closest('.grip')) return;
    const sx = e.clientX, sy = e.clientY;
    let locked: 'x' | 'y' | null = null, armed = false;
    const move = (ev: PointerEvent) => {
      const x = ev.clientX - sx, y = ev.clientY - sy;
      if (!locked && Math.hypot(x, y) > 10) locked = Math.abs(x) > Math.abs(y) ? 'x' : 'y';
      if (locked !== 'x') return;
      swiping = true; dx = x;
      const over = Math.abs(x) > THRESHOLD;
      if (over !== armed) { armed = over; haptic(6); }
    };
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      const commit = ev.type === 'pointerup' && locked === 'x' && armed;
      const dir = dx;
      swiping = false; dx = 0;
      if (locked === 'x') suppressClick();
      if (commit) (dir > 0 ? ontick : onremove)();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }
  function suppressClick() {
    const stop = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
    row.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => row?.removeEventListener('click', stop, { capture: true }), 50);
  }
  function gripKey(e: KeyboardEvent) {
    if (e.key === 'ArrowUp') { e.preventDefault(); onmove?.(-1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); onmove?.(1); }
  }
</script>

<div class="swipe" class:right={dx > 0} class:left={dx < 0}>
  <div class="swipe-bg" aria-hidden="true">{#if dx > 0}<Check size={22} />{:else if dx < 0}<Trash2 size={20} />{/if}</div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div bind:this={row} class="item" class:done={item.done} class:swiping style={dx ? `transform:translate3d(${dx}px,0,0)` : ''} onpointerdowncapture={onpointerdown}>
    <button class="tick" class:on={item.done} role="checkbox" aria-checked={item.done} aria-label={item.name} onclick={() => { haptic(10); ontick(); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    </button>
    <button class="body" onclick={onedit} aria-label={`Edit ${item.name}`}>
      <span class="name">{item.name}{#if item.qty}<em class="qty">{item.qty}</em>{/if}</span>
      {#if item.note}<span class="note">{item.note}</span>{/if}
    </button>
    {#if hint}<span class="hint">{hint}</span>{/if}
    {#if ongrip}
      <button class="grip" aria-label={`Reorder ${item.name}`} onpointerdowncapture={ongrip} onkeydown={gripKey}><GripVertical size={18} /></button>
    {:else}
      <button class="del" aria-label={`Delete ${item.name}`} onclick={onremove}><Trash2 size={17} /></button>
    {/if}
  </div>
</div>
