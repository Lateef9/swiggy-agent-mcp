import fs from 'fs';
import csv from 'csv-parser';

export interface PersonPreferences {
  name: string;
  dietaryRestrictions: string[];
  cuisinePreferences: string[];
  dishPreferences: string;
  spiceLevel: string;
}

export interface Group {
  id: number;
  members: PersonPreferences[];
  totalBudget: number; // For e.g. ~5000 max cart value
}

// Function to normalize the free-text responses
function normalizeDietaryRestrictions(restrictionsStr: string): string[] {
  const normalized = [];
  const lower = restrictionsStr.toLowerCase();
  
  if (lower.includes('veg') && !lower.includes('non-veg')) {
    normalized.push('Vegetarian');
  } else if (lower.includes('vegan')) {
    normalized.push('Vegan');
  } else if (lower.includes('non-veg') || lower.includes('meat')) {
    normalized.push('Non-Vegetarian');
  } else if (lower.includes('egg') || lower.includes('eggetarian')) {
    normalized.push('Eggetarian');
  }
  
  if (lower.includes('peanut')) {
    normalized.push('Peanut Allergy');
  }
  if (lower.includes('gluten')) {
    normalized.push('Gluten Free');
  }

  return normalized.length > 0 ? normalized : ['No Restrictions'];
}

export async function parseCSV(filePath: string): Promise<PersonPreferences[]> {
  const results: PersonPreferences[] = [];
  
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => {
        // Assuming CSV columns are: Name, Dietary Restrictions, Cuisine Preferences, Dish Preferences, Spice Level
        results.push({
          name: data['Name'] || data['name'] || '',
          dietaryRestrictions: normalizeDietaryRestrictions(data['Dietary Restrictions'] || data['dietary restrictions'] || ''),
          cuisinePreferences: (data['Cuisine Preferences'] || data['cuisine preferences'] || '').split(',').map((s: string) => s.trim()).filter(Boolean),
          dishPreferences: data['Dish Preferences'] || data['dish preferences'] || '',
          spiceLevel: data['Spice Level'] || data['spice level'] || 'Medium',
        });
      })
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
}

const BUDGET_PER_PERSON = 500; // E.g., ₹500 per person
const MAX_CART_VALUE = 4500; // Leave some buffer for delivery/taxes

export function groupMembers(members: PersonPreferences[]): Group[] {
  const groups: Group[] = [];
  let currentGroupMembers: PersonPreferences[] = [];
  
  for (const member of members) {
    if ((currentGroupMembers.length + 1) * BUDGET_PER_PERSON > MAX_CART_VALUE) {
      groups.push({
        id: groups.length + 1,
        members: currentGroupMembers,
        totalBudget: currentGroupMembers.length * BUDGET_PER_PERSON,
      });
      currentGroupMembers = [];
    }
    currentGroupMembers.push(member);
  }
  
  if (currentGroupMembers.length > 0) {
    groups.push({
      id: groups.length + 1,
      members: currentGroupMembers,
      totalBudget: currentGroupMembers.length * BUDGET_PER_PERSON,
    });
  }
  
  return groups;
}
