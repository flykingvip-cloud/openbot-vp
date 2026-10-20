import type { WorkspaceBindingRecord } from "../workspace-resolver/types.js";
import { isCutoverSourceWriteBlocked, resolveCutoverWritableBindingId } from "./state-machine.js";
import type { WorkspaceCutoverOperation } from "./types.js";

export type CutoverWriteGuardResult =
  | { ok: true; bindingId: string }
  | {
      ok: false;
      reason: "no_writable_binding" | "binding_not_writable" | "dual_writable_canonical";
    };

/** Reject catalogs where two canonical bindings are simultaneously active-writable. */
export function assertSingleWritableCanonicalBinding(
  bindings: WorkspaceBindingRecord[],
  resourceId: string,
): CutoverWriteGuardResult | { ok: true; bindingId: null } {
  const canonical = bindings.filter(
    (binding) =>
      binding.resourceId === resourceId &&
      binding.role === "canonical" &&
      binding.state === "active",
  );
  if (canonical.length <= 1) {
    return { ok: true, bindingId: canonical[0]?.bindingId ?? null };
  }
  return { ok: false, reason: "dual_writable_canonical" };
}

export function gateCutoverWrite(params: {
  operation: WorkspaceCutoverOperation;
  bindingId: string;
}): CutoverWriteGuardResult {
  const allowed = resolveCutoverWritableBindingId(params.operation);
  if (!allowed) {
    return { ok: false, reason: "no_writable_binding" };
  }
  if (allowed !== params.bindingId) {
    return { ok: false, reason: "binding_not_writable" };
  }
  if (
    isCutoverSourceWriteBlocked(params.operation) &&
    params.bindingId === params.operation.sourceBindingId
  ) {
    return { ok: false, reason: "binding_not_writable" };
  }
  return { ok: true, bindingId: allowed };
}
