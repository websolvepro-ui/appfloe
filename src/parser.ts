/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Mapping of spoken English numbers to numeric values
const SPOKEN_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100
};

// Available spending categories and their associated keywords for matching
export interface CategoryDefinition {
  id: string;
  name: string;
  keywords: string[];
  icon: string; // Lucide icon name
  color: string; // Tailwind class
}

export const CATEGORIES: CategoryDefinition[] = [
  {
    id: 'groceries',
    name: 'Groceries',
    keywords: ['grocery', 'groceries', 'supermarket', 'food', 'whole foods', 'trader joes', 'walmart', 'cooking', 'ingredients', 'produce', 'milk', 'bread', 'apple', 'apples', 'safeway', 'kroger', 'aldi'],
    icon: 'ShoppingCart',
    color: 'emerald',
  },
  {
    id: 'dining',
    name: 'Dining Out',
    keywords: ['restaurant', 'cafe', 'coffee', 'starbucks', 'dinner', 'lunch', 'breakfast', 'eat', 'eating', 'pub', 'bar', 'dining', 'pizza', 'burger', 'sushi', 'subway', 'mcdonalds', 'boba', 'drink', 'drinks'],
    icon: 'Utensils',
    color: 'amber',
  },
  {
    id: 'transport',
    name: 'Transport',
    keywords: ['uber', 'lyft', 'taxi', 'cab', 'bus', 'train', 'metro', 'gas', 'fuel', 'gasoline', 'subway', 'flight', 'travel', 'transport', 'transit', 'parking', 'toll', 'ticket', 'petrol'],
    icon: 'Car',
    color: 'blue',
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    keywords: ['cinema', 'movie', 'movies', 'netflix', 'game', 'games', 'concert', 'show', 'ticket', 'tickets', 'spotify', 'entertainment', 'play', 'museum', 'bowling', 'arcade', 'theatre', 'disney'],
    icon: 'Film',
    color: 'purple',
  },
  {
    id: 'utilities',
    name: 'Utilities',
    keywords: ['rent', 'electricity', 'water', 'gas bill', 'internet', 'wifi', 'phone', 'mobile', 'bill', 'power', 'utilities', 'heating', 'insurance', 'trash', 'sewer'],
    icon: 'Zap',
    color: 'orange',
  },
  {
    id: 'shopping',
    name: 'Shopping',
    keywords: ['clothes', 'shoes', 'amazon', 'target', 'apparel', 'gift', 'gifts', 'shopping', 'items', 'gadget', 'gadgets', 'keyboard', 'headphones', 'ikea', 'furniture', 'hardware'],
    icon: 'ShoppingBag',
    color: 'pink',
  }
];

// Fallback / default category if none matches
export const DEFAULT_CATEGORY_ID = 'shopping';

export interface ParsedExpenseResult {
  amount: number;
  categoryId: string;
  note: string;
}

/**
 * Normalizes numbers spoken in words (e.g. "forty five" to "45", "twelve fifty" to "12.50")
 * inside the input text to make numeric regex extraction reliable.
 */
function normalizeSpokenNumbers(text: string): string {
  let normalized = text.toLowerCase();

  // Handle common phrase combinations like "twelve fifty" -> "12.50" or "nine dollars" -> "9 dollars"
  // Let's replace standalone words with digits
  const words = normalized.split(/\s+/);
  const resultWords: string[] = [];

  let i = 0;
  while (i < words.length) {
    const current = words[i].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
    const next = words[i + 1] ? words[i + 1].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "") : '';

    // E.g. "twenty five" or "forty two"
    if (SPOKEN_NUMBERS[current] !== undefined && SPOKEN_NUMBERS[current] >= 20 && SPOKEN_NUMBERS[next] !== undefined && SPOKEN_NUMBERS[next] < 10) {
      const combinedVal = SPOKEN_NUMBERS[current] + SPOKEN_NUMBERS[next];
      resultWords.push(combinedVal.toString());
      i += 2;
      continue;
    }

    // E.g. "twelve fifty" (implied decimal for currency)
    if (SPOKEN_NUMBERS[current] !== undefined && SPOKEN_NUMBERS[next] !== undefined && SPOKEN_NUMBERS[current] > 10 && SPOKEN_NUMBERS[current] < 100 && SPOKEN_NUMBERS[next] > 10 && SPOKEN_NUMBERS[next] < 100) {
      // e.g. 12 and 50 -> 12.50
      const combinedVal = SPOKEN_NUMBERS[current] + (SPOKEN_NUMBERS[next] / 100);
      resultWords.push(combinedVal.toFixed(2));
      i += 2;
      continue;
    }

    // Single word numbers
    if (SPOKEN_NUMBERS[current] !== undefined) {
      resultWords.push(SPOKEN_NUMBERS[current].toString());
      i++;
      continue;
    }

    resultWords.push(words[i]);
    i++;
  }

  return resultWords.join(' ');
}

