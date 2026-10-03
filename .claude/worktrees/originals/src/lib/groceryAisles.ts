/**
 * Grocery aisle classification for automatic item sorting.
 *
 * Maps common grocery items to store aisles using keyword matching.
 * Used when a list has the "groceries" category to group items by aisle.
 */

export interface GroceryAisle {
  id: string;
  name: string;
  emoji: string;
  order: number;
}

export const AISLES: GroceryAisle[] = [
  { id: "produce", name: "Produce", emoji: "🥬", order: 0 },
  { id: "bakery", name: "Bakery", emoji: "🍞", order: 1 },
  { id: "deli", name: "Deli", emoji: "🥪", order: 2 },
  { id: "meat", name: "Meat & Seafood", emoji: "🥩", order: 3 },
  { id: "dairy", name: "Dairy & Eggs", emoji: "🥛", order: 4 },
  { id: "frozen", name: "Frozen", emoji: "🧊", order: 5 },
  { id: "beverages", name: "Beverages", emoji: "🥤", order: 6 },
  { id: "snacks", name: "Snacks", emoji: "🍿", order: 7 },
  { id: "canned", name: "Canned & Jarred", emoji: "🥫", order: 8 },
  { id: "pasta", name: "Pasta, Rice & Grains", emoji: "🍝", order: 9 },
  { id: "condiments", name: "Condiments & Sauces", emoji: "🫙", order: 10 },
  { id: "baking", name: "Baking", emoji: "🧁", order: 11 },
  { id: "breakfast", name: "Breakfast & Cereal", emoji: "🥣", order: 12 },
  { id: "household", name: "Household", emoji: "🧹", order: 13 },
  { id: "health", name: "Health & Personal Care", emoji: "🧴", order: 14 },
  { id: "other", name: "Other", emoji: "🛒", order: 99 },
];

const AISLE_MAP: Record<string, string> = {};

