import { describe, expect, it } from 'vitest';
import { categorize } from '../src/lib/categories';
import { parseEntry, parseImport } from '../src/lib/parse';
import { compactList, mergeLists } from '../worker/merge.js';

describe('categorize', () => {
  it.each([
    ['Shampoo', 'Toiletries'], ['Tin foil', 'Household'], ['Toilet roll', 'Household'], ['Peanut butter', 'Pantry'],
    ['Ice cream', 'Frozen'], ['Chicken stock', 'Pantry'], ['Chicken', 'Meat & Fish'], ['Strawberries', 'Produce'],
    ['Eggplant', 'Produce'], ['Eggs', 'Dairy & Eggs'], ['Sweet potatoes', 'Produce'], ['Orange juice', 'Drinks'],
    ['Olive oil', 'Pantry'], ['Bread rolls', 'Bakery'], ['Spearmint gum', 'Other'], ['Widgets', 'Other'],
  ])('%s -> %s', (n, c) => expect(categorize(n)).toBe(c));
});

describe('parseEntry', () => {
  it.each([
    ['2 x milk', 'milk', '2'], ['milk x2', 'milk', '2'], ['3 eggs', 'eggs', '3'], ['500g flour', 'flour', '500g'],
    ['1.5 l of milk', 'milk', '1.5 l'], ['7up', '7up', ''], ['Milk', 'Milk', ''], ['Xylitol', 'Xylitol', ''],
  ])('%s', (input, name, qty) => expect(parseEntry(input)).toMatchObject({ name, qty }));
  it('note', () => expect(parseEntry('milk (semi skimmed)')).toEqual({ name: 'milk', qty: '', note: 'semi skimmed' }));
});

describe('parseImport', () => {
  it('handles headings, bullets, and x-words', () => {
    const r = parseImport('Baking:\n- xanthan gum\n[x] 2 x flour\n\n• x Milk');
    expect(r.map((x) => x.name)).toEqual(['xanthan gum', 'flour', 'Milk']);
    expect(r[1]).toMatchObject({ qty: '2', category: 'Baking' });
  });
});

describe('merge', () => {
  const item = (id: string, updatedAt: number, x = {}) => ({ id, updatedAt, name: id, ...x });
  it('last writer wins per item, keeps both sides additions', () => {
    const m = mergeLists({ items: [item('a', 1), item('b', 5, { name: 'server' })] }, { items: [item('b', 2, { name: 'old' }), item('c', 3)] });
    expect(m.items.map((i: any) => i.id).sort()).toEqual(['a', 'b', 'c']);
    expect(m.items.find((i: any) => i.id === 'b').name).toBe('server');
  });
  it('tombstones win and carry reorder positions', () => {
    const m = mergeLists({ items: [item('a', 1)] }, { items: [item('a', 2, { deleted: true, pos: 9 })] }, 10);
    expect(m.items[0]).toMatchObject({ deleted: true, pos: 9 });
  });
  it('compacts log and old tombstones', () => {
    const now = 1e12;
    const c = compactList({ items: [item('old', now - 8 * 864e5, { deleted: true }), item('kept', now - 864e5, { deleted: true })],
      log: Array.from({ length: 700 }, (_, i) => ({ id: i })) }, now);
    expect(c.items.map((i: any) => i.id)).toEqual(['kept']);
    expect(c.log).toHaveLength(500);
  });
});
