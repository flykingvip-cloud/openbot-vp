import { resolveBillingScope } from "../billing/scope.js";
import { projectCapabilityCenterInstall } from "../enterprise-data/capability-center-install.js";
import { listSarValidationRecordsForInstall } from "../enterprise-data/sar-validation-records.js";
import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import {
  buildDataAssetLinkage,
  registerCallerAccountBinding,
  resolveOwnedAssetLinks,
  resolveWebsiteAccessChoice,
  summarizeDataAssetLinkage,
} from "../enterprise-data/data-asset-linkage.js";
import { requireResolvedEnterpriseAdminTenantId } from "../enterprise-data/enterprise-data-seat-context.js";
import type { EnterpriseDataStore } from "../enterprise-data/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { readSarExecutionPin } from "../skill-execution-binding/sar-pin.js";
import {
  getSkillRuntimeDefinitionForBinding,
  SkillAssetStoreError,
  type SkillLifecycleState,
  type SkillVisibility,
} from "../skill-lifecycle-store.js";
import { respondInvalid, stringValue } from "./billing-helpers.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

type WithStoreRunner = <T>(
  tenantId: string,
  client: GatewayClient | null | undefined,
  run: (store: EnterpriseDataStore) => Promise<T> | T,
) => Promise<T>;

function toEnterpriseDataErrorShape(error: unknown) {
  if (error instanceof EnterpriseDataStoreError) {
    return errorShape(ErrorCodes.INVALID_REQUEST, error.message, { details: { code: error.code } });
  }
  if (error instanceof Error) {
    return errorShape(ErrorCodes.INVALID_REQUEST, error.message);
  }
  return errorShape(ErrorCodes.INVALID_REQUEST, "Enterprise data operation failed.");
}

async function callerUserId(
  client: GatewayClient | null | undefined,
  tenantId: string,
): Promise<string | null> {
  const scope = await resolveBillingScope(client ?? null, { requestedTenantId: tenantId });
  return scope.user?.id?.trim() || null;
}

export function createEnterpriseDataAssetHandlers(
  withEnterpriseDataStore: WithStoreRunner,
): GatewayRequestHandlers {
  return {
    "enterprise-data.assets.linkage": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const userId = await callerUserId(client, tenantId);
        const payload = await withEnterpriseDataStore(tenantId, client, (store) => {
          const items = buildDataAssetLinkage({
            store,
            tenantId,
            callerUserId: userId,
            nowIso: new Date().toISOString(),
            sourceId: stringValue(params.sourceId) || undefined,
          });
          return { items, stats: summarizeDataAssetLinkage(items) };
        });
        respond(true, { tenantId, ...payload });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.assets.website-access.candidates": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const userId = await callerUserId(client, tenantId);
        const choice = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveWebsiteAccessChoice({
            store,
            caller: userId ? { tenantId, userId } : null,
          }),
        );
        respond(true, {
          tenantId,
          outcome: choice.outcome,
          selectable: choice.selectable,
        });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.assets.website-access.register": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const bindingId = stringValue(params.bindingId);
      if (!bindingId) {
        respondInvalid(respond, "bindingId is required");
        return;
      }
      try {
        const userId = await callerUserId(client, tenantId);
        if (!userId) {
          throw new EnterpriseDataStoreError(
            "OWNER_IDENTITY_REQUIRED",
            "账户所有者身份缺失，不能登记私人授权。",
          );
        }
        const binding = await withEnterpriseDataStore(tenantId, client, (store) =>
          registerCallerAccountBinding({
            store,
            caller: { tenantId, userId },
            bindingId,
          }),
        );
        respond(true, { tenantId, binding });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.assets.owned-link": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const capabilityId = stringValue(params.capabilityId);
      if (!capabilityId) {
        respondInvalid(respond, "capabilityId is required");
        return;
      }
      try {
        const links = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveOwnedAssetLinks({ store, tenantId, capabilityId }),
        );
        respond(true, { tenantId, links });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.assets.capability-install": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const skillId = stringValue(params.skillId) || stringValue(params.capabilityId);
      if (!skillId) {
        respondInvalid(respond, "skillId is required");
        return;
      }
      const agentId = stringValue(params.agentId) || "";
      try {
        const userId = await callerUserId(client, tenantId);
        const facts = await withEnterpriseDataStore(tenantId, client, (store) => {
          const pin = agentId ? readSarExecutionPin({ agentId, skillId }) : null;
          let lifecycle: SkillLifecycleState = "draft";
          let visibility: SkillVisibility = "private";
          let dependencies: string[] = [];
          let catalogVersion: string | null = null;
          try {
            const head = getSkillRuntimeDefinitionForBinding(skillId);
            catalogVersion = head.version;
            const viewed = pin?.artifactDigest
              ? getSkillRuntimeDefinitionForBinding(skillId, { version: pin.installedVersion })
              : head;
            lifecycle = viewed.lifecycle;
            visibility = viewed.profile.visibility;
            dependencies = viewed.runtimeDefinition.dependencies;
          } catch (error) {
            if (!(error instanceof SkillAssetStoreError)) {
              throw error;
            }
          }
          const executableLifecycle =
            lifecycle === "private" ||
            lifecycle === "reviewing" ||
            lifecycle === "approved" ||
            lifecycle === "published";
          const nowIso = new Date().toISOString();
          return projectCapabilityCenterInstall({
            store,
            tenantId,
            callerUserId: userId,
            skill: { skillId, lifecycle, visibility, dependencies },
            pin,
            skillAuthorized: Boolean(pin?.enabled) && executableLifecycle,
            validationRecords: listSarValidationRecordsForInstall({
              store,
              tenantId,
              nowIso,
            }),
            catalog: catalogVersion ? { version: catalogVersion } : null,
          });
        });
        respond(true, { tenantId, facts });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },
  };
}
