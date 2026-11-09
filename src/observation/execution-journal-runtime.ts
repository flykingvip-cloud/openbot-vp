/** Best-effort bounded queue; execution never awaits durable projection writes. */
import path from "node:path";
import type { TrustedScope } from "../task-outcome/types.js";
import { CONFIG_DIR } from "../utils.js";
import type { ExecutionFact, VersionLinkReceipt } from "./execution-evidence-store.js";
import { createExecutionJournal } from "./execution-journal.js";
export const EXECUTION_JOURNAL_FLAG = "OPENBOT_EXECUTION_JOURNAL";
export function createExecutionJournalRuntime(options: {
  journal: ReturnType<typeof createExecutionJournal>;
  enabled?: () => boolean;
  queueCapacity?: number;
}) {
  const limit = options.queueCapacity ?? 1000;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("invalid_queue_capacity");
  }
  let pending = 0;
  let tail = Promise.resolve();
  let writeUnknown = false;
  const active = () => options.enabled?.() === true;
  const enqueue = (
    write: () => ReturnType<ReturnType<typeof createExecutionJournal>["appendFact"]>,
  ) => {
    try {
      if (!active()) {
        return false;
      }
      if (pending >= limit) {
        writeUnknown = true;
        return false;
      }
      pending++;
      tail = tail.then(async () => {
        try {
          if (!active()) {
            writeUnknown = true;
            return;
          }
          if (!(await write()).ok) {
            writeUnknown = true;
          }
        } catch {
          writeUnknown = true;
        } finally {
          pending--;
        }
      });
      return true;
    } catch {
      writeUnknown = true;
      return false;
    }
  };
  return {
    isEnabled: () => {
      try {
        return active();
      } catch {
        return false;
      }
    },
    recordFact(input: { agentId: string; fact: ExecutionFact }) {
      try {
        const copy = structuredClone(input);
        return enqueue(() => options.journal.appendFact(copy));
      } catch {
        writeUnknown = true;
        return false;
      }
    },
    recordLink(input: { agentId: string; receipt: VersionLinkReceipt }) {
      try {
        const copy = structuredClone(input);
        return enqueue(() => options.journal.appendLink(copy));
      } catch {
        writeUnknown = true;
        return false;
      }
    },
    async flush() {
      await tail;
    },
    async query(input: { agentId: string; scope: TrustedScope }) {
      try {
        if (!active()) {
          return { ok: false as const, state: "unknown" as const, reason: "journal_disabled" };
        }
        await tail;
        if (!active()) {
          return { ok: false as const, state: "unknown" as const, reason: "journal_disabled" };
        }
        if (writeUnknown) {
          return { ok: false as const, state: "unknown" as const, reason: "journal_write_unknown" };
        }
        return await options.journal.query(input);
      } catch {
        return { ok: false as const, state: "unknown" as const, reason: "journal_read_unknown" };
      }
    },
  };
}
let shared: ReturnType<typeof createExecutionJournalRuntime> | undefined;
export function getExecutionJournalRuntime() {
  if (!shared) {
    const enabled = () =>
      /^(1|true|yes|on)$/i.test(process.env[EXECUTION_JOURNAL_FLAG]?.trim() ?? "");
    shared = createExecutionJournalRuntime({
      journal: createExecutionJournal({
        rootDir: path.join(CONFIG_DIR, "observation", "execution-journal"),
        enabled,
      }),
      enabled,
    });
  }
  return shared;
}
