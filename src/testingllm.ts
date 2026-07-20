import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  console.log('Sending "hii" to the LLM...');
  
  try {
    const { text } = await generateText({
      model: anthropic('claude-haiku-4-5-20251001'),
      prompt: 'hii',
    });
    
    console.log('\n🤖 LLM Response:');
    console.log(text);
  } catch (error) {
    console.error('\n❌ Error invoking LLM:', error);
  }
}

main();
