/**
 * Node-side dispatch for the `local-files-readonly` profile.
 *
 * Sits between `handleInvoke` and the command handlers. Two things it guarantees:
 *
 * - Fail closed when the runtime was never configured. A node that has no pinned
 *   keyset and no redemption channel cannot verify anything, so it refuses rather
 *   than falling back to trusting the request (design 9.3).
 * - `fs.stat` has two authorization modes, selected by `capabilityType`. There is
 *   no `fs.resolve` command, because a general path-resolution endpoint is exactly
 *   the probing interface the design refuses to add (design 9.1 step 2, 9.7).
 */

import type { GatewayClient } from "../../gateway/client.js";
import type { NodeCapabilityKeyset } from "../../local-files/keyset.js";
import type { PathPolicyContext } from "../../local-files/path-policy.js";
import {
  LOCAL_FILES_OPAQUE_DENIAL,
  type LocalFilesOperation,
  type SignedCapability,
} from "../../local-files/types.js";
import type { RedemptionClient, RedemptionOutcome } from "./guard.js";
import {
  classifyHandlerFailure,
  handleArchiveList,
  handleArchiveReadEntry,
  handleFsList,
  handleFsRead,
  handleFsStat,
  handleFsStatResolve,
  type LocalFilesHandlerDeps,
} from "./handlers.js";

export type LocalFilesInvokeParams = {
  /** Authorization mode for `fs.stat`. Absent means an invocation capability. */
  capabilityType?: "resolve-ticket" | "invocation";
  capability?: SignedCapability;
  maxBytes?: number;
};

let runtime: LocalFilesHandlerDeps | null = null;

/** Install the runtime at node startup. Until then every command is refused. */
export function configureLocalFilesRuntime(deps: LocalFilesHandlerDeps): void {
  runtime = deps;
}

/** Test seam. */
export function resetLocalFilesRuntime(): void {
  runtime = null;
}

export function isLocalFilesRuntimeConfigured(): boolean {
  return runtime !== null;
}

/** A redemption client backed by a gateway RPC. */
export function createGatewayRedemptionClient(client: GatewayClient): RedemptionClient {
  return {
    async redeem({ capability, operation }): Promise<RedemptionOutcome> {
      try {
        // The whole capability is submitted, never a bare nonce: the gateway must
        // re-verify signature, binding, derivation and budget (design 9.3).
        const res = await client.request<{ ok?: boolean; reason?: string }>("localFiles.redeem", {
          capability,
          operation,
        });
        if (res?.ok === true) {
          return { ok: true };
        }
        return { ok: false, reason: res?.reason ?? "redemption-refused" };
      } catch (err) {
        // A redemption that cannot be completed is a refusal, not a pass.
        return { ok: false, reason: `redemption-unavailable:${String(err)}` };
      }
    },
  };
}

function parseParams(paramsJSON?: string | null): LocalFilesInvokeParams {
  if (!paramsJSON) {
    return {};
  }
  try {
    const parsed = JSON.parse(paramsJSON) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as LocalFilesInvokeParams;
  } catch {
    return {};
  }
}

export async function handleLocalFilesInvoke(params: {
  frame: { paramsJSON?: string | null };
  operation: LocalFilesOperation;
  sendJsonPayloadResult: (payload: unknown) => Promise<void>;
  sendErrorResult: (code: string, message: string) => Promise<void>;
}): Promise<void> {
  const deps = runtime;
  if (!deps) {
    await params.sendErrorResult("UNAVAILABLE", "local files runtime not configured");
    return;
  }

  const invokeParams = parseParams(params.frame.paramsJSON);
  const capability = invokeParams.capability;
  if (!capability) {
    // Uniform denial: the absence of a capability must not read differently from
    // a denied path.
    await params.sendErrorResult("PERMISSION_DENIED", LOCAL_FILES_OPAQUE_DENIAL);
    return;
  }

  const outcome = await dispatchOperation({
    deps,
    invokeParams,
    capability,
    operation: params.operation,
  });
  if (outcome.ok) {
    await params.sendJsonPayloadResult(outcome);
    return;
  }
  // `detail` stays on the node's audit trail; only the opaque message and a coarse
  // failure class go back. The class is a closed enum, so it cannot carry a path.
  await params.sendErrorResult(classifyHandlerFailure(outcome.detail), outcome.message);
}

async function dispatchOperation(args: {
  deps: LocalFilesHandlerDeps;
  invokeParams: LocalFilesInvokeParams;
  capability: SignedCapability;
  operation: LocalFilesOperation;
}): Promise<
  ({ ok: true } & Record<string, unknown>) | { ok: false; message: string; detail: string }
> {
  const { deps, invokeParams, capability, operation } = args;

  switch (operation) {
    case "fs.stat":
      return invokeParams.capabilityType === "resolve-ticket"
        ? await handleFsStatResolve({ ticket: capability, deps })
        : await handleFsStat({ capability, deps });
    case "fs.list":
      return await handleFsList({ capability, deps });
    case "fs.read":
      return await handleFsRead({ capability, deps, maxBytes: invokeParams.maxBytes });
    case "archive.list":
      return await handleArchiveList({ capability, deps });
    case "archive.readEntry":
      return await handleArchiveReadEntry({ capability, deps });
    default:
      return {
        ok: false,
        message: LOCAL_FILES_OPAQUE_DENIAL,
        detail: `dispatch:unknown-operation:${String(operation)}`,
      };
  }
}

export type { LocalFilesHandlerDeps, NodeCapabilityKeyset, PathPolicyContext };
