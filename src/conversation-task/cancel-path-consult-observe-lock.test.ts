/**
 * Phase C §8.3 residual — cancel-path consult observe regression lock.
 *
 * Locks soft-observe consult on the cancel lifecycle (chat.send focusSwitchCancel
 * → observeConversationTaskCancelPathConsult) against the FC-02 ENV / record
 * shape in `reply-completion.ts` + `consultDeliveryHoldForClose`.
 * No defer-close; no enforce; no second ENV; no live invoke.
 *
 * Start-order id: `phase_c_83_cancel_path_consult_observe_start_order` (#95).
 * Claim ceiling: code-present. C10 still cannot pass; NO-GO COMPLETE;
 * unique-benefit FAIL; A/B/C merge ≠ PASS/GO.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as completionHold from "../agents/execution-preflight/completion-hold.js";
import {
  armCompletionHold,
  buildExecutionPreflight,
  consultDeliveryHoldForClose,
  resetCompletionHoldsForTest,
  resetExecutionTraceForTest,
} from "../agents/execution-preflight/index.js";
import { applyFocusCancelFence, FOCUS_CANCELLED_SENTINEL } from "./focus-switch.js";
import {
  CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV,
  isConversationTaskDeliveryCloseConsultEnabled,
  observeConversationTaskCancelPathConsult,
  readConversationTaskDeliveryCloseConsults,
  resetConversationTaskDeliveryCloseConsultsForTest,
  type ConversationTaskDeliveryCloseConsultRecord,
} from "./reply-completion.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");

const FC02_ENV = "OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT";
const REPLY_COMPLETION_REL = "src/conversation-task/reply-completion.ts";
const FOCUS_SWITCH_REL = "src/conversation-task/focus-switch.ts";
const CHAT_REL = "src/gateway/server-methods/chat.ts";

function readRepoFile(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), "utf8");
}

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
    sessionId: "session-cancel-path-lock",
    message: "run sample-task",
    skills: [skill],
    policyToolNames: ["read", "write", "edit", "message", "sessions_send"],
    qualify: () => ({ kind: "short_action", reasons: ["test"] }),
  });
}

const INCOMING = "请使用 web-research 做一次标准深度联网调研。";

afterEach(() => {
  delete process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV];
  resetConversationTaskDeliveryCloseConsultsForTest();
  resetCompletionHoldsForTest();
  resetExecutionTraceForTest();
});

describe("cancel-path consult observe lock (Phase C §8.3)", () => {
  it("reuses FC-02 ENV (default-off) and does not invent a second OPENBOT_* flag", () => {
    expect(CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV).toBe(FC02_ENV);
    expect(isConversationTaskDeliveryCloseConsultEnabled({})).toBe(false);
    expect(isConversationTaskDeliveryCloseConsultEnabled({ [FC02_ENV]: "1" })).toBe(true);

    const replySrc = readRepoFile(REPLY_COMPLETION_REL);
    const openbotFlags = replySrc.match(/OPENBOT_[A-Z0-9_]+/g) ?? [];
    expect(new Set(openbotFlags)).toEqual(new Set([FC02_ENV]));
    expect(replySrc.toLowerCase()).not.toContain("defer-close");
    expect(replySrc).not.toMatch(/\benforce\b/i);
    expect(replySrc).not.toContain("closeDeferred: true");
  });

  it("flag off: cancel fence still applies and records no consult", () => {
    const fenced = applyFocusCancelFence(INCOMING);
    expect(fenced.startsWith(FOCUS_CANCELLED_SENTINEL)).toBe(true);
    expect(fenced).toContain(INCOMING);

    observeConversationTaskCancelPathConsult({
      sessionKey: "agent:main:main",
      text: INCOMING,
    });
    expect(readConversationTaskDeliveryCloseConsults()).toEqual([]);
  });

  it("flag on: records observe consult and does not defer cancel fence", () => {
    process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV] = "1";
    const preflight = preflightFor("task-cancel-path-on");
    armCompletionHold({
      keys: ["agent:main:main"],
      preflight,
    });

    const fenced = applyFocusCancelFence(INCOMING);
    expect(fenced.startsWith(FOCUS_CANCELLED_SENTINEL)).toBe(true);
    expect(fenced).toContain(INCOMING);

    observeConversationTaskCancelPathConsult({
      sessionKey: "agent:main:main",
      text: INCOMING,
    });

    expect(readConversationTaskDeliveryCloseConsults()).toEqual([
      expect.objectContaining({
        conversationTaskId: "cancel-path",
        sessionKey: "agent:main:main",
        mode: "observe",
        closeDeferred: false,
        hasDeliveryContext: true,
        sessionHoldAmbiguous: false,
      }),
    ]);
    const record = readConversationTaskDeliveryCloseConsults()[0];
    expect(record.closeDeferred).toBe(false);
    expect(record.mode).toBe("observe");
  });

  it("flag on with no hold: still records observe and still cancels", () => {
    process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV] = "on";
    const fenced = applyFocusCancelFence(INCOMING);
    expect(fenced.startsWith(FOCUS_CANCELLED_SENTINEL)).toBe(true);

    observeConversationTaskCancelPathConsult({
      sessionKey: "agent:main:empty",
      text: INCOMING,
    });
    expect(readConversationTaskDeliveryCloseConsults()).toEqual([
      expect.objectContaining({
        conversationTaskId: "cancel-path",
        sessionKey: "agent:main:empty",
        mode: "observe",
        closeDeferred: false,
        hasDeliveryContext: false,
        holds: [],
      }),
    ]);
  });

  it("consult failure still completes the cancel fence transition", () => {
    process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV] = "1";
    const replySrc = readRepoFile(REPLY_COMPLETION_REL);
    const cancelBody = extractFunctionSource(replySrc, "observeConversationTaskCancelPathConsult");
    expect(cancelBody).toContain("A failed observe must not skip or defer the cancel transition");
    expect(cancelBody).toMatch(/catch\s*\{/);

    const spy = vi.spyOn(completionHold, "consultDeliveryHoldForClose").mockImplementation(() => {
      throw new Error("consult boom");
    });
    try {
      expect(() =>
        observeConversationTaskCancelPathConsult({
          sessionKey: "agent:main:main",
          text: INCOMING,
        }),
      ).not.toThrow();
      expect(readConversationTaskDeliveryCloseConsults()).toEqual([]);

      const fenced = applyFocusCancelFence(INCOMING);
      expect(fenced.startsWith(FOCUS_CANCELLED_SENTINEL)).toBe(true);
      expect(fenced).toContain(INCOMING);
    } finally {
      spy.mockRestore();
    }
  });

  it("locks closeDeferred always false and observe-only record shape", () => {
    const replySrc = readRepoFile(REPLY_COMPLETION_REL);
    expect(replySrc).toContain("observeConversationTaskCancelPathConsult");
    expect(replySrc).toMatch(/closeDeferred:\s*false/);
    expect(replySrc).not.toMatch(/closeDeferred:\s*true/);

    const cancelBody = extractFunctionSource(replySrc, "observeConversationTaskCancelPathConsult");
    expect(cancelBody).toContain("consultDeliveryHoldForClose");
    expect(cancelBody).toContain("isConversationTaskDeliveryCloseConsultEnabled");
    expect(cancelBody).toContain("A failed observe must not skip or defer the cancel transition");

    const recordShape: ConversationTaskDeliveryCloseConsultRecord = {
      conversationTaskId: "cancel-path",
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
  });

  it("wires chat.send cancel lifecycle → observe; focus-switch fence stays pure", () => {
    const chatSrc = readRepoFile(CHAT_REL);
    expect(chatSrc).toContain("observeConversationTaskCancelPathConsult");
    expect(chatSrc).toMatch(/taskTracking\.action === ["']cancel_parked["']/);
    expect(chatSrc).toContain('from "../../conversation-task/reply-completion.js"');

    const focusSrc = readRepoFile(FOCUS_SWITCH_REL);
    expect(focusSrc).not.toContain("observeConversationTaskCancelPathConsult");
    expect(focusSrc).not.toContain("consultDeliveryHoldForClose");
    expect(focusSrc).toContain("applyFocusCancelFence");
  });

  it("consult API remains read-only (no enforce / no defer)", () => {
    const named = consultDeliveryHoldForClose({
      sessionKey: "agent:main:main",
      text: "cancel",
    });
    expect(named).toMatchObject({
      hasDeliveryContext: false,
      holds: [],
    });
  });
});
