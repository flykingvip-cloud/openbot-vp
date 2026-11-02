/**
 * Machine checks + call-relation counterexamples for the main-chain matrix (t50u).
 *
 * 10/10 short-loop coverage ≠ all bypasses controlled — these counterexamples
 * lock the definition corrections (adapter≠second create, bypass delegate/forbid,
 * matrix≠adjudicator, stop pierces, cardinality freeze).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACTIVATE_SUCCESS_DISPATCHED } from "./activate-collaboration-task.js";
import {
  assertMainChainMatrixInvariants,
  MAIN_CHAIN_BASELINE_COUNTS,
  MAIN_CHAIN_BINDING_KEYS,
  MAIN_CHAIN_BUDGET_SEMANTICS,
  MAIN_CHAIN_BYPASS_ROWS,
  MAIN_CHAIN_FORMAL_ROWS,
  MAIN_CHAIN_MATRIX_ALL,
  MAIN_CHAIN_MATRIX_RUNTIME_STANCE,
  MAIN_CHAIN_SOLE_WRITE_ENTRIES,
  MONO_GROUP_REUSE_BOUNDARY,
  renderMainChainBypassMarkdown,
  renderMainChainMatrixMarkdown,
} from "./main-chain-state-matrix.js";

const LEARNING_DIR = path.dirname(fileURLToPath(import.meta.url));

describe("main-chain state matrix (machine-checkable)", () => {
  it("invariants: 17 formal steps + bypasses with delegate/forbid metadata", () => {
    const result = assertMainChainMatrixInvariants(MAIN_CHAIN_MATRIX_ALL);
    expect(result.ok).toBe(true);
    expect(result.formalCount).toBe(17);
    expect(result.bypassCount).toBe(MAIN_CHAIN_BYPASS_ROWS.length);
    expect(MAIN_CHAIN_BYPASS_ROWS.length).toBe(MAIN_CHAIN_BASELINE_COUNTS.bypassRows);
    expect(result.distinctSoleWriteEntries).toBe(
      MAIN_CHAIN_BASELINE_COUNTS.distinctSoleWriteEntries,
    );
    expect(result.distinctAuthoritativeOps).toBe(
      MAIN_CHAIN_BASELINE_COUNTS.distinctAuthoritativeOps,
    );
    expect(result.adapterViewRows).toBe(MAIN_CHAIN_BASELINE_COUNTS.adapterViewRows);
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
      expect(row.kind).toBe("bypass");
      expect(row.soleWriteEntry).toBe("");
      expect(row.forbidDirectWrites.length).toBeGreaterThan(0);
      expect(Array.isArray(row.mayDelegateTo)).toBe(true);
    }
  });

  it("markdown render is non-empty and includes sole entries + roles", () => {
    const md = renderMainChainMatrixMarkdown();
    expect(md).toContain("authoritative write");
    expect(md).toContain("activateCollaborationTask");
    expect(md).toContain("claimCollaborationBoardItem");
    expect(md).toContain("acceptCollaborationBoardItemSubmission");
    expect(md).toContain("authoritativeOp");
    const bypassMd = renderMainChainBypassMarkdown();
    expect(bypassMd).toContain("mayDelegateTo");
    expect(bypassMd).toContain("forbidDirectWrites");
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

describe("main-chain call-relation counterexamples (t50u)", () => {
  it("CE1: adapters funnel to the same authoritative transition (S01/S02 discuss_to_task)", () => {
    const s01 = MAIN_CHAIN_FORMAL_ROWS.find((r) => r.id === "S01")!;
    const s02 = MAIN_CHAIN_FORMAL_ROWS.find((r) => r.id === "S02")!;
    expect(s01.authoritativeOp).toBe("discuss_to_task");
    expect(s02.authoritativeOp).toBe("discuss_to_task");
    expect(s01.soleWriteEntry).toBe(s02.soleWriteEntry);
    expect(s01.entryRole).toBe("adapter_view");
    expect(s02.entryRole).toBe("authoritative_transition");
    expect(s01.notes ?? "").toMatch(/NOT a second task create/i);
  });

  it("CE1b: S14 review + S17 stop share post_submission_advance soleWriteEntry (not two schedulers)", () => {
    const s14 = MAIN_CHAIN_FORMAL_ROWS.find((r) => r.id === "S14")!;
    const s17 = MAIN_CHAIN_FORMAL_ROWS.find((r) => r.id === "S17")!;
    expect(s14.authoritativeOp).toBe("post_submission_advance");
    expect(s17.authoritativeOp).toBe("post_submission_advance");
    expect(s14.soleWriteEntry).toBe(s17.soleWriteEntry);
    expect(s14.entryRole).toBe("adapter_view");
    expect(s17.entryRole).toBe("adapter_view");
  });

  it("CE2: same-class judgments are not duplicated as overturnable parallel writers", () => {
    // Every formal soleWriteEntry maps to exactly one authoritativeOp; no two ops share an entry.
    const byEntry = new Map<string, Set<string>>();
    for (const row of MAIN_CHAIN_FORMAL_ROWS) {
      const set = byEntry.get(row.soleWriteEntry) ?? new Set<string>();
      set.add(row.authoritativeOp!);
      byEntry.set(row.soleWriteEntry, set);
    }
    for (const [entry, ops] of byEntry) {
      expect(ops.size, `${entry} spans ops ${[...ops].join(",")}`).toBe(1);
    }
  });

  it("CE3: old+new entries do not both schedule the same work (compat reject-adapt; no shadow scheduler)", () => {
    const b07 = MAIN_CHAIN_BYPASS_ROWS.find((r) => r.id === "B07")!;
    expect(b07.forbidDirectWrites).toEqual(
      expect.arrayContaining(["duplicate_schedule_same_work_alongside_new_entry"]),
    );
    expect(b07.successFact).toMatch(/reject-adapt/i);
    const b04 = MAIN_CHAIN_BYPASS_ROWS.find((r) => r.id === "B04")!;
    expect(b04.forbidDirectWrites).toEqual(expect.arrayContaining(["shadow_scheduler"]));
  });

  it("CE4: after stop/cancel — no new business action; bypasses cannot lift stop or mint substitute wake", () => {
    const s17 = MAIN_CHAIN_FORMAL_ROWS.find((r) => r.id === "S17")!;
    expect(s17.nextAllowed).toEqual([]);
    expect(s17.successFact).toMatch(/no further execute wakes/i);
    expect(s17.notes ?? "").toMatch(/must not lift effective stop/i);

    for (const id of ["B03", "B04", "B05", "B06"] as const) {
      const row = MAIN_CHAIN_BYPASS_ROWS.find((r) => r.id === id)!;
      const forbid = row.forbidDirectWrites.join(" ");
      expect(
        forbid.includes("lift_effective_stop") ||
          forbid.includes("mint_substitute_wake_for_invalid_wake") ||
          forbid.includes("clear_effective_stop"),
        `${id} must forbid stop-lift or substitute-wake`,
      ).toBe(true);
    }
  });

  it("CE5: exec entry + continue-loop counts do not increase vs frozen baseline", () => {
    const result = assertMainChainMatrixInvariants();
    expect(result.formalCount).toBe(MAIN_CHAIN_BASELINE_COUNTS.formalSteps);
    expect(result.bypassCount).toBe(MAIN_CHAIN_BASELINE_COUNTS.bypassRows);
    expect(result.distinctSoleWriteEntries).toBe(
      MAIN_CHAIN_BASELINE_COUNTS.distinctSoleWriteEntries,
    );
    expect(result.distinctAuthoritativeOps).toBe(
      MAIN_CHAIN_BASELINE_COUNTS.distinctAuthoritativeOps,
    );
    // Continue path remains a bypass that delegates — not a new formal exec entry.
    const cont = MAIN_CHAIN_BYPASS_ROWS.find(
      (r) => r.event === "scheduleContinueAfterDeliverableSettlement",
    )!;
    expect(cont.kind).toBe("bypass");
    expect(cont.mayDelegateTo.join(" ")).toMatch(/finite_continue|wake-contract|mode-b/i);
    expect(cont.soleWriteEntry).toBe("");
  });

  it("CE6: bypass kind≠constrained — heartbeat/selfAdvance declare lawful delegates (not blank non-writer)", () => {
    const hb = MAIN_CHAIN_BYPASS_ROWS.find((r) => r.id === "B03")!;
    expect(hb.kind).toBe("bypass");
    expect(hb.mayDelegateTo.length).toBeGreaterThan(0);
    expect(hb.mayDelegateTo.join(" ")).toMatch(/S09/);
    expect(hb.notes ?? "").toMatch(/NOT ['"]?non-writer/i);

    const sa = MAIN_CHAIN_BYPASS_ROWS.find((r) => r.id === "B04")!;
    expect(sa.mayDelegateTo.join(" ")).toMatch(/S05/);
    expect(sa.mayDelegateTo.join(" ")).toMatch(/S09/);
  });

  it("CE7: peer_ask stays discuss-supplement — never formal responsibility / handoff", () => {
    const peer = MAIN_CHAIN_BYPASS_ROWS.find((r) => r.id === "B01")!;
    expect(peer.mayDelegateTo).toEqual([]);
    expect(peer.forbidDirectWrites).toEqual(
      expect.arrayContaining([
        "publish_board",
        "claim",
        "accept",
        "formal_responsibility_fact",
        "mint_execute_wake",
      ]),
    );
    expect(peer.notes ?? "").toMatch(/never becomes formal responsibility/i);
    expect(peer.notes ?? "").toMatch(/Long-task continue reuses board\/plan\/wake/i);
  });

  it("CE8: matrix is not a second runtime adjudicator", () => {
    expect(MAIN_CHAIN_MATRIX_RUNTIME_STANCE.isRuntimeAdjudicator).toBe(false);
    expect(MAIN_CHAIN_MATRIX_RUNTIME_STANCE.mayReDecideAuth).toBe(false);
    expect(MAIN_CHAIN_MATRIX_RUNTIME_STANCE.mayReDecidePlan).toBe(false);
    expect(MAIN_CHAIN_MATRIX_RUNTIME_STANCE.mayReDecideContinue).toBe(false);
    expect(MAIN_CHAIN_MATRIX_RUNTIME_STANCE.purpose).toBe(
      "describe_and_verify_existing_call_relations",
    );
  });

  it("CE9: mono vs group SoT boundary — shareable mechanics listed; SoT not mergeable", () => {
    expect(MONO_GROUP_REUSE_BOUNDARY.shareable).toEqual(
      expect.arrayContaining([
        "executor_finite_continue",
        "tool_fail_class",
        "unknown_anti_retry",
        "queue",
        "stop_checks",
        "progress_event_semantics",
      ]),
    );
    expect(MONO_GROUP_REUSE_BOUNDARY.doNotMergeSoT).toEqual(
      expect.arrayContaining(["personal_current_parked", "group_board_claim_plan"]),
    );
    expect(MAIN_CHAIN_BUDGET_SEMANTICS.mustNotConflate).toBe(true);
  });

  it("CE10: #214 alignment cross-notes without expanding #214 features", () => {
    const s04 = MAIN_CHAIN_FORMAL_ROWS.find((r) => r.id === "S04")!;
    const s05 = MAIN_CHAIN_FORMAL_ROWS.find((r) => r.id === "S05")!;
    expect(s04.notes ?? "").toMatch(/publish ≠ claim|#214/i);
    expect(s05.notes ?? "").toMatch(/Proxy claim forbidden|#214/i);
    expect(s05.failureFact).toMatch(/actor_required|claim_actor_mismatch/);
  });
});
