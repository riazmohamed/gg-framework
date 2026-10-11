import {
  discoverLocalModels,
  formatLocalModelId,
  toModelInfo,
  type LocalEndpoint,
  type LocalEndpointProbe,
} from "@abukhaled/gg-core";
import { listAllEndpoints, syncEndpointCredentials } from "./local-endpoint-store.js";
import { clearRuntimeModels, registerRuntimeModels } from "./model-registry.js";

/**
 * Probe every local endpoint (built-in + user-added), give each one that
 * answered a credential, and replace the `local` runtime models with what the
 * servers serve now. Shared by the desktop sidecar and the `ogcoder` CLI.
 *
 * `adjust` rewrites each probe before its models are registered; the sidecar
 * uses it to pin the context Ollama actually served a model with.
 */
export async function scanLocalModels(
  force: boolean,
  adjust: (probe: LocalEndpointProbe) => LocalEndpointProbe = (probe) => probe,
): Promise<LocalEndpointProbe[]> {
  const endpoints = await listAllEndpoints();
  const discovered = await discoverLocalModels(endpoints, { force });
  const probes = discovered.probes.map(adjust);
  const models = probes.flatMap((probe) =>
    probe.models.map((model) => toModelInfo(model, probe.endpoint)),
  );
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
    contextLength?: number;
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
      ...(probe.endpoint.contextLength ? { contextLength: probe.endpoint.contextLength } : {}),
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
