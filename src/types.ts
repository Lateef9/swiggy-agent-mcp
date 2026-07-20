// Swiggy MCP beta rejects place_food_order when the cart is ₹1000 or more.
export const SWIGGY_MCP_MAX_CART_TOTAL = 999;
// Reserve room for delivery fees and taxes when choosing menu items.
export const SWIGGY_MCP_CART_FEE_BUFFER = 150;

export interface TeamMember {
  name: string;
  dietaryRestrictions: string[]; // e.g. ["vegetarian", "no-peanuts"]
  cuisinePreferences: string[];  // e.g. ["north-indian", "chinese"]
  dishPreferences: string[];     // e.g. ["biryani", "paneer"]
  spiceLevel: "mild" | "medium" | "spicy" | "any";
}

export interface PartyConfig {
  eventName: string;
  deliveryAddressLabel: string; // matches Swiggy saved address label, e.g. "Office"
  maxBudgetPerPerson: number;   // in INR
  members: TeamMember[];
}

export interface CartGroup {
  members: TeamMember[];
  totalEstimate: number;
}

export interface CartItem {
  memberName: string;
  dish: string;
  restaurantItem: string;
  itemId: string;
  quantity: number;
  price: number;
}

export interface OrderSummary {
  restaurantName: string;
  restaurantId: string;
  addressId: string;
  deliveryAddress: string;
  availablePaymentMethods: string[];
  items: CartItem[];
  subtotal: number;
  couponCode?: string;
  discount?: number;
  total: number;
  groupIndex: number;
  totalGroups: number;
}
