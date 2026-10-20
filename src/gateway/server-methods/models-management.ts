import { loadConfig } from "../../config/config.js";
import { buildPlatformModelsAorStatus } from "../models/platform-models-aor-projection.js";
import { resolvePlatformModelsConfig } from "../models/platform-models-config.js";
import {
  loadPlatformModelsManagementSnapshot,
  loadPlatformModelsRoutingExplanations,
} from "../models/platform-models-snapshot.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsManagementAorStatusParams,
  validateModelsManagementRoutingExplanationsParams,
  validateModelsManagementSnapshotParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const modelsManagementHandlers: GatewayRequestHandlers = {
  "models.management.snapshot": async ({ params, respond, context }) => {
    if (!validateModelsManagementSnapshotParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.management.snapshot params: ${formatValidationErrors(validateModelsManagementSnapshotParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const cfg = loadConfig();
      const catalog = await context.loadGatewayModelCatalog();
      const enterpriseId =
        typeof params.enterpriseId === "string" ? params.enterpriseId.trim() : undefined;
      const snapshot = await loadPlatformModelsManagementSnapshot({
        cfg,
        catalog,
        enterpriseId: enterpriseId || undefined,
      });
      respond(true, snapshot, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "models.management.routing-explanations": async ({ params, respond, context }) => {
    if (!validateModelsManagementRoutingExplanationsParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.management.routing-explanations params: ${formatValidationErrors(validateModelsManagementRoutingExplanationsParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const cfg = loadConfig();
      await context.loadGatewayModelCatalog();
      const enterpriseId =
        typeof params.enterpriseId === "string" ? params.enterpriseId.trim() : undefined;
      const limit = typeof params.limit === "number" ? params.limit : undefined;
      const explanations = await loadPlatformModelsRoutingExplanations({
        cfg,
        enterpriseId: enterpriseId || undefined,
        limit,
      });
      respond(true, { explanations }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "models.management.aor-status": async ({ params, respond, context }) => {
    if (!validateModelsManagementAorStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.management.aor-status params: ${formatValidationErrors(validateModelsManagementAorStatusParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const cfg = loadConfig();
      const config = resolvePlatformModelsConfig(cfg);
      const catalog = await context.loadGatewayModelCatalog();
      const enterpriseId =
        typeof params.enterpriseId === "string" ? params.enterpriseId.trim() : undefined;
      const snapshot = await loadPlatformModelsManagementSnapshot({
        cfg,
        catalog,
        enterpriseId: enterpriseId || undefined,
      });
      const status = buildPlatformModelsAorStatus({ config, snapshot });
      respond(true, status, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
