/**
 * P3 complex-task loop. Default closed.
 * Four visible steps: understand (P1 relation) → plan → execute → acceptance.
 * Group execution emits at most two depth-1 collab edge markers.
 * One-to-one execution never claims a child was already dispatched.
 * A failed acceptance check replaces a complete-looking draft.
 * Checked delivery calls the existing session-board completion record
 * without opening Conversation Task Runtime. User-draft acceptance does
 * not write an evolution proposal.
 */
import type { OpenBotConfig } from "../config/config.js";
import { recordCheckedTaskCompletion } from "../conversation-task/session-task-board.js";
import { classifyTurnRelation, titleFromGoal } from "../conversation-task/turn-relation.js";
import { assessTaskOutputAlignment } from "../cron/task-focus.js";
import { resolveOrchestrationObserve } from "./observe-gate.js";
import { orchestrationToolNames, sessionsSpawnListed } from "./spawn-table.js";

const MAX_EDGES = 2;
const COMPLETE_DRAFT_MIN = 80;
const ACCEPTANCE_SENTENCE = "每一步都有可见结果";
const EDGE_RE = /\[\[\s*collab_edge\s*:[^\]]*\]\]/giu;

export type ComplexTaskMember = {
  agentId: string;
  name?: string | null;
};

export type ComplexTaskReplyPayload = {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
};

export type ComplexTaskLoopInput = {
  userText: string;
  tenantId?: string | null;
  surface: "group" | "direct";
  fromAgentId?: string | null;
  members?: readonly ComplexTaskMember[];
  toolNames?: readonly string[] | null;
  payloads?: readonly ComplexTaskReplyPayload[];
  currentGoal?: string;
  sessionFile?: string | null;
  env?: NodeJS.ProcessEnv;
  /** Test spy. The loop never invokes it. */
  directSend?: (target: string) => void;
};

export type ComplexTaskLoopResult = {
  admitted: boolean;
  payloads: ComplexTaskReplyPayload[];
  deliverableChecked: boolean;
  failedStep?: "understand" | "plan" | "execute" | "accept";
  readonly wroteEvolutionProposal: false;
};

