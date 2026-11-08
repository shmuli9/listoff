import { describe, expect, it } from 'vitest';
import { parseImport } from '../src/lib/parse';

// Invented data in the shape of AnyList's "Send a Copy" text.
const EXPORT = `Our Groceries

BABY
✓ Soft wipes - flushable (20 )
Corner shop
✓ Wipes (0)

DAIRY
• Tiny mozzarella
✓ Milk
✓ Milk
✓ Eggs (Large) x 6 (3)
Corner shop
Ask at the counter
• Strawberry yoghurts (14)
 7 smooth, 7 regular

CONDIMENTS & DRESSINGS
✓ 24 pack of napkins
✓ Beans (2 pounds)

✓ Mustard

WINE, BEER & SPIRITS
✓ White Wine

OTHER
✓ Shampoo
✓ L
• Widget
`;

describe('AnyList export', () => {
  const rows = parseImport(EXPORT);
  const find = (n: string) => rows.find((r) => r.name === n)!;

  it('separates still-to-buy from already ticked', () => {
    expect(rows.filter((r) => !r.checked).map((r) => r.name)).toEqual(['Tiny mozzarella', 'Strawberry yoghurts', 'Widget']);
  });
  it('reads trailing quantities and ignores zero', () => {
    expect(find('Soft wipes - flushable').qty).toBe('20');
    expect(find('Wipes').qty).toBe('');
    expect(find('Strawberry yoghurts').qty).toBe('14');
  });
  it('keeps product names verbatim', () => {
    expect(find('24 pack of napkins').qty).toBe('');
    expect(find('Eggs (Large) x 6')).toMatchObject({ qty: '3' });
    expect(find('Beans (2 pounds)').qty).toBe('');
  });
  it('treats unmarked lines as notes, not items', () => {
    expect(find('Soft wipes - flushable').note).toBe('Corner shop');
    expect(find('Eggs (Large) x 6').note).toBe('Corner shop · Ask at the counter');
    expect(find('Strawberry yoghurts').note).toBe('7 smooth, 7 regular');
    expect(rows.some((r) => r.name === 'Corner shop')).toBe(false);
  });
  it('maps aisles, keeps unknown ones, and categorises Other', () => {
    expect(find('Tiny mozzarella').category).toBe('Dairy & Eggs');
    expect(find('Soft wipes - flushable').category).toBe('Baby');
    expect(find('White Wine').category).toBe('Drinks');
    expect(find('Shampoo').category).toBe('Toiletries');
    expect(find('Widget').category).toBe('Other');
  });
  it('drops abandoned one-letter rows', () => expect(rows.some((r) => r.name === 'L')).toBe(false));
  it('dedupes history by spelling and counts purchases', () => {
    const r = parseImport('DAIRY\n✓ Milk\n✓ MILK\n✓ milk?\n✓ Avocado\n✓ Avocados\n✓ Avocados\n✓ Tomatoes\n✓ Tomato\n✓ Foil  dishes\n✓ Foil dish\n• Avocados');
    const checked = r.filter((x) => x.checked);
    expect(checked.map((x) => [x.name, x.count])).toEqual([['Milk', 3], ['Avocados', 3], ['Tomatoes', 2], ['Foil dishes', 2]]);
    expect(r.filter((x) => !x.checked).map((x) => x.name)).toEqual(['Avocados']);
  });
  it('does not merge different products', () => {
    const r = parseImport('DAIRY\n✓ Milk\n✓ Oat milk\n✓ Hummus\n✓ Glass\n✓ Glasses');
    expect(r.map((x) => x.name)).toEqual(['Milk', 'Oat milk', 'Hummus', 'Glass']);
  });
  it('leaves a plain bulleted list alone', () => {
    const plain = parseImport('• Milk\n• 2 x bread');
    expect(plain.map((r) => [r.name, r.qty, r.checked])).toEqual([['Milk', '', undefined], ['bread', '2', undefined]]);
  });
});
