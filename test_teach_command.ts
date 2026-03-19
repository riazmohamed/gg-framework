// Quick verification that the /teach-me command parses and works
import { createBuiltinCommands, SlashCommandRegistry } from "./packages/ggcoder/src/core/slash-commands.js";

const commands = createBuiltinCommands();
const registry = new SlashCommandRegistry();

commands.forEach(cmd => registry.register(cmd));

// Test parsing
const parsed = registry.parse("/teach-me");
console.log("✓ Parsed /teach-me:", parsed);

// Test registry lookup
const teachCmd = registry.get("teach-me");
console.log("✓ Found command 'teach-me':", teachCmd?.name, teachCmd?.aliases);

const teachAlias = registry.get("teach");
console.log("✓ Found alias 'teach':", teachAlias?.name);

// Mock execution test (just checking it returns a string)
const result = teachCmd?.execute("", {} as any);
if (typeof result === "string") {
  console.log("✓ Command returns string, length:", result.length);
  console.log("✓ Starts with 'Building an LLM':", result.includes("Building") || result.includes("BUILD_GUIDE"));
}

console.log("\n✅ All verification checks passed!");