// Build a flat keyword → aisle map
const KEYWORDS: Record<string, string[]> = {
  produce: [
    "apple", "apples", "banana", "bananas", "orange", "oranges", "lemon", "lemons",
    "lime", "limes", "grape", "grapes", "grapefruit", "strawberry", "strawberries",
    "blueberry", "blueberries", "raspberry", "raspberries", "blackberry", "blackberries",
    "cherry", "cherries", "peach", "peaches", "pear", "pears", "plum", "plums",
    "mango", "mangoes", "pineapple", "watermelon", "melon", "cantaloupe", "honeydew",
    "kiwi", "avocado", "avocados", "tomato", "tomatoes", "potato", "potatoes",
    "onion", "onions", "garlic", "ginger", "carrot", "carrots", "celery",
    "broccoli", "cauliflower", "spinach", "kale", "lettuce", "arugula", "cabbage",
    "cucumber", "cucumbers", "zucchini", "squash", "bell pepper", "pepper", "peppers",
    "jalapeño", "jalapeno", "mushroom", "mushrooms", "corn", "green bean", "green beans",
    "asparagus", "artichoke", "eggplant", "beet", "beets", "radish", "radishes",
    "sweet potato", "sweet potatoes", "yam", "yams", "parsley", "cilantro", "basil",
    "mint", "dill", "rosemary", "thyme", "sage", "chive", "chives", "scallion",
    "scallions", "green onion", "green onions", "leek", "leeks", "fennel",
    "snap pea", "snap peas", "edamame", "sprout", "sprouts", "herb", "herbs",
    "salad", "fruit", "vegetable", "vegetables", "berries", "clementine", "clementines",
    "tangerine", "tangerines", "nectarine", "nectarines", "coconut", "fig", "figs",
    "pomegranate", "papaya", "passion fruit", "lychee", "plantain", "plantains",
    "turnip", "turnips", "parsnip", "parsnips", "rutabaga", "bok choy", "endive",
    "watercress", "collard greens", "swiss chard", "romaine",
  ],
  bakery: [
    "bread", "rolls", "baguette", "croissant", "croissants", "muffin", "muffins",
    "bagel", "bagels", "tortilla", "tortillas", "pita", "naan", "flatbread",
    "bun", "buns", "english muffin", "english muffins", "ciabatta", "sourdough",
    "rye bread", "wheat bread", "white bread", "sandwich bread", "hamburger bun",
    "hot dog bun", "dinner roll", "dinner rolls", "cake", "pie", "donut", "donuts",
    "doughnut", "doughnuts", "pastry", "pastries", "cookie", "cookies", "brownie",
    "brownies", "cupcake", "cupcakes",
  ],
  deli: [
    "deli", "ham", "turkey breast", "salami", "prosciutto", "pepperoni", "pastrami",
    "roast beef", "bologna", "lunch meat", "cold cut", "cold cuts", "hummus",
    "olive", "olives", "pickle", "pickles", "prepared", "rotisserie",
  ],
  meat: [
    "chicken", "beef", "pork", "steak", "ground beef", "ground turkey", "ground pork",
    "turkey", "lamb", "veal", "bacon", "sausage", "sausages", "hot dog", "hot dogs",
    "brat", "bratwurst", "ribs", "roast", "chop", "chops", "pork chop", "pork chops",
    "chicken breast", "chicken thigh", "chicken thighs", "chicken wing", "chicken wings",
    "drumstick", "drumsticks", "tenderloin", "filet", "sirloin", "ribeye",
    "salmon", "tuna", "shrimp", "cod", "tilapia", "halibut", "crab", "lobster",
    "scallop", "scallops", "clam", "clams", "mussel", "mussels", "oyster", "oysters",
    "fish", "seafood", "anchovy", "anchovies", "sardine", "sardines", "trout",
    "mahi", "swordfish", "catfish", "bass",
  ],
  dairy: [
    "milk", "cream", "half and half", "half & half", "heavy cream", "whipping cream",
    "butter", "margarine", "cheese", "cheddar", "mozzarella", "parmesan", "swiss",
    "provolone", "gouda", "brie", "feta", "cream cheese", "cottage cheese",
    "ricotta", "goat cheese", "blue cheese", "american cheese", "jack cheese",
    "pepper jack", "colby", "gruyere", "havarti", "string cheese",
    "yogurt", "greek yogurt", "sour cream", "egg", "eggs", "whipped cream",
    "coffee creamer", "creamer", "oat milk", "almond milk", "soy milk",
    "coconut milk", "buttermilk", "eggnog", "kefir",
  ],
  frozen: [
    "frozen", "ice cream", "gelato", "sorbet", "popsicle", "popsicles",
    "frozen pizza", "frozen dinner", "frozen vegetable", "frozen vegetables",
    "frozen fruit", "frozen berries", "frozen fries", "french fries", "tater tots",
    "frozen waffles", "frozen breakfast", "frozen burrito", "frozen meal",
    "frozen chicken", "frozen fish", "fish sticks", "corn dogs",
    "ice", "ice pop", "frozen yogurt", "cool whip", "frozen pie",
  ],
  beverages: [
    "water", "sparkling water", "seltzer", "soda", "pop", "cola", "coke",
    "pepsi", "sprite", "ginger ale", "tonic", "club soda",
    "juice", "orange juice", "apple juice", "cranberry juice", "grape juice",
    "lemonade", "iced tea", "tea", "green tea", "black tea", "herbal tea",
    "coffee", "ground coffee", "coffee beans", "k-cup", "k-cups",
    "energy drink", "sports drink", "gatorade", "kombucha",
    "wine", "beer", "hard seltzer", "liquor", "vodka", "rum", "whiskey",
    "tequila", "gin", "bourbon", "champagne", "prosecco",
  ],
  snacks: [
    "chip", "chips", "potato chips", "tortilla chips", "corn chips",
    "popcorn", "pretzel", "pretzels", "cracker", "crackers",
    "nuts", "peanut", "peanuts", "almond", "almonds", "cashew", "cashews",
    "walnut", "walnuts", "pecan", "pecans", "pistachio", "pistachios",
    "trail mix", "mixed nuts", "granola bar", "granola bars", "protein bar",
    "protein bars", "candy", "chocolate", "gummy", "gummies",
    "beef jerky", "jerky", "dried fruit", "fruit snack", "fruit snacks",
    "rice cake", "rice cakes", "cheese puff", "cheese puffs",
    "salsa", "guacamole", "dip",
  ],
  canned: [
    "canned", "can of", "tin of",
    "canned tomato", "canned tomatoes", "tomato sauce", "tomato paste", "diced tomatoes",
    "crushed tomatoes", "marinara",
    "canned bean", "canned beans", "black beans", "kidney beans", "chickpeas",
    "garbanzo", "lentils", "refried beans", "pinto beans", "white beans",
    "canned corn", "canned peas", "canned green beans",
    "canned tuna", "canned salmon", "canned chicken",
    "soup", "broth", "stock", "chicken broth", "beef broth", "vegetable broth",
    "coconut cream", "evaporated milk", "condensed milk",
    "canned fruit", "applesauce", "jam", "jelly", "preserves", "marmalade",
    "peanut butter", "almond butter", "nutella",
  ],
  pasta: [
    "pasta", "spaghetti", "penne", "rigatoni", "fusilli", "farfalle", "linguine",
    "fettuccine", "angel hair", "macaroni", "orzo", "lasagna", "noodle", "noodles",
    "ramen", "udon", "rice noodles", "egg noodles",
    "rice", "white rice", "brown rice", "jasmine rice", "basmati rice",
    "wild rice", "minute rice", "instant rice", "risotto",
    "quinoa", "couscous", "bulgur", "farro", "barley", "oats", "oatmeal",
    "grits", "polenta", "cornmeal",
    "mac and cheese", "mac & cheese",
  ],
  condiments: [
    "ketchup", "mustard", "mayo", "mayonnaise", "relish",
    "hot sauce", "sriracha", "tabasco", "soy sauce", "teriyaki",
    "bbq sauce", "barbecue sauce", "worcestershire", "steak sauce",
    "vinegar", "balsamic", "apple cider vinegar", "red wine vinegar",
    "olive oil", "vegetable oil", "canola oil", "coconut oil", "sesame oil",
    "cooking spray", "dressing", "ranch", "italian dressing", "vinaigrette",
    "honey", "maple syrup", "agave", "molasses",
    "salt", "pepper", "seasoning", "spice", "cumin", "paprika", "chili powder",
    "oregano", "cinnamon", "nutmeg", "turmeric", "curry", "cayenne",
    "garlic powder", "onion powder", "bay leaf", "bay leaves",
  ],
  baking: [
    "flour", "all-purpose flour", "bread flour", "cake flour", "whole wheat flour",
    "sugar", "brown sugar", "powdered sugar", "confectioner",
    "baking soda", "baking powder", "yeast", "cornstarch",
    "vanilla", "vanilla extract", "almond extract",
    "chocolate chip", "chocolate chips", "cocoa", "cocoa powder",
    "sprinkles", "food coloring", "frosting", "icing",
    "pie crust", "phyllo", "puff pastry",
  ],
  breakfast: [
    "cereal", "granola", "oatmeal", "pancake", "pancake mix", "waffle mix",
    "syrup", "pancake syrup",
    "pop tart", "pop tarts", "toaster pastry", "toaster pastries",
    "instant oatmeal", "cream of wheat",
  ],
  household: [
    "paper towel", "paper towels", "toilet paper", "tissue", "tissues",
    "napkin", "napkins", "aluminum foil", "foil", "plastic wrap", "saran wrap",
    "zip lock", "ziplock", "ziploc", "sandwich bag", "sandwich bags", "trash bag",
    "trash bags", "garbage bag", "garbage bags",
    "dish soap", "dishwasher", "detergent", "laundry", "bleach", "cleaner",
    "sponge", "sponges", "wipes", "disinfectant", "lysol", "clorox",
    "light bulb", "battery", "batteries",
    "pet food", "dog food", "cat food", "cat litter",
  ],
  health: [
    "toothpaste", "toothbrush", "mouthwash", "floss", "dental",
    "shampoo", "conditioner", "body wash", "soap", "hand soap",
    "lotion", "moisturizer", "sunscreen", "deodorant", "antiperspirant",
    "razor", "razors", "shaving cream",
    "band-aid", "band-aids", "bandage", "bandages", "first aid",
    "medicine", "tylenol", "advil", "ibuprofen", "acetaminophen", "aspirin",
    "vitamin", "vitamins", "supplement", "supplements",
    "cotton ball", "cotton balls", "q-tip", "q-tips",
    "feminine", "tampon", "tampons", "pad", "pads",
    "diaper", "diapers", "baby wipe", "baby wipes", "formula",
  ],
};

