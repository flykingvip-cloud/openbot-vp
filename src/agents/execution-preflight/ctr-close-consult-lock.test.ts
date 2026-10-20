/**
 * Path B / ABC Knife3 — CTR whole-row ↔ FC-02 close-consult regression lock.
 *
 * Locks ConversationTask whole-row `n/a-not-tri-state` (#87) against the
 * already-wired FC-02 consult shape in `reply-completion.ts` /
 * `consultDeliveryHoldForClose`. No defer-close; no enforce; no new flag;
 * CTR disposition row unchanged; cancel / cross-process persistence OUT.
 *
 * Start-order id: `phase_c_83_path_b_ctr_consult_polish_start_order` (#91).
 * Claim ceiling: code-present. C10 still cannot pass; NO-GO COMPLETE;
 * unique-benefit FAIL; 合入 ≠ PASS/GO.
 *
 * Optional CTR `task.id` pass-through: **skipped**. `consultDeliveryHoldForClose`
 * `taskId` is a preflight hold id; ConversationTask `task.id` is a different
 * domain id. Passing it would change consult observation (session holds →
 * empty) and is therefore not zero-semantic for this slice.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV,
  isConversationTaskDeliveryCloseConsultEnabled,
  type ConversationTaskDeliveryCloseConsultRecord,
} from "../../conversation-task/reply-completion.js";
import { ALLOWED_ENTRY_DISPOSITIONS, dispositionForEntry } from "./allowed-entry-disposition.js";
import {
  armCompletionHold,
  buildExecutionPreflight,
  consultDeliveryHoldForClose,
  readExecutionTraces,
  resetCompletionHoldsForTest,
  resetExecutionTraceForTest,
} from "./index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

const CTR_ENTRY = "ConversationTask whole-row" as const;
const FC02_ENV = "OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT";
const REPLY_COMPLETION_REL = "src/conversation-task/reply-completion.ts";
const COMPLETION_HOLD_REL = "src/agents/execution-preflight/completion-hold.ts";

function readRepoFile(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), "utf8");
}

/**
 * Extract the source of `function <name>(...) { ... }` including nested braces.
 */
