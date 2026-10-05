// Moved to @abukhaled/gg-core. This shim re-exports it so existing relative
// imports (`./thinking-level.js`) keep resolving unchanged.
export {
  getSupportedThinkingLevels,
  getLowestThinkingLevel,
  isThinkingLevelSupported,
  getNextThinkingLevel,
  clampThinkingForPlanMode,
} from "@abukhaled/gg-core";
