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

export interface ImportRow extends Parsed { category: string; checked?: boolean; count?: number }

// Same thing, different spelling: case, accents, spacing, hyphens, trailing "?!." and a plural last word.
export function dedupeKey(name: string): string {
  const words = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/-/g, ' ').replace(/[?!.,]+\s*$/, '').trim().split(/\s+/);
  words[words.length - 1] = words[words.length - 1]
    .replace(/(ies|ie)$/, 'y')
    .replace(/(sh|ch|x|ss|o)es$/, '$1')
    .replace(/([^su])s$/, '$1');
  return words.join(' ');
}

const mostCommon = (values: string[]) => {
  const n = new Map<string, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0]; // ties keep the first seen
};

// Collapses ticked history into one row per product, with how often it was bought.
function mergeHistory(rows: ImportRow[]): ImportRow[] {
  const groups = new Map<string, ImportRow[]>();
  const out: ImportRow[] = [];
  for (const r of rows) {
    if (!r.checked) { out.push(r); continue; }
    const k = dedupeKey(r.name);
    const g = groups.get(k);
    if (g) g.push(r); else { const fresh = [r]; groups.set(k, fresh); out.push(r); }
  }
  for (const g of groups.values()) {
    const names = g.map((r) => r.name.replace(/[?!.]+\s*$/, '').trim().replace(/\s+/g, ' '));
    // Prefer a normally-cased spelling over "MILK" even if shouted more often.
    const cased = names.filter((n) => n !== n.toUpperCase() || n.length < 2);
    g[0].name = mostCommon(cased.length ? cased : names);
    g[0].category = mostCommon(g.map((r) => r.category));
    g[0].count = g.length;
  }
  return out;
}

// AnyList's aisles, folded into ours so imported and newly added items share one set.
// Aisles with no equivalent (Baby, Shabbos...) are kept as custom categories.
const ANYLIST_AISLES: Record<string, string | null> = {
  'BAKERY': 'Bakery', 'BEVERAGES': 'Drinks', 'BREAKFAST & CEREAL': 'Pantry', 'CONDIMENTS & DRESSINGS': 'Pantry',
  'COOKING & BAKING': 'Pantry', 'DAIRY': 'Dairy & Eggs', 'FROZEN FOODS': 'Frozen', 'GRAINS, PASTA & SIDES': 'Pantry',
  'HEALTH & PERSONAL CARE': 'Toiletries', 'HOUSEHOLD & CLEANING': 'Household', 'MEAT': 'Meat & Fish', 'SEAFOOD': 'Meat & Fish',
  'PRODUCE': 'Produce', 'SNACKS': 'Snacks', 'SOUPS & CANNED GOODS': 'Pantry', 'WINE, BEER & SPIRITS': 'Drinks',
  'OTHER': null, // "Other" says nothing, so let the categoriser try
};
const MARKED = /^\s*([✓•])\s*(.*)$/;
const isAisle = (l: string) => /[A-Z]/.test(l) && !/[a-z]/.test(l) && !l.endsWith(':') && !MARKED.test(l);

function isAnyListExport(lines: string[]) {
  return lines.some((l) => MARKED.test(l)) && lines.some((l, i) => (i === 0 || !lines[i - 1].trim()) && isAisle(l.trim()));
}

function parseAnyList(lines: string[]): ImportRow[] {
  const out: ImportRow[] = [];
  let aisle: string | null = null, last: ImportRow | null = null, prevBlank = true;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { prevBlank = true; last = null; continue; }
    const m = raw.match(MARKED);
    if (m) {
      // Names stay verbatim ("24 pack of tissues" is a product); only a trailing "(n)" is a quantity.
      const q = m[2].trim().match(/^(.*?)\s*\(\s*(\d+(?:[.,]\d+)?)\s*\)$/);
      const name = (q ? q[1] : m[2]).trim();
      const qty = q && parseFloat(q[2]) > 0 ? q[2] : '';
      const checked = m[1] === '✓';
      last = null;
      if (name && (!checked || name.length > 1)) { // ticked one-letter rows are abandoned typing
        last = { name, qty, note: '', checked, category: '' };
        last.category = aisle === null ? categorize(name) : aisle;
        out.push(last);
      }
    } else if (prevBlank) {
      const key = line.toUpperCase();
      aisle = key in ANYLIST_AISLES ? ANYLIST_AISLES[key] : line.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
    } else if (last) {
      last.note = last.note ? `${last.note} · ${line}` : line; // unmarked lines under an item are its notes
    }
    prevBlank = false;
  }
  return mergeHistory(out);
}

export function parseImport(text: string): ImportRow[] {
  const allLines = text.split(/\r?\n/);
  if (isAnyListExport(allLines)) return parseAnyList(allLines);
  const out: ImportRow[] = [];
  let heading: string | null = null;
  for (const rawLine of allLines) {
    // A leading "x" is only a checkmark when a space follows ("xanthan gum" is an item).
    const line = rawLine.replace(/^\s*(?:\[[ xX]?\]\s*|[-*•◦☐☑✓✔×]+\s*|x\s+)*/, '').trim();
    if (!line) continue;
    if (line.endsWith(':')) { heading = line.slice(0, -1).trim(); continue; }
    const p = parseEntry(line);
    out.push({ ...p, category: heading || categorize(p.name) });
  }
  return out;
}
