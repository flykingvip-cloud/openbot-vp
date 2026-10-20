/**
 * Node-only file reader for the completion ledger.
 *
 * Kept out of the package index on purpose: the index is imported by the
 * browser Control UI, and `node:fs` cannot be bundled there.
 */
import { readFileSync } from "node:fs";
import {
  createMemoryCompletionLedger,
  type CompletionLedgerFile,
  type CompletionLedgerReader,
} from "./completion-ledger.js";

export function createFileCompletionLedger(filePath: string): CompletionLedgerReader {
  return {
    read(query) {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as CompletionLedgerFile;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) {
        return {
          proposal: null,
          experiment: null,
          application: null,
          verification: null,
          recheck: null,
          recheckRecordedAt: null,
          events: [],
          duplicate: false,
        };
      }
      return createMemoryCompletionLedger(parsed.records).read(query);
    },
  };
}
