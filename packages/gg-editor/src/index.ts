// Tools
export { createEditorTools } from "./tools/index.js";
export type { CreateEditorToolsOptions } from "./tools/index.js";

// Hosts
export {
  createHost,
  detectHost,
  HostUnreachableError,
  HostUnsupportedError,
  NoneAdapter,
  PremiereAdapter,
  ResolveAdapter,
} from "./core/hosts/index.js";
export type { VideoHost } from "./core/hosts/index.js";

// Media
export { checkFfmpeg, checkFfprobe, probeMedia, runFfmpeg } from "./core/media/ffmpeg.js";
export type { FfmpegResult, MediaProbe } from "./core/media/ffmpeg.js";

// System prompt
export { buildEditorSystemPrompt } from "./system-prompt.js";

// Auth (shared with ggcoder via ~/.gg/auth.json)
export {
  AuthStorage,
  AUTH_FILE,
  NotLoggedInError,
  generatePKCE,
  loginAnthropic,
  loginOpenAI,
  refreshAnthropicToken,
  refreshOpenAIToken,
  runLogin,
  runLogout,
  runStatus,
} from "./core/auth/index.js";
export type {
  OAuthCredentials,
  OAuthLoginCallbacks,
  SupportedAuthProvider,
} from "./core/auth/index.js";

// Types
export type {
  ClipInfo,
  EditorConfig,
  Frame,
  FrameRange,
  HostCapabilities,
  HostName,
  MarkerInfo,
  TimelineState,
} from "./types.js";
