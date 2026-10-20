/**
 * site_list / site_describe / site_invoke.
 *
 * The principal is the server turn identity. Model arguments cannot replace it.
 * Seeing these tools is not authorization for a capability or an account.
 */

import { Type } from "@sinclair/typebox";
import type { ExecutionIdentityContext } from "../../gateway/execution-identity-context.js";
import {
  getDefaultSiteCapabilityRuntime,
  type SiteCapabilityRuntime,
} from "../../site-capability/runtime.js";
import type { ServerPrincipal } from "../../site-capability/session-handle.js";
import { accountComputerObserverUserId } from "../sandbox/account-scope.js";
import { jsonResult, readStringParam, type AnyAgentTool } from "./common.js";

const IDENTITY_KEYS = [
  "tenantId",
  "userId",
  "principal",
  "platformUserId",
  "enterpriseId",
  "subject",
] as const;

const SiteListSchema = Type.Object({
  cursor: Type.Optional(Type.String({ description: "Opaque page cursor from a previous list." })),
  limit: Type.Optional(Type.Number({ description: "Page size from 1 to 50. Default 20." })),
});

const SiteDescribeSchema = Type.Object({
  capabilityId: Type.String({ description: "Site capability id from site_list." }),
  version: Type.Optional(
    Type.String({ description: "Fixed version. Omit to describe the granted version." }),
  ),
});

const SiteInvokeSchema = Type.Object({
  capabilityId: Type.String({ description: "Site capability id." }),
  version: Type.String({
    description: "Fixed capability version. Required. Do not omit to float latest.",
  }),
  args: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: "Declarative arguments declared by site_describe. Not a script.",
    }),
  ),
  accountBindingId: Type.Optional(
    Type.String({
      description:
        "Optional account binding id when the caller has more than one authorized binding.",
    }),
  ),
});

export type SiteCapabilityToolOptions = {
  runtime?: SiteCapabilityRuntime;
  tenantId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientPlatformUserId?: string;
  executionIdentity?: ExecutionIdentityContext;
};

export function resolveSiteToolPrincipal(
  options?: SiteCapabilityToolOptions,
): ServerPrincipal | null {
  const tenantId =
    options?.tenantId?.trim() ||
    options?.gatewayClientSessionEnterpriseId?.trim() ||
    options?.executionIdentity?.enterpriseId?.trim() ||
    "";
  const userId =
    accountComputerObserverUserId(options?.gatewayClientPlatformUserId) ||
    accountComputerObserverUserId(options?.executionIdentity?.platformUserId) ||
    "";
  if (
    !tenantId ||
    !userId ||
    tenantId.includes(":") ||
    tenantId.includes("/") ||
    userId.includes(":") ||
    userId.includes("/")
  ) {
    return null;
  }
  return { tenantId, userId };
}

function stripIdentity(params: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...params };
  for (const key of IDENTITY_KEYS) {
    delete next[key];
  }
  const args = next.args;
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const nested: Record<string, unknown> = { ...(args as Record<string, unknown>) };
    for (const key of IDENTITY_KEYS) {
      delete nested[key];
    }
    next.args = nested;
  }
  return next;
}

function asParams(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return stripIdentity(args as Record<string, unknown>);
  }
  return {};
}

export function createSiteCapabilityTools(options?: SiteCapabilityToolOptions): AnyAgentTool[] {
  const runtime = () => options?.runtime ?? getDefaultSiteCapabilityRuntime();
  const principal = () => resolveSiteToolPrincipal(options);

  const listTool: AnyAgentTool = {
    name: "site_list",
    label: "Site List",
    description:
      "List site capabilities the signed-in server principal may use. Results are summaries only. Another account's packages are omitted. This tool does not grant invoke.",
    parameters: SiteListSchema,
    execute: async (_toolCallId, args) => {
      const who = principal();
      if (!who) {
        return jsonResult({
          ok: false,
          code: "IDENTITY_REQUIRED",
          message: "server principal is required",
          items: [],
          nextCursor: null,
        });
      }
      const params = asParams(args);
      const cursor = readStringParam(params, "cursor");
      const limit = typeof params.limit === "number" ? params.limit : undefined;
      return jsonResult(runtime().list(who, { cursor, limit }));
    },
  };

  const describeTool: AnyAgentTool = {
    name: "site_describe",
    label: "Site Describe",
    description:
      "Describe one authorized site capability: schemas, account requirements, effect, availability, and version. Does not return credentials, CDP endpoints, profiles, or internal scripts.",
    parameters: SiteDescribeSchema,
    execute: async (_toolCallId, args) => {
      const who = principal();
      if (!who) {
        return jsonResult({
          ok: false,
          code: "IDENTITY_REQUIRED",
          message: "server principal is required",
        });
      }
      const params = asParams(args);
      const capabilityId = readStringParam(params, "capabilityId", { required: true });
      const version = readStringParam(params, "version");
      return jsonResult(runtime().describe(who, capabilityId, version));
    },
  };

  const invokeTool: AnyAgentTool = {
    name: "site_invoke",
    label: "Site Invoke",
    description:
      "Run one fixed version of a site capability with declarative arguments. Pass capabilityId and version from site_describe. Do not send scripts, credentials, or a different user id. Eligibility is checked for this call.",
    parameters: SiteInvokeSchema,
    execute: async (_toolCallId, args) => {
      const who = principal();
      if (!who) {
        return jsonResult({
          ok: false,
          code: "IDENTITY_REQUIRED",
          message: "server principal is required",
          status: "failed",
          repair: "none",
        });
      }
      const params = asParams(args);
      const capabilityId = readStringParam(params, "capabilityId");
      const version = readStringParam(params, "version");
      const accountBindingId = readStringParam(params, "accountBindingId");
      return jsonResult(
        await runtime().invoke(who, {
          capabilityId,
          version,
          args: params.args,
          accountBindingId,
        }),
      );
    },
  };

  return [listTool, describeTool, invokeTool];
}