// Build the lookup map
for (const [aisleId, keywords] of Object.entries(KEYWORDS)) {
  for (const keyword of keywords) {
    AISLE_MAP[keyword.toLowerCase()] = aisleId;
  }
}

/**
 * Classify a grocery item name into an aisle.
 * Uses longest-match-first to handle multi-word items like "green beans".
 */
export function classifyItem(itemName: string): string {
  const name = itemName.toLowerCase().trim();

  // Try exact match first
  if (AISLE_MAP[name]) return AISLE_MAP[name];

  // Try matching longest keywords first (multi-word phrases)
  // Sort all keywords by length descending for greedy matching
  for (const [keyword, aisleId] of Object.entries(AISLE_MAP).sort(
    (a, b) => b[0].length - a[0].length
  )) {
    if (name.includes(keyword)) return aisleId;
  }

  return "other";
}

/**
 * Get the aisle definition by ID.
 */
export function getAisle(aisleId: string): GroceryAisle {
  return AISLES.find((a) => a.id === aisleId) ?? AISLES[AISLES.length - 1];
}

/**
 * Group items by grocery aisle. Returns aisles in store-walk order,
 * only including aisles that have items.
 * Custom aisles (if provided) appear after built-in aisles.
 */
export function groupByAisle<T extends { name: string; checked: boolean; groceryAisle?: string }>(
  items: T[],
  customAisles?: GroceryAisle[]
): { aisle: GroceryAisle; items: T[] }[] {
  const allAisles = customAisles?.length
    ? [...AISLES, ...customAisles].sort((a, b) => a.order - b.order)
    : AISLES;

  const groups = new Map<string, T[]>();

  for (const item of items) {
    // User-assigned aisle override takes priority over keyword auto-classification
    const aisleId = item.groceryAisle || classifyItem(item.name);
    if (!groups.has(aisleId)) groups.set(aisleId, []);
    groups.get(aisleId)!.push(item);
  }

  return allAisles.filter((aisle) => groups.has(aisle.id))
    .map((aisle) => ({
      aisle,
      items: groups.get(aisle.id)!,
    }));
}
