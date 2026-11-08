<script lang="ts">
  import type { Doc, LogEntry } from '../lib/types';
  let { doc }: { doc: Doc } = $props();

  const dayLabel = (ts: number) => {
    const d = new Date(ts), today = new Date(), y = new Date(Date.now() - 864e5);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const time = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const groups = $derived.by(() => {
    const out: { day: string; rows: LogEntry[] }[] = [];
    for (const e of [...doc.data.log].reverse().slice(0, 200)) {
      const day = dayLabel(e.ts);
      if (out.at(-1)?.day !== day) out.push({ day, rows: [] });
      out.at(-1)!.rows.push(e);
    }
    return out;
  });
</script>

{#each groups as g (g.day)}
  <h3 class="cat-head">{g.day}</h3>
  {#each g.rows as e (e.id)}
    <div class="log"><span><b>{e.user}</b> {e.action} {e.itemName}</span><time>{time(e.ts)}</time></div>
  {/each}
{:else}
  <p class="empty">No activity yet.</p>
{/each}
