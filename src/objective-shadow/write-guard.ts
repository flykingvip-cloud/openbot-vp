/**
 * Forbidden-write probe. Shadow must never call these symbols.
 * Tests assert attempts stay 0 on the observe/log path.
 */

export const FORBIDDEN_WRITE_SYMBOLS = [
  "claimWorkUnit",
  "releaseWorkUnit",
  "upsertParticipation",
  "upsertActiveLeasePointer",
  "appendContribution",
  "writeLedger",
  "completeConversationTask",
] as const;

export type ForbiddenWriteSymbol = (typeof FORBIDDEN_WRITE_SYMBOLS)[number];

export type ForbiddenWriteGuard = {
  attempts: number;
  lastSymbol: string | null;
  record: (symbol: string) => void;
  reset: () => void;
};

export function createForbiddenWriteGuard(): ForbiddenWriteGuard {
  let attempts = 0;
  let lastSymbol: string | null = null;
  return {
    get attempts() {
      return attempts;
    },
    get lastSymbol() {
      return lastSymbol;
    },
    record(symbol) {
      attempts += 1;
      lastSymbol = symbol;
    },
    reset() {
      attempts = 0;
      lastSymbol = null;
    },
  };
}

const defaultGuard = createForbiddenWriteGuard();

export function getDefaultWriteGuard(): ForbiddenWriteGuard {
  return defaultGuard;
}
