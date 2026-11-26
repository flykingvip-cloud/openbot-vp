import {
  createUnifiedExecutionLifecycle,
  type SupervisorWorkItemAdmission,
  type SupervisorWorkItemLifecyclePorts,
} from "./unified-lifecycle.js";

export type { SupervisorWorkItemAdmission, SupervisorWorkItemLifecyclePorts };

/** @deprecated Use `createUnifiedExecutionLifecycle({ mode: "work_item", ports })`. */
export function createSupervisorWorkItemLifecycle(ports: SupervisorWorkItemLifecyclePorts) {
  return createUnifiedExecutionLifecycle({ mode: "work_item", ports });
}
