# Swiggy Auto-Order Agent 🍔🤖

A fully autonomous CLI agent that coordinates group food orders using the Vercel AI SDK and the official Swiggy Food MCP Server. 

Instead of manually asking everyone what they want, checking their dietary restrictions, calculating the budget, and painstakingly adding items to the cart, this agent does it all for you. You just provide a CSV of what your team wants, and the AI handles the rest!

## Features

- **Smart Preference Parsing:** Reads your team's food cravings, spice tolerances, and dietary restrictions.
- **Intelligent Budgeting:** Automatically splits large teams into smaller sub-groups so you never hit max cart limits.
- **AI Cart Building:** Uses Claude 3.5 Sonnet to search for open restaurants, pick the perfect dishes for everyone, and apply the best COD coupons.
- **Interactive CLI:** Reviews the AI's plan with you in the terminal before placing the actual order via Swiggy.

## Setup Guide

1. **Install the dependencies:**
   ```bash
   npm install
   ```

2. **Configure your environment:**
   Create a `.env` file in the root directory and add your Anthropic API key along with the MCP configuration:
   ```env
   ANTHROPIC_API_KEY=your-api-key-here
   SWIGGY_MCP_COMMAND=npx
   SWIGGY_MCP_ARGS=-y @swiggy/mcp-server
   ```

3. **Set up the preferences:**
   Edit the `preferences.csv` file with your team's names, dietary needs, and cravings.

## Usage

Start the interactive CLI:
```bash
npm start
```
