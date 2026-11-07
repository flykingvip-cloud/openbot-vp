/**
 * Isolation-only child for the two-process command race.
 * No gateway, no network, no production state.
 */
import fs from "node:fs";
import { TaskOutcomeResultService } from "../task-outcome/result-service.js";
import { DurableTaskOutcomeStore } from "../task-outcome/store.js";
import type { TrustedScope } from "../task-outcome/types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:evidence",
  subjectRef: "user:evidence",
  authzScopeRef: "scope:isolation",
};

const [root, taskId, commandId, outFile] = process.argv.slice(2);

function write(value: unknown): void {
  fs.writeFileSync(outFile, `${JSON.stringify(value)}\n`);
}

try {
  if (!root || !taskId || !commandId || !outFile) {
    throw new Error("usage: command-race-child <root> <taskId> <commandId> <outFile>");
  }
  const store = new DurableTaskOutcomeStore(root);
  const service = new TaskOutcomeResultService({ store, submittedBy: "race-child" });
  const result = service.submit(
    taskId,
    { type: "create", entrypoint: "chat", scope, taskContractVersion: "ctr-race" },
    { commandId, requiredScope: scope },
  );
  if (!result.ok || !result.commandReceipt) {
    write({
      ok: false,
      code: result.ok ? "missing_receipt" : result.code,
    });
    process.exit(1);
  }
  write({
    ok: true,
    disposition: result.commandReceipt.disposition,
    commitId: result.commandReceipt.commitId,
    outcomeVersion: result.commandReceipt.outcomeVersion,
  });
  store.close();
} catch (error) {
  write({ ok: false, error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
