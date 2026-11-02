/**
 * Machine checks for the formal main-chain state matrix catalog.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACTIVATE_SUCCESS_DISPATCHED } from "./activate-collaboration-task.js";
import {
  assertMainChainMatrixInvariants,
  MAIN_CHAIN_BINDING_KEYS,
  MAIN_CHAIN_BYPASS_ROWS,
  MAIN_CHAIN_FORMAL_ROWS,
  MAIN_CHAIN_MATRIX_ALL,
  MAIN_CHAIN_SOLE_WRITE_ENTRIES,
  renderMainChainMatrixMarkdown,
} from "./main-chain-state-matrix.js";

const LEARNING_DIR = path.dirname(fileURLToPath(import.meta.url));

describe("main-chain state matrix (machine-checkable)", () => {
  it("invariants: 17 formal steps + bypasses are non-writers", () => {
    const result = assertMainChainMatrixInvariants(MAIN_CHAIN_MATRIX_ALL);
    expect(result.ok).toBe(true);
    expect(result.formalCount).toBe(17);
    expect(result.bypassCount).toBe(MAIN_CHAIN_BYPASS_ROWS.length);
    expect(MAIN_CHAIN_BYPASS_ROWS.length).toBeGreaterThanOrEqual(8);
  });

  it("activate success dispatched constant stays false", () => {
    expect(ACTIVATE_SUCCESS_DISPATCHED).toBe(false);
    const activateRow = MAIN_CHAIN_FORMAL_ROWS.find((r) => r.id === "S03");
    expect(activateRow?.successFact).toMatch(/dispatched===false/);
  });

  it("each formal soleWriteEntry resolves to an existing source file under collaboration-learning or dispatch", () => {
    const roots = [LEARNING_DIR, path.resolve(LEARNING_DIR, "../collaboration-dispatch")];
    for (const entry of MAIN_CHAIN_SOLE_WRITE_ENTRIES) {
      const filePart = entry.split("#")[0].trim();
      // Compound wake entry documents two modules with " / ".
      const candidates = filePart
        .split("/")
        .map((p) => p.trim())
        .filter(Boolean);
      const fileNames = candidates
        .map((c) => c.replace(/\s+/g, ""))
        .filter((c) => c.endsWith(".ts"));
      expect(fileNames.length, entry).toBeGreaterThan(0);
      for (const fileName of fileNames) {
        const hit = roots.some((root) => fs.existsSync(path.join(root, fileName)));
        expect(hit, `missing source for ${fileName} from ${entry}`).toBe(true);
      }
    }
  });

  it("binding keys are the frozen set", () => {
    expect([...MAIN_CHAIN_BINDING_KEYS]).toEqual([
      "tenant",
      "group",
      "task",
      "board",
      "todolist",
      "claimant",
      "actor",
      "submission",
      "deliverable",
      "opKey",
      "attempt",
      "version",
      "source",
    ]);
  });

  it("nextAllowed edges only reference known formal ids or empty terminal", () => {
    const ids = new Set(MAIN_CHAIN_FORMAL_ROWS.map((r) => r.id));
    for (const row of MAIN_CHAIN_FORMAL_ROWS) {
      for (const next of row.nextAllowed) {
        expect(ids.has(next), `${row.id} → ${next}`).toBe(true);
      }
    }
    const stop = MAIN_CHAIN_FORMAL_ROWS.find((r) => r.id === "S17");
    expect(stop?.nextAllowed).toEqual([]);
  });

  it("bypass catalog documents peer_ask, insight, heartbeat, selfAdvance, continue, resume, old handoff, ledger", () => {
    const events = MAIN_CHAIN_BYPASS_ROWS.map((r) => r.event);
    expect(events).toEqual(
      expect.arrayContaining([
        "peer_ask_or_mention",
        "signalInsight",
        "heartbeat",
        "selfAdvance_gray_only",
        "scheduleContinueAfterDeliverableSettlement",
        "resume_after_restart",
        "old_handoff_rpc",
        "insight_or_return_ledger_not_dispatched",
      ]),
    );
    for (const row of MAIN_CHAIN_BYPASS_ROWS) {
      expect(row.kind).toBe("non_writer");
      expect(row.soleWriteEntry).toBe("");
    }
  });

  it("markdown render is non-empty and includes sole entries", () => {
    const md = renderMainChainMatrixMarkdown();
    expect(md).toContain("sole write entry");
    expect(md).toContain("activateCollaborationTask");
    expect(md).toContain("claimCollaborationBoardItem");
    expect(md).toContain("acceptCollaborationBoardItemSubmission");
  });

  it("S05 requires non-empty actor; S09 wakeDispatcherAccepted is definite-only", () => {
    const claim = MAIN_CHAIN_FORMAL_ROWS.find((r) => r.id === "S05")!;
    expect(claim.precondition).toMatch(/non-empty trusted actor/i);
    expect(claim.failureFact).toMatch(/actor_required|claim_actor_mismatch/);
    const wake = MAIN_CHAIN_FORMAL_ROWS.find((r) => r.id === "S09")!;
    expect(wake.successFact).toMatch(/wakeDispatcherAccepted definite only/i);
    expect(wake.notes ?? "").toMatch(/excludes unknown/i);
  });
});
