import {
  discoverLocalModels,
  formatLocalModelId,
  type LocalEndpoint,
  type LocalEndpointProbe,
} from "@abukhaled/gg-core";
import { listAllEndpoints, syncEndpointCredentials } from "./local-endpoint-store.js";
import { clearRuntimeModels, registerRuntimeModels } from "./model-registry.js";

/**
 * Probe every local endpoint (built-in + user-added), give each one that
 * answered a credential, and replace the `local` runtime models with what the
 * servers serve now. Shared by the desktop sidecar and the `ogcoder` CLI.
 */
export async function scanLocalModels(force: boolean): Promise<LocalEndpointProbe[]> {
  const endpoints = await listAllEndpoints();
  const { probes, models } = await discoverLocalModels(endpoints, { force });
  // Only endpoints that answered get a credential: writing one for a server
  // that isn't running would make `hasProviderAuth("local")` true forever.
  await syncEndpointCredentials(
    probes.filter((probe) => probe.reachable).map((probe) => probe.endpoint),
  );
  clearRuntimeModels((m) => m.provider === "local");
  registerRuntimeModels(models);
  return probes;
}

export interface LocalStatePayload {
  endpoints: {
    id: string;
    label: string;
    baseUrl: string;
    kind: LocalEndpoint["kind"];
    custom: boolean;
    reachable: boolean;
    reason?: string;
    models: {
      id: string;
      rawId: string;
      contextWindow: number;
      contextWindowKnown: boolean;
      supportsTools: boolean;
      supportsImages: boolean;
      supportsThinking: boolean;
      loaded?: boolean;
    }[];
  }[];
}

/** Endpoint rows + models, in the shape the Local models UI renders. */
export function localStatePayload(probes: readonly LocalEndpointProbe[]): LocalStatePayload {
  return {
    endpoints: probes.map((probe) => ({
      id: probe.endpoint.id,
      label: probe.endpoint.label,
      baseUrl: probe.endpoint.baseUrl,
      kind: probe.endpoint.kind,
      custom: probe.endpoint.custom === true,
      reachable: probe.reachable,
      ...(probe.reason ? { reason: probe.reason } : {}),
      models: probe.models.map((m) => ({
        id: formatLocalModelId(probe.endpoint.id, m.rawId),
        rawId: m.rawId,
        contextWindow: m.contextWindow,
        contextWindowKnown: m.contextWindowKnown,
        supportsTools: m.supportsTools,
        supportsImages: m.supportsImages,
        supportsThinking: m.supportsThinking,
        ...(m.loaded === undefined ? {} : { loaded: m.loaded }),
      })),
    })),
  };
}