function extractFunctionSource(source: string, fnName: string): string {
  const re = new RegExp(`(?:export\\s+)?function\\s+${fnName}\\s*\\(`, "m");
  const match = re.exec(source);
  expect(match, `missing function ${fnName}`).toBeTruthy();
  const start = match!.index;

  let i = source.indexOf("(", start);
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }

  while (i < source.length && /\s/.test(source[i])) {
    i++;
  }
  if (source[i] === ":") {
    i++;
    let angle = 0;
    let paren = 0;
    let bracket = 0;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === "<") {
        angle++;
      } else if (ch === ">") {
        angle = Math.max(0, angle - 1);
      } else if (ch === "(") {
        paren++;
      } else if (ch === ")") {
        paren = Math.max(0, paren - 1);
      } else if (ch === "[") {
        bracket++;
      } else if (ch === "]") {
        bracket = Math.max(0, bracket - 1);
      } else if (ch === "{" && angle === 0 && paren === 0 && bracket === 0) {
        break;
      }
    }
  }
  while (i < source.length && /\s/.test(source[i])) {
    i++;
  }
  expect(source[i], `${fnName} body start`).toBe("{");

  depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unclosed body for ${fnName}`);
}

const skill = {
  name: "sample-primary",
  frontmatter: {
    aliases: "sample-alias",
    "primary-engine": "sample-engine",
    "forbidden-final-engines": "legacy-engine",
    "required-artifacts": "output.bin",
    "required-validators": "sample-validator",
    "delivery-blocked-until": "validator_passed",
    triggers: "sample-task",
    "allowed-tools": "read,write,edit,message,sessions_send",
    "generation-stage-tools": "write,edit",
    "delivery-stage-tools": "message,sessions_send",
  },
};

function preflightFor(taskId: string) {
  return buildExecutionPreflight({
    taskId,
    sessionId: "session-path-b-lock",
    message: "run sample-task",
    skills: [skill],
    policyToolNames: ["read", "write", "edit", "message", "sessions_send"],
    qualify: () => ({ kind: "short_action", reasons: ["test"] }),
  });
}

afterEach(() => {
  resetCompletionHoldsForTest();
  resetExecutionTraceForTest();
});

describe("CTR close-consult lock (Path B / ABC Knife3)", () => {
  it("keeps ConversationTask whole-row as n/a-not-tri-state (not reuse-observe)", () => {
    expect(dispositionForEntry(CTR_ENTRY)).toBe("n/a-not-tri-state");
    const row = ALLOWED_ENTRY_DISPOSITIONS.find((r) => r.entry === CTR_ENTRY);
    expect(row?.disposition).toBe("n/a-not-tri-state");
    expect(row?.note).toContain("FC-02 is close-consult only");
    expect(row?.note).toContain("not preflight tri-state");
    // Whole-row must not be silently rewritten into a preflight tri-state.
    expect(row?.disposition).not.toBe("reuse-observe");
    expect(row?.disposition).not.toBe("exemption+break-glass");
    expect(row?.disposition).not.toBe("delete");
  });

  it("keeps ENV name stable and default-off", () => {
    expect(CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV).toBe(FC02_ENV);
    const replySrc = readRepoFile(REPLY_COMPLETION_REL);
    expect(replySrc).toContain(`"${FC02_ENV}"`);
    expect(replySrc).toContain("CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV");

    expect(isConversationTaskDeliveryCloseConsultEnabled({})).toBe(false);
    expect(isConversationTaskDeliveryCloseConsultEnabled({ [FC02_ENV]: "" })).toBe(false);
    expect(isConversationTaskDeliveryCloseConsultEnabled({ [FC02_ENV]: "0" })).toBe(false);
    expect(isConversationTaskDeliveryCloseConsultEnabled({ [FC02_ENV]: "1" })).toBe(true);
    expect(isConversationTaskDeliveryCloseConsultEnabled({ [FC02_ENV]: "true" })).toBe(true);
    expect(isConversationTaskDeliveryCloseConsultEnabled({ [FC02_ENV]: "yes" })).toBe(true);
    expect(isConversationTaskDeliveryCloseConsultEnabled({ [FC02_ENV]: "on" })).toBe(true);
  });

  it("locks observe→consult shape with closeDeferred always false", () => {
    const replySrc = readRepoFile(REPLY_COMPLETION_REL);
    expect(replySrc).toContain("observeConversationTaskReplyCompleted");
    expect(replySrc).toContain("consultDeliveryHoldForClose");
    expect(replySrc).toContain("rememberDeliveryCloseConsult");

    // Type-level / record construction: closeDeferred is the literal false.
    expect(replySrc).toMatch(/closeDeferred:\s*false/);
    // No true assignment anywhere in the FC-02 module.
    expect(replySrc).not.toMatch(/closeDeferred:\s*true/);

    const observeBody = extractFunctionSource(replySrc, "observeConversationTaskReplyCompleted");
    expect(observeBody).toContain("consultDeliveryHoldForClose");
    expect(observeBody).toContain("isConversationTaskDeliveryCloseConsultEnabled");
    // Flag-on consult must not skip domain-local close.
    expect(observeBody).toContain('transitionTask(task.id, "closed")');
    expect(observeBody).toContain("A failed observe must not skip the domain-local close");

    // Record type mode stays observe-only.
    const recordShape: ConversationTaskDeliveryCloseConsultRecord = {
      conversationTaskId: "ct-lock",
      sessionKey: "agent:main:main",
      mode: "observe",
      closeDeferred: false,
      hasDeliveryContext: false,
      sessionHoldAmbiguous: false,
      completionClaimBlocked: false,
      deliveryBlocksCompletionClaims: false,
      holds: [],
    };
    expect(recordShape.closeDeferred).toBe(false);
    expect(recordShape.mode).toBe("observe");

    // Current CTR call: sessionKey + text only (no taskId pass-through this turn).
    expect(observeBody).toMatch(
      /consultDeliveryHoldForClose\(\{\s*sessionKey:\s*conversationId,\s*text:/,
    );
    expect(observeBody).not.toMatch(/taskId:\s*task\.id/);
  });

  it("locks explicit taskId API contract without writing a completion trace", () => {
    const holdSrc = readRepoFile(COMPLETION_HOLD_REL);
    expect(holdSrc).toContain("export function consultDeliveryHoldForClose");
    expect(holdSrc).toMatch(/taskId\?:\s*string/);
    expect(holdSrc).toContain("An explicit preflight task id reads that hold only");

    // No hold → empty (explicit id).
    expect(
      consultDeliveryHoldForClose({
        taskId: "not-a-held-task",
        sessionKey: "agent:main:main",
        text: "任务已完成",
      }),
    ).toMatchObject({
      hasDeliveryContext: false,
      sessionHoldAmbiguous: false,
      completionClaimBlocked: false,
      holds: [],
    });

    const preflight = preflightFor("task-path-b-lock");
    armCompletionHold({
      keys: ["agent:main:main"],
      preflight,
    });
    resetExecutionTraceForTest();

    // Explicit taskId reads that hold only; does not write a completion trace.
    const named = consultDeliveryHoldForClose({
      taskId: preflight.taskId,
      text: "正在整理材料",
    });
    expect(named.hasDeliveryContext).toBe(true);
    expect(named.sessionHoldAmbiguous).toBe(false);
    expect(named.holds).toHaveLength(1);
    expect(named.holds[0]?.preflightTaskId).toBe(preflight.taskId);
    expect(readExecutionTraces(preflight.taskId)).toEqual([]);

    // Session path coexists (ambiguous when multiple holds share the session).
    const other = preflightFor("task-path-b-lock-other");
    armCompletionHold({
      keys: ["agent:main:main"],
      preflight: other,
    });
    const ambiguous = consultDeliveryHoldForClose({
      sessionKey: "agent:main:main",
      text: "任务已完成",
    });
    expect(ambiguous.sessionHoldAmbiguous).toBe(true);
    expect(ambiguous.holds.length).toBeGreaterThanOrEqual(2);
    // Explicit id still collapses to one hold and clears ambiguity.
    const stillNamed = consultDeliveryHoldForClose({
      taskId: preflight.taskId,
      sessionKey: "agent:main:main",
      text: "任务已完成",
    });
    expect(stillNamed.sessionHoldAmbiguous).toBe(false);
    expect(stillNamed.holds).toHaveLength(1);
    expect(stillNamed.holds[0]?.preflightTaskId).toBe(preflight.taskId);
    expect(readExecutionTraces(preflight.taskId)).toEqual([]);
  });

  it("does not add a second OPENBOT_* flag or defer/enforce wording in FC-02 sites", () => {
    const replySrc = readRepoFile(REPLY_COMPLETION_REL);
    const openbotFlags = replySrc.match(/OPENBOT_[A-Z0-9_]+/g) ?? [];
    expect(new Set(openbotFlags)).toEqual(new Set([FC02_ENV]));
    // No defer-close / enforce narrative in the close path module.
    expect(replySrc.toLowerCase()).not.toContain("defer-close");
    expect(replySrc).not.toMatch(/\benforce\b/i);
    expect(replySrc).not.toContain("closeDeferred: true");
  });

  it("is not exported from the preflight barrel (lock stays discovery/test-side)", () => {
    const barrel = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(barrel).not.toContain("ctr-close-consult-lock");
  });
});
