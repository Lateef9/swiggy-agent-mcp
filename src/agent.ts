import { generateText, tool, CoreMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Group } from './parser.js';
import { z } from 'zod';

let mcpClient: Client | null = null;

async function getMcpClient() {
  if (mcpClient) return mcpClient;

  const transport = new StdioClientTransport({
    command: process.env.SWIGGY_MCP_COMMAND || 'npx',
    args: process.env.SWIGGY_MCP_ARGS ? process.env.SWIGGY_MCP_ARGS.split(' ') : ['@swiggy/mcp-server'],
    env: process.env as any,
  });

  mcpClient = new Client(
    {
      name: 'swiggy-agent-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  await mcpClient.connect(transport);
  return mcpClient;
}

// Helper to convert JSON Schema from MCP to Zod (simplified for this use case)
// Since a robust JSON schema to Zod converter is complex, we use `z.any()` or `z.record(z.any())` as a fallback, 
// or implement a basic mapper if required. For maximum flexibility in AI SDK without a full converter:
function jsonSchemaToZod(schema: any): z.ZodType<any> {
  // In a real app we'd use `json-schema-to-zod`. 
  // Here we just accept any object that matches the MCP tool's expected input structure.
  return z.record(z.any());
}

export async function processGroupCart(group: Group): Promise<any> {
  const client = await getMcpClient();
  const { tools } = await client.listTools();

  // Convert MCP tools to Vercel AI tools
  const aiTools: Record<string, any> = {};
  
  for (const mcpTool of tools) {
    aiTools[mcpTool.name] = tool({
      description: mcpTool.description || `Tool: ${mcpTool.name}`,
      parameters: z.any() as any, // Using any for simplicity in mapping JSON Schema
      execute: async (args: any) => {
        console.log(`[Agent] Calling ${mcpTool.name}...`);
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: args,
        });
        return result.content;
      },
    });
  }

  const systemPrompt = `
You are a group food ordering assistant using the Swiggy Food MCP server.
Your task is to order food for a group of people based on their preferences.
You must:
1. Use get_addresses to find the address labeled "Office".
2. Use search_restaurants to find an open restaurant that fits everyone's needs.
3. Use search_menu to pick a dish for each person matching their spice level, cuisine, and dietary restrictions. Keep it under budget.
4. Use update_food_cart to add items to the Swiggy cart.
5. Use fetch_food_coupons and apply_food_coupon to apply the best COD discount.
6. Use get_food_cart to get the final cart state.

IMPORTANT: Do NOT use place_food_order. The human will confirm it later.
When you are done, your final response MUST be a valid JSON object matching this structure (and nothing else):
{
  "restaurantName": "Name of the restaurant",
  "totalCost": 727,
  "summary": "Short summary of what was ordered"
}

Group Details:
ID: ${group.id}
Total Budget: ₹${group.totalBudget}
Members:
${group.members.map(m => `- ${m.name}: ${m.dietaryRestrictions.join(', ')} | ${m.cuisinePreferences.join(', ')} | ${m.dishPreferences} | Spice: ${m.spiceLevel}`).join('\n')}
`;

  const messages: CoreMessage[] = [
    {
      role: 'user',
      content: 'Please build the Swiggy cart for this group and return the final breakdown.',
    }
  ];

  console.log(`\n🤖 Building cart for Group ${group.id} (${group.members.length} people)...`);
  
  const result = await generateText({
    model: anthropic('claude-3-5-sonnet-20240620'),
    system: systemPrompt,
    messages,
    tools: aiTools,
    maxSteps: 15, // Allow multiple tool calls
  });

  return {
    groupId: group.id,
    breakdown: result.text,
  };
}

export async function placeGroupOrder() {
  const client = await getMcpClient();
  console.log('[Agent] Placing order...');
  const result = await client.callTool({
    name: 'place_food_order',
    arguments: { paymentMethod: 'COD' }
  });
  return result.content;
}
