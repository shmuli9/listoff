const KEYWORDS: Record<string, string[]> = {
  'Produce': ['apple','banana','orange','grape','strawberry','blueberry','raspberry','lemon','lime','avocado','tomato','cucumber','lettuce','spinach','kale','carrot','potato','onion','garlic','pepper','broccoli','cauliflower','mushroom','courgette','zucchini','aubergine','eggplant','celery','ginger','herb','coriander','parsley','basil','mint','salad','melon','watermelon','pear','peach','plum','mango','pineapple','kiwi','spring onion','radish','beetroot','cabbage','leek','sweetcorn'],
  'Dairy & Eggs': ['milk','cheese','cheddar','mozzarella','yogurt','yoghurt','butter','cream','egg','margarine','feta','parmesan','cottage cheese','sour cream','mascarpone','halloumi'],
  'Bakery': ['bread','bagel','roll','croissant','challah','wrap','tortilla','pitta','pita','bun','baguette','cake','muffin','doughnut','donut','pastry','cracker','loaf'],
  'Meat & Fish': ['chicken','beef','lamb','mince','steak','salmon','tuna','cod','prawn','shrimp','turkey','bacon','sausage','ham','fish','brisket','schnitzel'],
  'Frozen': ['frozen','ice cream','ice lolly','chips','peas','pizza'],
  'Pantry': ['rice','pasta','spaghetti','penne','flour','sugar','salt','oil','olive oil','vinegar','sauce','ketchup','mayonnaise','mayo','mustard','honey','jam','peanut butter','cereal','oats','tin','canned','beans','lentils','chickpeas','tahini','soy sauce','spice','cumin','paprika','stock','noodle','couscous','quinoa','baking powder','chocolate','cocoa','tea','coffee','hummus'],
  'Snacks': ['crisps','nuts','almonds','popcorn','biscuit','cookie','sweets','candy','pretzel','granola bar'],
  'Drinks': ['water','juice','cola','coke','lemonade','beer','wine','soda','fizzy','squash','kiddush'],
  'Household': ['foil','cling film','baking paper','parchment','napkin','paper towel','toilet roll','toilet paper','bin bag','detergent','washing up','dish soap','sponge','bleach','cleaner','wipes','candle','battery','batteries','light bulb','laundry','softener','air freshener','zip bag','freezer bag'],
  'Toiletries': ['shampoo','conditioner','soap','toothpaste','toothbrush','deodorant','tissues','sunscreen','moisturiser','razor','shaving','hand wash','body wash','nappy','nappies','diaper'],
};

export const CATEGORY_ORDER = [...Object.keys(KEYWORDS), 'Other'];

const MATCHERS = Object.entries(KEYWORDS).flatMap(([category, words]) => words.map((w) => {
  const stem = w.endsWith('y') ? w.slice(0, -1) + '(?:y|ies)' : w + '(?:s|es)?';
  return { category, len: w.length, re: new RegExp('(?<![a-z])' + stem + '(?![a-z])', 'g') };
}));

// Whole words only ("shampoo" isn't ham). English puts the head noun last, so the
// match ending latest wins ("chicken stock" is stock), then the longest ("peanut butter").
export function categorize(name: string): string {
  const n = name.toLowerCase();
  let best = { end: -1, len: 0, category: 'Other' };
  for (const m of MATCHERS) {
    for (const hit of n.matchAll(m.re)) {
      const end = hit.index + hit[0].length;
      if (end > best.end || (end === best.end && m.len > best.len)) best = { end, len: m.len, category: m.category };
    }
  }
  return best.category;
}
