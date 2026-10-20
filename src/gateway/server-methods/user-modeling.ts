import { loadConfig } from "../../config/config.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { resolveAuthoritativeMembership } from "../tenant-context.js";
import { DEFAULT_USER_PROFILE } from "../user-modeling/types.js";
import { hashUserKey, resolveUserModelingKeyForClient } from "../user-modeling/user-key.js";
import {
  readUserProfileByHash,
  readUserProfileOrDefault,
  resetUserProfile,
  resetUserProfileByHash,
} from "../user-modeling/user-profile-store.js";
import type { GatewayRequestHandlers } from "./types.js";

function sanitizeProfileResponse(profile: typeof DEFAULT_USER_PROFILE) {
  return {
    preferredReplyLanguage: profile.preferredReplyLanguage ?? null,
    preferredOutputFormat: profile.preferredOutputFormat,
    preferredTone: profile.preferredTone,
    confirmationPreference: profile.confirmationPreference,
    verbosity: profile.verbosity,
    observations: profile.observations,
  };
}

async function resolveSelfKey(client: Parameters<GatewayRequestHandlers[string]>[0]["client"]) {
  const cfg = loadConfig();
  return resolveUserModelingKeyForClient(client, cfg);
}

export const userModelingHandlers: GatewayRequestHandlers = {
  "user-modeling.get-profile": async ({ respond, client }) => {
    const key = await resolveSelfKey(client);
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "user identity required"));
      return;
    }
    const cfg = loadConfig();
    const profile = await readUserProfileOrDefault(cfg, key);
    respond(true, {
      userKeyHash: hashUserKey(key),
      tenantId: key.tenantId,
      profile: sanitizeProfileResponse(profile),
    });
  },

  "user-modeling.reset-profile": async ({ respond, client }) => {
    const key = await resolveSelfKey(client);
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "user identity required"));
      return;
    }
    const cfg = loadConfig();
    await resetUserProfile(cfg, key);
    respond(true, { ok: true, userKeyHash: hashUserKey(key) });
  },

  "user-modeling.admin.get-profile": async ({ respond, client, params }) => {
    const userKeyHash = typeof params.userKeyHash === "string" ? params.userKeyHash.trim() : "";
    if (!userKeyHash) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "userKeyHash is required"));
      return;
    }
    const domain = client?.sessionDomain;
    if (domain !== "enterprise" && domain !== "employee") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "enterprise session required"),
      );
      return;
    }
    const { tenantId } = await resolveAuthoritativeMembership(client);
    if (!tenantId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenant membership required"),
      );
      return;
    }
    const cfg = loadConfig();
    const stored = await readUserProfileByHash(cfg, tenantId, userKeyHash);
    const profile = stored ? { ...DEFAULT_USER_PROFILE, ...stored } : { ...DEFAULT_USER_PROFILE };
    respond(true, {
      userKeyHash,
      tenantId,
      profile: sanitizeProfileResponse(profile),
    });
  },

  "user-modeling.admin.reset-profile": async ({ respond, client, params }) => {
    const userKeyHash = typeof params.userKeyHash === "string" ? params.userKeyHash.trim() : "";
    if (!userKeyHash) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "userKeyHash is required"));
      return;
    }
    const domain = client?.sessionDomain;
    if (domain !== "enterprise" && domain !== "employee") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "enterprise session required"),
      );
      return;
    }
    const { tenantId } = await resolveAuthoritativeMembership(client);
    if (!tenantId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "tenant membership required"),
      );
      return;
    }
    const cfg = loadConfig();
    await resetUserProfileByHash(cfg, tenantId, userKeyHash);
    respond(true, { ok: true, userKeyHash, tenantId });
  },
};
