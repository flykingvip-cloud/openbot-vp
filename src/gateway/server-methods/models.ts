import { DEFAULT_PROVIDER } from "../../agents/defaults.js";
import { buildAllowedModelSet } from "../../agents/model-selection.js";
import { parseModelRef } from "../../agents/model-selection.js";
import { runAuthProbes } from "../../commands/models/list.probe.js";
import { loadConfig } from "../../config/config.js";
import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
} from "../../config/model-input.js";
import { recordModelProbeResults } from "../models/model-probe-store.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsListParams,
  validateModelsProbeParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)),
  );
}

function buildProbeInputs(catalog: Array<{ provider: string; id: string }>) {
  const cfg = loadConfig();
  const defaults = cfg.agents?.defaults;
  const configuredRefs = uniqueStrings([
    resolveAgentModelPrimaryValue(defaults?.model),
    ...resolveAgentModelFallbackValues(defaults?.model),
    resolveAgentModelPrimaryValue(defaults?.imageModel),
    ...resolveAgentModelFallbackValues(defaults?.imageModel),
    ...Object.keys(cfg.agents?.defaults?.models ?? {}),
  ]);
  const providers = uniqueStrings([
    ...Object.keys(cfg.models?.providers ?? {}),
    ...catalog.map((entry) => entry.provider),
    ...configuredRefs.map((entry) => parseModelRef(entry, DEFAULT_PROVIDER)?.provider ?? null),
  ]).toSorted((a, b) => a.localeCompare(b));
  const modelCandidates = uniqueStrings([
    ...configuredRefs.map((entry) => {
      const parsed = parseModelRef(entry, DEFAULT_PROVIDER);
      return parsed ? `${parsed.provider}/${parsed.model}` : null;
    }),
    ...catalog.map((entry) => `${entry.provider}/${entry.id}`),
  ]);
  return { cfg, providers, modelCandidates };
}

export const modelsHandlers: GatewayRequestHandlers = {
  "models.list": async ({ params, respond, context }) => {
    if (!validateModelsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const catalog = await context.loadGatewayModelCatalog();
      const cfg = loadConfig();
      const { allowedCatalog } = buildAllowedModelSet({
        cfg,
        catalog,
        defaultProvider: DEFAULT_PROVIDER,
      });
      const models = allowedCatalog.length > 0 ? allowedCatalog : catalog;
      respond(true, { models }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.probe": async ({ params, respond, context }) => {
    if (!validateModelsProbeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.probe params: ${formatValidationErrors(validateModelsProbeParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const catalog = await context.loadGatewayModelCatalog();
      const { cfg, providers, modelCandidates } = buildProbeInputs(catalog);
      const summary = await runAuthProbes({
        cfg,
        providers,
        modelCandidates,
        options: {
          provider: typeof params.provider === "string" ? params.provider : undefined,
          modelRef: typeof params.modelRef === "string" ? params.modelRef : undefined,
          timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : 8000,
          concurrency: typeof params.concurrency === "number" ? params.concurrency : 2,
          maxTokens: typeof params.maxTokens === "number" ? params.maxTokens : 8,
        },
      });
      try {
        await recordModelProbeResults(summary);
      } catch {
        // The operator still receives this probe. A later snapshot read retries the store.
      }
      respond(true, summary, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
