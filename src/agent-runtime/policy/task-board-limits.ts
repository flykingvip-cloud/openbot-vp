/**
 * Session task board parked-task cardinality. Source-controlled, not an executable configuration.
 * Not an execution slot. `MAX_PARKED_SLOTS` in focus-policy is a different resource even when both are 3.
 */
export const MAX_PARKED_TASKS = 3;
export const TASK_BOARD_CONTINUE_MAX_PER_TASK = 3;
export const TASK_BOARD_CONTINUE_COOLDOWN_MS = 15 * 60 * 1000;
