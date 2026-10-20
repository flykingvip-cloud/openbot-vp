/**
 * Orchestration Plane — error types (P4.5).
 */

import type { OrchestrationInvariantId } from "./invariants.js";

export class OrchestrationInvariantError extends Error {
  readonly invariantId: OrchestrationInvariantId;

  constructor(id: OrchestrationInvariantId, message: string) {
    super(`${id}: ${message}`);
    this.name = "OrchestrationInvariantError";
    this.invariantId = id;
  }
}
