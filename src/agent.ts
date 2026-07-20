import { createAnthropic } from "@ai-sdk/anthropic";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
  SWIGGY_MCP_CART_FEE_BUFFER,
  SWIGGY_MCP_MAX_CART_TOTAL,
} from "./types.js";
import type { CartItem, OrderSummary, TeamMember } from "./types.js";

const MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MCP_URL = "https://mcp.swiggy.com/food";

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

type UnknownRecord = Record<string, unknown>;

interface McpResult {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}

interface Address {
  id: string;
  addressLine: string;
  addressCategory: string | undefined;
  addressTag: string | undefined;
}

interface Restaurant {
  id: string;
  name: string;
  cuisines: string[];
  avgRating: number;
  deliveryTimeMinutes: number;
  veg: boolean | undefined;
  availabilityStatus: string | undefined;
}

interface MenuItem {
  name: string;
  price: number;
  menu_item_id: string;
  inStock: number | undefined;
  isVeg: boolean | undefined;
  rating: string | undefined;
  hasVariants: boolean | undefined;
  variations: unknown;
  variantsV2: unknown;
}

interface MemberCandidates {
  member: TeamMember;
  items: MenuItem[];
}

const selectionSchema = z.object({
  selections: z.array(
    z.object({
      memberName: z.string(),
      itemId: z.string(),
    })
  ),
});

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object"
    ? (value as UnknownRecord)
    : undefined;
}

function contentToText(content: unknown): string {
  if (!Array.isArray(content)) return "";

  return content
    .map((entry) => {
      const record = asRecord(entry);
      return record?.type === "text" && typeof record.text === "string"
        ? record.text
        : "";
    })
    .filter(Boolean)
    .join("\n");
}

function structuredRecord(result: McpResult): UnknownRecord {
  return asRecord(result.structuredContent) ?? {};
}

function readStringField(
  value: unknown,
  names: readonly string[]
): string | undefined {
  const queue: unknown[] = [value];

  while (queue.length > 0) {
    const current = queue.shift();
    const record = asRecord(current);
    if (!record) continue;

    for (const name of names) {
      const field = record[name];
      if (typeof field === "string" && field.trim()) return field.trim();
    }
    queue.push(...Object.values(record));
  }

  return undefined;
}

function readNumericField(
  value: unknown,
  names: readonly string[]
): number | undefined {
  const queue: unknown[] = [value];

  while (queue.length > 0) {
    const current = queue.shift();
    const record = asRecord(current);
    if (!record) continue;

    for (const name of names) {
      const field = record[name];
      const parsed =
        typeof field === "number"
          ? field
          : typeof field === "string"
            ? Number(field.replace(/[₹,\s]/g, ""))
            : Number.NaN;
      if (Number.isFinite(parsed)) return parsed;
    }
    queue.push(...Object.values(record));
  }

  return undefined;
}

function readStringArrayField(
  value: unknown,
  name: string
): string[] | undefined {
  const queue: unknown[] = [value];

  while (queue.length > 0) {
    const current = queue.shift();
    const record = asRecord(current);
    if (!record) continue;

    const field = record[name];
    if (Array.isArray(field)) {
      const values = field
        .map((entry) => {
          if (typeof entry === "string") return entry;
          const item = asRecord(entry);
          return item
            ? readStringField(item, ["name", "type", "method", "id"])
            : undefined;
        })
        .filter((entry): entry is string => Boolean(entry));
      if (values.length > 0) return values;
    }
    queue.push(...Object.values(record));
  }

  return undefined;
}

function readCartTotal(result: McpResult): number | undefined {
  const structuredTotal = readNumericField(structuredRecord(result), [
    "total",
    "totalAmount",
    "cartTotal",
    "finalAmount",
    "payableAmount",
    "totalCost",
    "toPay",
  ]);
  if (structuredTotal !== undefined) return structuredTotal;

  const text = contentToText(result.content);
  const match = text.match(
    /(?:total|to\s*pay|payable)[^\n₹\d]{0,30}₹?\s*([\d,]+(?:\.\d+)?)/i
  );
  return match?.[1] ? Number(match[1].replace(/,/g, "")) : undefined;
}

