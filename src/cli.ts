import { parseCSV, groupMembers } from './parser.js';
import { processGroupCart, placeGroupOrder } from './agent.js';
import { confirm, input } from '@inquirer/prompts';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

async function main() {
  console.log('🍕 Welcome to swiggy-agent-mcp!');
  console.log('Automating your team lunches one order at a time.\n');

  const csvPath = await input({
    message: 'Enter the path to your team preferences CSV file:',
    default: './preferences.csv',
  });

  console.log(`\n📄 Parsing ${csvPath}...`);
  let members;
  try {
    members = await parseCSV(path.resolve(process.cwd(), csvPath));
    console.log(`Found ${members.length} team members.`);
  } catch (error: any) {
    console.error(`Failed to parse CSV: ${error.message}`);
    process.exit(1);
  }

  const groups = groupMembers(members);
  console.log(`Divided into ${groups.length} sub-groups based on budget.\n`);

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    
    // Process the cart using the Agent
    const result = await processGroupCart(group);
    
    let parsedResult;
    try {
      // The AI should return a JSON block
      const jsonMatch = result.breakdown.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResult = JSON.parse(jsonMatch[0]);
      } else {
        parsedResult = JSON.parse(result.breakdown);
      }
    } catch (e) {
      console.warn('Could not parse AI response as JSON. Raw response:');
      console.log(result.breakdown);
      parsedResult = { restaurantName: 'Unknown', totalCost: 0, summary: result.breakdown };
    }

    console.log('\n=======================================');
    console.log(`🛒 Cart for Group ${group.id}`);
    console.log(`Restaurant: ${parsedResult.restaurantName}`);
    console.log(`Summary: ${parsedResult.summary}`);
    console.log(`Total Cost: ₹${parsedResult.totalCost}`);
    console.log('=======================================\n');

    const shouldPlaceOrder = await confirm({
      message: `Place order ${group.id}/${groups.length} from ${parsedResult.restaurantName} (₹${parsedResult.totalCost})?`,
      default: false,
    });

    if (shouldPlaceOrder) {
      const orderDetails = await placeGroupOrder();
      console.log(`✅ Order Placed successfully!`);
      console.log(`Order Details:`, JSON.stringify(orderDetails, null, 2));
    } else {
      console.log(`❌ Skipped order for Group ${group.id}.`);
    }
  }

  console.log('\n🎉 All done! Enjoy your team lunch!');
  process.exit(0);
}

main().catch(console.error);
