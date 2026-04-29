import type { HostName } from "../../types.js";
import { detectHost } from "./detect.js";
import { NoneAdapter } from "./none/adapter.js";
import { PremiereAdapter } from "./premiere/adapter.js";
import { ResolveAdapter } from "./resolve/adapter.js";
import type { VideoHost } from "./types.js";

export { detectHost } from "./detect.js";
export { HostUnreachableError, HostUnsupportedError } from "./types.js";
export type { VideoHost } from "./types.js";
export { NoneAdapter } from "./none/adapter.js";
export { PremiereAdapter } from "./premiere/adapter.js";
export { ResolveAdapter } from "./resolve/adapter.js";

/**
 * Resolve a host adapter from an explicit name, or auto-detect if undefined.
 */
export function createHost(forced?: HostName): VideoHost {
  if (forced === "resolve") return new ResolveAdapter();
  if (forced === "premiere") return new PremiereAdapter();
  if (forced === "none") return new NoneAdapter();

  const detected = detectHost();
  switch (detected.name) {
    case "resolve":
      return new ResolveAdapter();
    case "premiere":
      return new PremiereAdapter();
    default:
      return new NoneAdapter();
  }
}
