/** Data only. Metadata never grants permissions or provides executable configuration. */
export type CapabilityDeclaration = {
  id: string;
  permission: { ownerOnly: boolean; authority: "existing-tool-policy" };
  sideEffect: "read" | "workspace_write" | "external" | "arbitrary" | "unknown";
  cancellation: "signal_forwarded";
  completion: "tool_result";
  idempotency: "not_declared";
  automaticRetry: false;
};
