import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  console.log('Sending "hii" to the LLM...');
  
  try {
    const { text } = await generateText({
      model: anthropic(process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'),
      prompt: 'hii',
    });
    
    console.log('\n🤖 LLM Response:');
    console.log(text);
  } catch (error) {
    console.error('\n❌ Error invoking LLM:', error);
  }
}

main();
