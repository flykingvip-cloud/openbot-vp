/**
 * Isolation-only child process for closed-loop recovery proofs.
 * Spawned by closed-loop-isolation-contract.test.ts and then exited.
 * Does not talk to a gateway, send messages, or read production state.
 */
import fs from "node:fs";
import {
  recordCapabilityGapEvent,
  getEmptyReplyGapCounterForTests,
} from "../gateway/evolution-control/capability-gap-ingest.js";
import { OutcomeConsumerRuntime } from "./consumers.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { hydrateAwaitingDeliveriesFromDisk, peekAwaitingDelivery } from "./pending-delivery.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:subject-alice",
  subjectRef: "subject:alice",
  authzScopeRef: "scope:isolation",
};

function writeResult(outFile: string, value: unknown): void {
  fs.writeFileSync(outFile, `${JSON.stringify(value)}\n`, "utf8");
}

function fail(outFile: string, error: unknown): never {
  writeResult(outFile, {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "drain") {
    const [root, outFile, counterFile] = args;
    if (!root || !outFile) {
      throw new Error("drain requires <root> <outFile> [counterFile]");
    }
    const store = new DurableTaskOutcomeStore(root);
    const runtime = new OutcomeConsumerRuntime(store, {
      handlers: counterFile
        ? [
            {
              consumerId: "isolation-side-effect",
              onEvent: () => {
                const prev = fs.existsSync(counterFile)
                  ? Number(fs.readFileSync(counterFile, "utf8"))
                  : 0;
                fs.writeFileSync(counterFile, String(prev + 1), "utf8");
              },
            },
          ]
        : [],
    });
    const drained = await runtime.drain((taskId) => store.loadTask(taskId));
    writeResult(outFile, {
      ok: true,
      processed: drained.processed,
      deferred: drained.deferred,
      successCount: runtime.getProjection().successCount,
      failureCount: runtime.getProjection().failureCount,
      pending: store.listPendingOutbox().length,
      sideEffects:
        counterFile && fs.existsSync(counterFile)
          ? Number(fs.readFileSync(counterFile, "utf8"))
          : 0,
    });
    store.close();
    process.exit(0);
  }

  if (command === "fail-once") {
    const [root, outFile] = args;
    if (!root || !outFile) {
      throw new Error("fail-once requires <root> <outFile>");
    }
    const store = new DurableTaskOutcomeStore(root);
    const runtime = new OutcomeConsumerRuntime(store, {
      handlers: [
        {
          consumerId: "isolation-side-effect",
          onEvent: () => {
            throw new Error("synthetic handler failure");
          },
        },
      ],
    });
    const drained = await runtime.drain((taskId) => store.loadTask(taskId));
    writeResult(outFile, {
      ok: true,
      processed: drained.processed,
      deferred: drained.deferred,
      pending: store.listPendingOutbox().length,
    });
    store.close();
    process.exit(0);
  }

  if (command === "accept") {
    const [root, taskId, expectedVersion, fencingToken, commandId, outFile] = args;
    if (!root || !taskId || !expectedVersion || !fencingToken || !commandId || !outFile) {
      throw new Error(
        "accept requires <root> <taskId> <expectedVersion> <fencing> <commandId> <outFile>",
      );
    }
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store, submittedBy: "isolation-child" });
    const chat = new ChatTaskOutcomeAdapter(service);
    const result = chat.setAcceptance(
      taskId,
      Number(expectedVersion),
      fencingToken,
      { status: "passed" },
      {
        allowRetry: false,
        evidence: [
          {
            validatorId: "isolation-child",
            validatorVersion: "1",
            scope: "artifact",
            artifactDigestOrReceiptRef: "sha256:isolation",
            taskContractVersion: "1.0.0",
            executionVersion: "1",
          },
        ],
        scope,
        commandId,
      },
    );
    writeResult(outFile, {
      ok: result.ok,
      code: result.ok ? "ok" : result.code,
      version: result.ok ? result.record.outcomeVersion : result.current?.outcomeVersion,
    });
    store.close();
    process.exit(0);
  }

  if (command === "pending") {
    const [root, taskId, outFile] = args;
    if (!root || !taskId || !outFile) {
      throw new Error("pending requires <root> <taskId> <outFile>");
    }
    const hydrated = hydrateAwaitingDeliveriesFromDisk(root);
    const peeked = peekAwaitingDelivery({ persistRoot: root, taskId });
    writeResult(outFile, {
      ok: true,
      hydrated,
      taskId: peeked?.taskId ?? null,
      deliveryId: peeked?.deliveryId ?? null,
      runId: peeked?.runId ?? null,
    });
    process.exit(0);
  }

  if (command === "gap-empty") {
    const [outFile] = args;
    if (!outFile) {
      throw new Error("gap-empty requires <outFile>");
    }
    const first = recordCapabilityGapEvent({
      category: "skill",
      reason: "direct_chat_silent_or_empty_reply",
      sourceKind: "empty_reply",
      tenantId: "tenant-isolation",
      agentId: "bot-isolation",
      sessionKey: "sess-isolation",
      explicitMarker: false,
    });
    writeResult(outFile, {
      ok: true,
      recorded: first.recorded,
      deduped: first.deduped,
      metricOnly: first.metricOnly,
      proposalId: first.proposalId,
      counter: getEmptyReplyGapCounterForTests(),
    });
    process.exit(0);
  }

  throw new Error(`unknown command ${command ?? ""}`);
} catch (error) {
  const outFile = args.at(-1);
  if (outFile) {
    fail(outFile, error);
  }
  throw error;
}