function mcpErrorMessage(result: McpResult): string | undefined {
  const structured = structuredRecord(result);
  const explicitFailure =
    result.isError === true ||
    structured.success === false ||
    structured.successful === false;

  if (!explicitFailure) return undefined;

  return (
    readStringField(structured.error, ["message"]) ??
    readStringField(structured, [
      "statusMessage",
      "titleMessage",
      "message",
      "errorMessage",
    ]) ??
    (contentToText(result.content) || undefined) ??
    "Swiggy MCP tool call failed."
  );
}

function assertMcpSucceeded(result: McpResult, operation: string): void {
  const error = mcpErrorMessage(result);
  if (error) throw new Error(`${operation}: ${error}`);
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/[-_]+/g, " ");
}

function isVegetarian(member: TeamMember): boolean {
  return member.dietaryRestrictions.some((restriction) =>
    ["vegetarian", "vegan", "jain"].includes(normalise(restriction))
  );
}

function itemMatchesRestrictions(item: MenuItem, member: TeamMember): boolean {
  const name = normalise(item.name);
  const restrictions = member.dietaryRestrictions.map(normalise);

  if (isVegetarian(member) && item.isVeg !== true) return false;
  if (restrictions.includes("vegan")) {
    if (
      /(paneer|cheese|butter|cream|milk|ghee|curd|lassi|egg)/.test(name)
    ) {
      return false;
    }
  }
  if (
    restrictions.includes("no peanuts") &&
    /(peanut|groundnut)/.test(name)
  ) {
    return false;
  }
  if (
    restrictions.includes("no dairy") &&
    /(paneer|cheese|butter|cream|milk|ghee|curd|lassi)/.test(name)
  ) {
    return false;
  }
  if (
    restrictions.includes("gluten free") &&
    /(bread|naan|roti|paratha|pasta|noodle|pizza)/.test(name)
  ) {
    return false;
  }

  return true;
}

function buildMemberQuery(member: TeamMember): string {
  return (
    member.dishPreferences.find(Boolean) ??
    member.cuisinePreferences.find(Boolean) ??
    (isVegetarian(member) ? "vegetarian meal" : "meal")
  );
}

