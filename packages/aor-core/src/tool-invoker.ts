/** Request to invoke an OpenBot plugin/core tool via the public `/tools/invoke` HTTP API. */
export interface ToolInvokeRequest {
  tool: string;
  args?: Record<string, unknown>;
  action?: string;
  sessionKey?: string;
  /** Canonical operation identity; receiver must authorize and durably enforce it. */
  operationIdentity?: {
    tenantId: string;
    taskId: string;
    executionId: string;
    stepId: string;
    operationId: string;
  };
}

export interface ToolInvokeResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Port for Lobster + plugin tool execution. Implemented by the OpenBot backend
 * adapter; skills call this instead of importing OpenBot internals.
 */
export interface ToolInvoker {
  invoke(req: ToolInvokeRequest): Promise<ToolInvokeResult>;
}