function sanitizeField(value: string): string {
  return value
    .replace(/[\]|\r\n]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeName(value: string | null | undefined): string {
  return (
    value
      ?.trim()
      .replace(/^@+/u, "")
      .replace(/[\s「」『』"'`]+/gu, "")
      .toLowerCase() ?? ""
  );
}

function acceptanceSentence(userText: string): string {
  const marked = userText.match(/验收(?:句|标准)?[：:]\s*([^\n。]{2,40})/u);
  if (marked?.[1]) {
    return sanitizeField(marked[1]);
  }
  return ACCEPTANCE_SENTENCE;
}

function stripEdgeMarkers(text: string): string {
  return text
    .replace(EDGE_RE, "")
    .replace(/[ \t]+\n/gu, "\n")
    .trim();
}

function draftText(payloads: readonly ComplexTaskReplyPayload[]): string {
  return stripEdgeMarkers(
    payloads
      .map((payload) => (typeof payload.text === "string" ? payload.text : ""))
      .filter((text) => text.trim() !== "NO_REPLY")
      .join("\n"),
  );
}

function namedOthers(params: {
  userText: string;
  members: readonly ComplexTaskMember[];
  fromAgentId?: string | null;
}): string[] {
  const self = new Set<string>();
  const fromId = normalizeName(params.fromAgentId);
  if (fromId) {
    self.add(fromId);
  }
  for (const member of params.members) {
    if (
      fromId &&
      (normalizeName(member.agentId) === fromId || normalizeName(member.name) === fromId)
    ) {
      const name = normalizeName(member.name);
      if (name) {
        self.add(name);
      }
      self.add(normalizeName(member.agentId));
    }
  }
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (label: string) => {
    const key = normalizeName(label);
    if (!key || self.has(key) || seen.has(key)) {
      return;
    }
    seen.add(key);
    ordered.push(label.trim());
  };
  for (const match of params.userText.matchAll(/@([^\s@，,。！？!?:：]+)/gu)) {
    const raw = match[1] ?? "";
    const member = params.members.find(
      (row) =>
        normalizeName(row.name) === normalizeName(raw) ||
        normalizeName(row.agentId) === normalizeName(raw),
    );
    if (member) {
      push(member.name?.trim() || member.agentId);
    } else if (params.members.length === 0) {
      push(raw);
    }
  }
  if (ordered.length === 0) {
    for (const member of params.members) {
      const name = member.name?.trim() || member.agentId;
      if (name && params.userText.includes(name)) {
        push(name);
      }
    }
  }
  return ordered.slice(0, MAX_EDGES);
}

function edgeDirective(target: string, acceptance: string): string {
  return `[[collab_edge:handoff|to=${sanitizeField(target)}|reason=分步骤|remaining=按计划完成本步|acceptance=${sanitizeField(acceptance)}]]`;
}

function relationLabel(relation: "amend" | "aside" | "new_work"): string {
  if (relation === "amend") {
    return "amend 补充纠正";
  }
  if (relation === "new_work") {
    return "new_work 新任务";
  }
  return "aside 旁白";
}

export function applyComplexTaskLoop(input: ComplexTaskLoopInput): ComplexTaskLoopResult {
  // Collab edges are reply text. This loop does not call a direct-send tool.
  void input.directSend;
  const observed = resolveOrchestrationObserve(
    { tenantId: input.tenantId, text: input.userText },
    input.env,
  );
  if (!observed.admitted || observed.taskKind == null) {
    return {
      admitted: false,
      payloads: input.payloads ? (input.payloads as ComplexTaskReplyPayload[]) : [],
      deliverableChecked: false,
      wroteEvolutionProposal: false,
    };
  }
  const payloads = (input.payloads ?? []).map((payload) => ({ ...payload }));

  const relation = classifyTurnRelation(input.userText, input.currentGoal ?? "");
  const title = titleFromGoal(input.userText) || "当前任务";
  const acceptance = acceptanceSentence(input.userText);
  const targets =
    input.surface === "group"
      ? namedOthers({
          userText: input.userText,
          members: input.members ?? [],
          fromAgentId: input.fromAgentId,
        })
      : [];
  const spawnListed = input.surface === "direct" && sessionsSpawnListed(input.toolNames);
  const draft = draftText(payloads);
  const draftComplete = draft.length >= COMPLETE_DRAFT_MIN;
  const aligned =
    draftComplete &&
    assessTaskOutputAlignment({
      anchorText: acceptance,
      outputText: draft,
      minOutputLength: 40,
    }).aligned;

  let failedStep: ComplexTaskLoopResult["failedStep"];
  let executeLine: string;
  if (input.surface === "group" && targets.length > 0) {
    executeLine = `执行：本轮用协作边交给${targets.join("、")}（深度 1，至多 ${MAX_EDGES} 条）。不会私发其他成员。`;
  } else if (input.surface === "group") {
    executeLine = "执行：没有点名其他成员，由本代理完成。不会私发其他成员。";
  } else if (!spawnListed) {
    executeLine =
      "执行：做不到委派。当前工具表没有 sessions_spawn，这一步由本代理完成，并没有把任务派出去。";
  } else {
    executeLine = "执行：本代理执行。工具表允许 sessions_spawn，但尚未发起子代理。";
  }

  if (draftComplete && !aligned) {
    failedStep = "accept";
  }

  const acceptLine = aligned
    ? `验收对照：对照验收句「${acceptance}」，交付一致。`
    : failedStep === "accept"
      ? `验收对照：对照验收句「${acceptance}」对不上。失败步骤：验收。不交付成稿。`
      : `验收对照：对照验收句「${acceptance}」。尚未核对通过，不把未核对的内容当成完成稿。`;

  const edges = targets.map((target) => edgeDirective(target, acceptance));
  const report = [
    `理解：当前任务「${title}」（类别 ${relationLabel(relation)}）。`,
    `计划：1. 确认当前任务范围 2. 完成本步可见结果 3. 对照验收后再回复。验收句：${acceptance}`,
    executeLine,
    acceptLine,
    ...edges,
  ].join("\n");

  let deliverableChecked = false;
  if (aligned && input.sessionFile?.trim()) {
    const recorded = recordCheckedTaskCompletion({
      sessionFile: input.sessionFile,
      closed: true,
    });
    deliverableChecked = recorded.persisted || Boolean(recorded.notice);
  }

  return {
    admitted: true,
    payloads: failedStep ? [{ text: report }] : appendReport(payloads, report),
    deliverableChecked,
    ...(failedStep ? { failedStep } : {}),
    wroteEvolutionProposal: false,
  };
}

function appendReport(
  payloads: ComplexTaskReplyPayload[],
  report: string,
): ComplexTaskReplyPayload[] {
  const copy = payloads.map((payload) => ({
    ...payload,
    ...(typeof payload.text === "string" ? { text: stripEdgeMarkers(payload.text) } : {}),
  }));
  const visible = copy.filter((payload) => {
    const text = payload.text?.trim() ?? "";
    return text.length > 0 && text !== "NO_REPLY";
  });
  if (visible.length === 0) {
    return [{ text: report }];
  }
  const last = visible[visible.length - 1];
  if (!last) {
    return [{ text: report }];
  }
  last.text = `${last.text?.trim() ?? ""}\n\n${report}`;
  return copy.filter((payload) => (payload.text?.trim() ?? "") !== "NO_REPLY");
}

export function shapeAdmittedComplexTaskReply<T extends ComplexTaskReplyPayload>(params: {
  payloads: T[];
  userText: string;
  tenantId?: string | null;
  surface: "group" | "direct";
  fromAgentId?: string | null;
  sessionFile?: string | null;
  sessionKey?: string;
  cfg?: OpenBotConfig;
  disableTools?: boolean;
  currentGoal?: string;
  env?: NodeJS.ProcessEnv;
}): T[] {
  try {
    const toolNames = orchestrationToolNames({
      cfg: params.cfg,
      sessionKey: params.sessionKey,
      disableTools: params.disableTools,
    });
    const shaped = applyComplexTaskLoop({
      userText: params.userText,
      tenantId: params.tenantId,
      surface: params.surface,
      fromAgentId: params.fromAgentId,
      toolNames,
      payloads: params.payloads,
      currentGoal: params.currentGoal,
      sessionFile: params.sessionFile,
      env: params.env ?? process.env,
    });
    if (!shaped.admitted) {
      return params.payloads;
    }
    return shaped.payloads as T[];
  } catch {
    return params.payloads;
  }
}
