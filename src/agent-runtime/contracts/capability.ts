/** Data only. Metadata never grants permissions or provides executable configuration. */
export type CapabilityDeclaration = {
  id: string;
  executionKind:
    | "atomic"
    | "inference"
    | "delegated_workflow"
    | "lifecycle_adapter"
    | "unclassified";
  permission: { ownerOnly: boolean; authority: "existing-tool-policy" };
  sideEffect: "read" | "workspace_write" | "external" | "arbitrary" | "unknown";
  cancellation: { request: "unknown"; confirmation: "not_declared" };
  completion: { boundary: "tool_return"; taskAcceptance: false };
  recovery: { owner: "external_workflow" | "unknown"; token: "opaque_external" | "unknown" };
  idempotency: "not_declared";
  automaticRetry: false;
};
