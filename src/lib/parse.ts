import { categorize } from './categories';

export interface Parsed { name: string; qty: string; note: string }

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const UNIT = 'kg|g|ml|cl|l|lb|lbs|oz|packs?|tins?|bottles?|cans?|jars?|loaf|loaves|dozen|bunch(?:es)?|bags?|box(?:es)?';

export function parseEntry(raw: string): Parsed {
  let s = raw.trim().replace(/\s+/g, ' ');
  let note = '';
  const paren = s.match(/^(.+?)\s*\(([^)]+)\)$/);
  if (paren) { s = paren[1]; note = paren[2].trim(); }
  let m;
  if ((m = s.match(new RegExp(`^(${NUM})\\s*[x×]\\s+(.+)$`, 'i')))) return { name: m[2], qty: m[1], note };
  if ((m = s.match(new RegExp(`^(.+?)\\s+[x×]\\s*(${NUM})$`, 'i')))) return { name: m[1], qty: m[2], note };
  if ((m = s.match(new RegExp(`^(${NUM}\\s*(?:${UNIT}))\\s+(?:of\\s+)?(.+)$`, 'i')))) return { name: m[2], qty: m[1], note };
  if ((m = s.match(/^(\d+)\s+(.+)$/))) return { name: m[2], qty: m[1], note };
  return { name: s, qty: '', note };
}

export interface ImportRow extends Parsed { category: string }

export function parseImport(text: string): ImportRow[] {
  const out: ImportRow[] = [];
  let heading: string | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    // A leading "x" is only a checkmark when a space follows ("xanthan gum" is an item).
    const line = rawLine.replace(/^\s*(?:\[[ xX]?\]\s*|[-*•◦☐☑✓✔×]+\s*|x\s+)*/, '').trim();
    if (!line) continue;
    if (line.endsWith(':')) { heading = line.slice(0, -1).trim(); continue; }
    const p = parseEntry(line);
    out.push({ ...p, category: heading || categorize(p.name) });
  }
  return out;
}