/**
 * Parses natural language input to extract Amount, Category, and a clean Note.
 * Runs entirely locally to preserve the user's ultimate privacy.
 */
export function parseNaturalLanguageExpense(inputText: string): ParsedExpenseResult {
  if (!inputText || inputText.trim() === '') {
    return { amount: 0, categoryId: DEFAULT_CATEGORY_ID, note: '' };
  }

  const normalizedText = normalizeSpokenNumbers(inputText);
  
  // 1. EXTRACT AMOUNT
  let amount = 0;

  // Pattern A: Match values like $45.50, $45, 45.50, or 45
  // We look for dollar signs, and clean decimal numbers
  const currencyRegex = /(?:\$|usd|val)?\s*(\d+(?:\.\d{1,2})?)/gi;
  const matches = [...normalizedText.matchAll(currencyRegex)];
  
  // Pattern B: Look for patterns like "12 dollars" or "12 bucks" or "12.50 euros"
  const dollarRegex = /(\d+(?:\.\d{1,2})?)\s*(?:dollars|dollar|bucks|buck|usd|cents|cent)/gi;
  const dollarMatches = [...normalizedText.matchAll(dollarRegex)];

  if (dollarMatches.length > 0) {
    // Give priority to numbers explicitly followed by currency terms
    amount = parseFloat(dollarMatches[0][1]);
  } else if (matches.length > 0) {
    // Fallback to first matched numeric value
    // Let's make sure it's not a year or other long number unless it's the only one
    for (const match of matches) {
      const parsed = parseFloat(match[1]);
      if (parsed > 0 && parsed < 10000) {
        amount = parsed;
        break;
      }
    }
  }

  // 2. DETECT CATEGORY (by keyword matching)
  let categoryId = DEFAULT_CATEGORY_ID;
  let highestScore = 0;
  const words = normalizedText.toLowerCase().split(/\s+/);

  for (const cat of CATEGORIES) {
    let score = 0;
    for (const keyword of cat.keywords) {
      // Check if keyword is present as a standalone word or substring
      for (const word of words) {
        if (word === keyword) {
          score += 10; // High score for exact match
        } else if (word.includes(keyword) && keyword.length > 3) {
          score += 4;  // Lower score for substring
        }
      }
    }
    if (score > highestScore) {
      highestScore = score;
      categoryId = cat.id;
    }
  }

  // 3. GENERATE CLEAN NOTE
  // We want to remove amount terms and filler words to leave a beautiful clean note.
  // E.g. "Spent 12 dollars on coffee this morning" -> "Coffee this morning"
  let cleanNote = normalizedText;

  // Remove the numerical amount text and adjacent currency symbols / words
  cleanNote = cleanNote.replace(/(?:\$|usd)?\s*\b\d+(?:\.\d{1,2})?\b\s*(?:dollars|dollar|bucks|buck|usd)?/gi, '');
  
  // Remove filler prefixes
  const fillers = [
    /^\s*(?:spent|paid|bought|cost|logged|added|purchased|for|on)\b/gi,
    /\b(?:spent|paid|bought|cost|logged|added|purchased)\b/gi,
    /\b(?:of|on|for|at|with|about|around)\b/gi,
    /\b(?:dollars|dollar|bucks|buck|usd|cents|cent)\b/gi
  ];

  fillers.forEach(regex => {
    cleanNote = cleanNote.replace(regex, ' ');
  });

  // Clean double spaces and trim
  cleanNote = cleanNote.replace(/\s+/g, ' ').trim();

  // Capitalize first letter of note for professional presentation
  if (cleanNote.length > 0) {
    cleanNote = cleanNote.charAt(0).toUpperCase() + cleanNote.slice(1);
  } else {
    // If we stripped everything, fallback to the category name or a general label
    const matchedCat = CATEGORIES.find(c => c.id === categoryId);
    cleanNote = matchedCat ? matchedCat.name : 'Expense Entry';
  }

  return {
    amount: amount > 0 ? amount : 0,
    categoryId,
    note: cleanNote
  };
}