function buildRestaurantQuery(members: TeamMember[]): string {
  const cuisineCounts = new Map<string, number>();
  for (const cuisine of members.flatMap(
    (member) => member.cuisinePreferences
  )) {
    const key = normalise(cuisine);
    cuisineCounts.set(key, (cuisineCounts.get(key) ?? 0) + 1);
  }

  return (
    [...cuisineCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    "restaurant"
  );
}

function selectRestaurant(
  restaurants: Restaurant[],
  members: TeamMember[]
): Restaurant {
  const mixedGroup =
    members.some(isVegetarian) && members.some((member) => !isVegetarian(member));
  const requestedCuisines = new Set(
    members.flatMap((member) => member.cuisinePreferences.map(normalise))
  );

  const open = restaurants.filter(
    (restaurant) =>
      !restaurant.availabilityStatus ||
      restaurant.availabilityStatus.toUpperCase() === "OPEN"
  );
  const compatible = mixedGroup
    ? open.filter((restaurant) => restaurant.veg !== true)
    : open;
  const pool = compatible.length > 0 ? compatible : open;

  const ranked = [...pool].sort((a, b) => {
    const cuisineScore = (restaurant: Restaurant) =>
      restaurant.cuisines.filter((cuisine) =>
        requestedCuisines.has(normalise(cuisine))
      ).length;
    const scoreA =
      cuisineScore(a) * 100 +
      a.avgRating * 10 -
      a.deliveryTimeMinutes / 10;
    const scoreB =
      cuisineScore(b) * 100 +
      b.avgRating * 10 -
      b.deliveryTimeMinutes / 10;
    return scoreB - scoreA;
  });

  const selected = ranked[0];
  if (!selected) {
    throw new Error("No open restaurant matched this group's preferences.");
  }
  return selected;
}

function parseAddresses(result: McpResult): {
  addresses: Address[];
  hasMore: boolean;
  page: number;
} {
  const structured = structuredRecord(result);
  const addresses = Array.isArray(structured.addresses)
    ? structured.addresses
        .map(asRecord)
        .filter((record): record is UnknownRecord => Boolean(record))
        .map((record) => ({
          id: String(record.id ?? ""),
          addressLine: String(record.addressLine ?? ""),
          addressCategory:
            typeof record.addressCategory === "string"
              ? record.addressCategory
              : undefined,
          addressTag:
            typeof record.addressTag === "string"
              ? record.addressTag
              : undefined,
        }))
        .filter((address) => address.id)
    : [];
  const pagination = asRecord(structured.pagination);

  return {
    addresses,
    hasMore: pagination?.hasMore === true,
    page:
      typeof pagination?.page === "number" && pagination.page > 0
        ? pagination.page
        : 1,
  };
}

function parseRestaurants(result: McpResult): Restaurant[] {
  const raw = structuredRecord(result).restaurants;
  if (!Array.isArray(raw)) return [];

  return raw
    .map(asRecord)
    .filter((record): record is UnknownRecord => Boolean(record))
    .map((record) => ({
      id: String(record.id ?? ""),
      name: String(record.name ?? ""),
      cuisines: Array.isArray(record.cuisines)
        ? record.cuisines.map(String)
        : [],
      avgRating: Number(record.avgRating ?? 0),
      deliveryTimeMinutes: Number(record.deliveryTimeMinutes ?? 999),
      veg: typeof record.veg === "boolean" ? record.veg : undefined,
      availabilityStatus:
        typeof record.availabilityStatus === "string"
          ? record.availabilityStatus
          : undefined,
    }))
    .filter((restaurant) => restaurant.id && restaurant.name);
}

function parseMenuItems(result: McpResult): MenuItem[] {
  const raw = structuredRecord(result).items;
  if (!Array.isArray(raw)) return [];

  return raw
    .map(asRecord)
    .filter((record): record is UnknownRecord => Boolean(record))
    .map((record) => ({
      name: String(record.name ?? ""),
      price: Number(record.price),
      menu_item_id: String(record.menu_item_id ?? ""),
      inStock:
        typeof record.inStock === "number" ? record.inStock : undefined,
      isVeg: typeof record.isVeg === "boolean" ? record.isVeg : undefined,
      rating: typeof record.rating === "string" ? record.rating : undefined,
      hasVariants:
        typeof record.hasVariants === "boolean"
          ? record.hasVariants
          : undefined,
      variations: record.variations,
      variantsV2: record.variantsV2,
    }))
    .filter(
      (item) =>
        item.name &&
        item.menu_item_id &&
        Number.isFinite(item.price) &&
        item.price >= 0
    );
}

export class SwiggyAgentSession {
  private readonly addressCache = new Map<string, Address>();
  private readonly restaurantCache = new Map<string, Restaurant[]>();
  private readonly menuCache = new Map<string, MenuItem[]>();
  private closed = false;

  private constructor(private readonly client: Client) {}

  static async connect(): Promise<SwiggyAgentSession> {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set.");
    }

    const command = process.env.SWIGGY_MCP_COMMAND ?? "npx";
    const args = process.env.SWIGGY_MCP_ARGS
      ? process.env.SWIGGY_MCP_ARGS.split(/\s+/).filter(Boolean)
      : [
          "-y",
          "mcp-remote",
          process.env.SWIGGY_FOOD_MCP_URL ?? DEFAULT_MCP_URL,
        ];
    const transport = new StdioClientTransport({
      command,
      args,
      env: process.env as Record<string, string>,
      stderr: "pipe",
    });
    const client = new Client(
      { name: "swiggy-party-agent", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(transport);
    return new SwiggyAgentSession(client);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.client.close();
  }

  private async call(
    name: string,
    args: UnknownRecord,
    operation: string
  ): Promise<McpResult> {
    if (this.closed) throw new Error("Swiggy MCP session is already closed.");
    const result = (await this.client.callTool({
      name,
      arguments: args,
    })) as McpResult;
    assertMcpSucceeded(result, operation);
    return result;
  }

  private async resolveAddress(label: string): Promise<Address> {
    const key = normalise(label);
    const cached = this.addressCache.get(key);
    if (cached) return cached;

    const addresses: Address[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 10) {
      const result = await this.call(
        "get_addresses",
        page === 1 ? {} : { page, pageSize: 10 },
        "Could not load saved addresses"
      );
      const parsed = parseAddresses(result);
      addresses.push(...parsed.addresses);
      hasMore = parsed.hasMore;
      page = parsed.page + 1;
    }

    const exact = addresses.find((address) =>
      [address.addressTag, address.addressCategory]
        .filter((value): value is string => Boolean(value))
        .some((value) => normalise(value) === key)
    );
    const partial =
      exact ??
      addresses.find((address) =>
        [address.addressTag, address.addressCategory, address.addressLine]
          .filter((value): value is string => Boolean(value))
          .some((value) => normalise(value).includes(key))
      );

    if (!partial) {
      const labels = [
        ...new Set(
          addresses
            .flatMap((address) => [
              address.addressTag,
              address.addressCategory,
            ])
            .filter((value): value is string => Boolean(value))
        ),
      ];
      throw new Error(
        `No saved address matched "${label}". Available labels: ${labels.join(", ")}.`
      );
    }

    this.addressCache.set(key, partial);
    return partial;
  }

  private async findRestaurants(
    addressId: string,
    query: string
  ): Promise<Restaurant[]> {
    const key = `${addressId}:${normalise(query)}`;
    const cached = this.restaurantCache.get(key);
    if (cached) return cached;

    const result = await this.call(
      "search_restaurants",
      { addressId, query },
      "Restaurant search failed"
    );
    const restaurants = parseRestaurants(result);
    this.restaurantCache.set(key, restaurants);
    return restaurants;
  }

  private async findMenuItems(
    addressId: string,
    restaurantId: string,
    query: string
  ): Promise<MenuItem[]> {
    const key = `${addressId}:${restaurantId}:${normalise(query)}`;
    const cached = this.menuCache.get(key);
    if (cached) return cached;

    const result = await this.call(
      "search_menu",
      {
        addressId,
        restaurantIdOfAddedItem: restaurantId,
        query,
      },
      `Menu search failed for "${query}"`
    );
    const items = parseMenuItems(result);
    this.menuCache.set(key, items);
    return items;
  }

  private async loadCandidates(
    members: TeamMember[],
    addressId: string,
    restaurantId: string,
    maxBudgetPerPerson: number
  ): Promise<MemberCandidates[]> {
    return Promise.all(
      members.map(async (member) => {
        const query = buildMemberQuery(member);
        let items = await this.findMenuItems(
          addressId,
          restaurantId,
          query
        );
        items = items.filter(
          (item) =>
            item.inStock !== 0 &&
            item.price <= maxBudgetPerPerson &&
            item.hasVariants !== true &&
            item.variations === undefined &&
            item.variantsV2 === undefined &&
            itemMatchesRestrictions(item, member)
        );

        if (items.length === 0 && normalise(query) !== "meal") {
          const fallback = await this.findMenuItems(
            addressId,
            restaurantId,
            isVegetarian(member) ? "vegetarian meal" : "meal"
          );
          items = fallback.filter(
            (item) =>
              item.inStock !== 0 &&
              item.price <= maxBudgetPerPerson &&
              item.hasVariants !== true &&
              item.variations === undefined &&
              item.variantsV2 === undefined &&
              itemMatchesRestrictions(item, member)
          );
        }

        if (items.length === 0) {
          throw new Error(
            `No safe in-budget menu item was found for ${member.name} at the selected restaurant.`
          );
        }
        return { member, items: items.slice(0, 8) };
      })
    );
  }

  private async chooseItems(
    candidates: MemberCandidates[]
  ): Promise<CartItem[]> {
    const compactCandidates = candidates.map(({ member, items }) => ({
      member: {
        name: member.name,
        dietaryRestrictions: member.dietaryRestrictions,
        dishPreferences: member.dishPreferences,
        cuisinePreferences: member.cuisinePreferences,
        spiceLevel: member.spiceLevel,
      },
      options: items.map((item) => ({
        itemId: item.menu_item_id,
        name: item.name,
        price: item.price,
        isVeg: item.isVeg ?? false,
        rating: item.rating,
      })),
    }));

    const { output } = await generateText({
      model: anthropic(MODEL),
      temperature: 0,
      output: Output.object({
        schema: selectionSchema,
      }),
      system:
        "Select exactly one listed menu item per member. Respect dietary restrictions and dish preferences. Use only the supplied member names and item IDs. Return no explanation.",
      prompt: JSON.stringify(compactCandidates),
    });

    if (!output || output.selections.length !== candidates.length) {
      throw new Error("Claude did not select exactly one item per member.");
    }

    const selections = new Map(
      output.selections.map((selection) => [
        normalise(selection.memberName),
        selection.itemId,
      ])
    );

    return candidates.map(({ member, items }) => {
      const itemId = selections.get(normalise(member.name));
      const selected = items.find((item) => item.menu_item_id === itemId);
      if (!selected) {
        throw new Error(
          `Claude returned an invalid menu item for ${member.name}.`
        );
      }

      return {
        memberName: member.name,
        dish: member.dishPreferences.join(", ") || selected.name,
        restaurantItem: selected.name,
        itemId: selected.menu_item_id,
        quantity: 1,
        price: selected.price,
      };
    });
  }

  async buildCartForGroup(
    members: TeamMember[],
    addressLabel: string,
    maxBudgetPerPerson: number,
    groupIndex: number,
    totalGroups: number,
    cartCap: number = SWIGGY_MCP_MAX_CART_TOTAL
  ): Promise<OrderSummary> {
    if (cartCap <= 0 || cartCap > SWIGGY_MCP_MAX_CART_TOTAL) {
      throw new Error(
        `Cart cap must be between ₹1 and ₹${SWIGGY_MCP_MAX_CART_TOTAL}.`
      );
    }
    if (members.length === 0) throw new Error("Cannot build an empty cart.");

    const address = await this.resolveAddress(addressLabel);
    const restaurantQuery = buildRestaurantQuery(members);
    const restaurants = await this.findRestaurants(
      address.id,
      restaurantQuery
    );
    const restaurant = selectRestaurant(restaurants, members);
    const safeSubtotalCap = Math.max(
      1,
      cartCap - SWIGGY_MCP_CART_FEE_BUFFER
    );
    const itemBudget = Math.min(
      maxBudgetPerPerson,
      Math.floor(safeSubtotalCap / members.length)
    );
    const candidates = await this.loadCandidates(
      members,
      address.id,
      restaurant.id,
      itemBudget
    );
    const items = await this.chooseItems(candidates);
    const subtotal = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    if (subtotal > safeSubtotalCap) {
      throw new Error(
        `Selected items total ₹${subtotal}; keep item subtotal at or below ₹${safeSubtotalCap} to leave room for fees.`
      );
    }

    await this.call(
      "update_food_cart",
      {
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        addressId: address.id,
        cartItems: items.map((item) => ({
          menu_item_id: item.itemId,
          quantity: item.quantity,
        })),
      },
      "Could not update the food cart"
    );

    const cartResult = await this.call(
      "get_food_cart",
      {
        addressId: address.id,
        restaurantName: restaurant.name,
      },
      "Could not verify the updated food cart"
    );
    const liveTotal = readCartTotal(cartResult);
    const availablePaymentMethods =
      readStringArrayField(
        structuredRecord(cartResult),
        "availablePaymentMethods"
      ) ?? [];

    if (liveTotal === undefined) {
      throw new Error("Swiggy did not return a verifiable live cart total.");
    }
    if (liveTotal > cartCap || liveTotal >= 1000) {
      throw new Error(
        `Live cart total ₹${liveTotal} exceeds the allowed ₹${cartCap} cap.`
      );
    }

    return {
      restaurantName: restaurant.name,
      restaurantId: restaurant.id,
      addressId: address.id,
      deliveryAddress: address.addressLine,
      availablePaymentMethods,
      items,
      subtotal,
      discount: 0,
      total: liveTotal,
      groupIndex,
      totalGroups,
    };
  }

  async placeOrder(
    summary: OrderSummary,
    cartCap: number = SWIGGY_MCP_MAX_CART_TOTAL
  ): Promise<string> {
    if (summary.total > cartCap || summary.total >= 1000) {
      throw new Error(
        `Cart total ₹${summary.total} exceeds the allowed ₹${cartCap} cap.`
      );
    }

    const cartResult = await this.call(
      "get_food_cart",
      {
        addressId: summary.addressId,
        restaurantName: summary.restaurantName,
      },
      "Could not verify the live food cart"
    );
    const liveTotal = readCartTotal(cartResult);

    if (liveTotal === undefined) {
      throw new Error("Swiggy did not return a verifiable live cart total.");
    }
    if (liveTotal > cartCap || liveTotal >= 1000) {
      throw new Error(
        `Live cart total ₹${liveTotal} exceeds the allowed ₹${cartCap} cap.`
      );
    }
    if (Math.abs(liveTotal - summary.total) > 1) {
      throw new Error(
        `Cart changed before confirmation: expected ₹${summary.total}, live cart is ₹${liveTotal}.`
      );
    }

    const result = await this.call(
      "place_food_order",
      { addressId: summary.addressId },
      "Swiggy rejected the order"
    );
    return (
      readStringField(structuredRecord(result), ["orderId", "order_id"]) ??
      readStringField(structuredRecord(result), ["message"]) ??
      contentToText(result.content)
    );
  }
}
