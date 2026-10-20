import type { LedgerInvariantId } from "./types.js";

const INVARIANT_IDS = new Set<LedgerInvariantId>(["I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8"]);

export type LedgerMetricsViolation = {
  id?: LedgerInvariantId;
  message: string;
  atMs: number;
  taskId?: string;
};

export type LedgerMetricsSnapshot = {
  writesAccepted: number;
  writesRejected: number;
  projectionViolations: number;
  violationsById: Record<LedgerInvariantId, number>;
  lastViolation: LedgerMetricsViolation | null;
};

export type LedgerMetrics = {
  snapshot: () => LedgerMetricsSnapshot;
  recordWriteAccepted: () => void;
  recordWriteRejected: (input: {
    message: string;
    id?: LedgerInvariantId;
    taskId?: string;
    atMs?: number;
  }) => void;
  recordProjectionViolation: (input: {
    id: LedgerInvariantId;
    message: string;
    taskId?: string;
    atMs?: number;
  }) => void;
  reset: () => void;
};

function emptyById(): Record<LedgerInvariantId, number> {
  return { I1: 0, I2: 0, I3: 0, I4: 0, I5: 0, I6: 0, I7: 0, I8: 0 };
}

export function createLedgerMetrics(): LedgerMetrics {
  let writesAccepted = 0;
  let writesRejected = 0;
  let projectionViolations = 0;
  let violationsById = emptyById();
  let lastViolation: LedgerMetricsViolation | null = null;

  const remember = (input: {
    id?: LedgerInvariantId;
    message: string;
    taskId?: string;
    atMs?: number;
  }) => {
    if (input.id && INVARIANT_IDS.has(input.id)) {
      violationsById[input.id] += 1;
    }
    lastViolation = {
      message: input.message,
      atMs: input.atMs ?? Date.now(),
      ...(input.id ? { id: input.id } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
    };
  };

  return {
    snapshot: () => ({
      writesAccepted,
      writesRejected,
      projectionViolations,
      violationsById: { ...violationsById },
      lastViolation: lastViolation ? { ...lastViolation } : null,
    }),
    recordWriteAccepted: () => {
      writesAccepted += 1;
    },
    recordWriteRejected: (input) => {
      writesRejected += 1;
      remember(input);
    },
    recordProjectionViolation: (input) => {
      projectionViolations += 1;
      remember(input);
    },
    reset: () => {
      writesAccepted = 0;
      writesRejected = 0;
      projectionViolations = 0;
      violationsById = emptyById();
      lastViolation = null;
    },
  };
}

const defaultMetrics = createLedgerMetrics();

export function getLedgerMetrics(): LedgerMetrics {
  return defaultMetrics;
}
