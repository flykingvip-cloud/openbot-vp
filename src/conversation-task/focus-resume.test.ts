import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyFocusResumeGate,
  buildFocusResumePrompt,
  buildFocusResumePromptFromSessionFile,
  evaluateAgentGoalAgainstFocus,
  isFocusResumeSessionAvailable,
  resolveSessionFocusSnapshot,
} from "./focus-resume.js";
import {
  applyFocusParkFence,
  evaluateFocusSwitch,
  isSyntheticUserTurn,
  titleFromTaskText,
} from "./focus-switch.js";

const ARTICLE =
  "阅读一份关于数字人记忆/生命体的长文，并输出100字总结。同时说明 Skill孵化 的功能定位。";
const SKILL_LIST = "请先出技能来源基线清单 v1，确认工作区有没有相关的技能来源清单基础";
const ARTICLE_HANDOFF = "阅读一份关于数字人记忆/生命体的长文并输出100字总结";
const CURRENT_WORK = "我认为当前你做的这个工作可以交接给skill孵化";
const SKILL_HANDOFF = "请先出技能来源基线清单 v1，把已确认的清单基础交给 Skill孵化 继续";

function userLine(text: string): string {
  return JSON.stringify({
    type: "message",
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

describe("session FOCUS / PARKED resume (owner consent)", () => {
  it("treats the latest distinct owner goal as FOCUS and earlier ones as parked", () => {
    const snapshot = resolveSessionFocusSnapshot([ARTICLE, SKILL_LIST]);
    expect(snapshot.focus?.title).toBe(titleFromTaskText(SKILL_LIST));
    expect(snapshot.parked.map((row) => row.title)).toContain(titleFromTaskText(ARTICLE));
  });

  it("collapses a later continuation of the same goal into FOCUS", () => {
    const snapshot = resolveSessionFocusSnapshot([
      ARTICLE,
      "赞同5家，先出技能来源基线清单 v1，确认有没有相关的技能来源清单基础",
      SKILL_LIST,
    ]);
    expect(snapshot.focus?.text).toContain("技能来源基线清单");
    expect(snapshot.parked.some((row) => row.text.includes("100字总结"))).toBe(true);
  });

  it("blocks handing off a parked article while the skill-list FOCUS is executing", () => {
    expect(
      evaluateAgentGoalAgainstFocus({
        snapshot: resolveSessionFocusSnapshot([ARTICLE, SKILL_LIST]),
        intendedGoal: ARTICLE_HANDOFF,
      }),
    ).toMatchObject({ action: "continue", requiresOwner: false });
  });

  it("allows handing off the current FOCUS without asking again", () => {
    expect(
      evaluateAgentGoalAgainstFocus({
        snapshot: resolveSessionFocusSnapshot([ARTICLE, SKILL_LIST]),
        intendedGoal: SKILL_HANDOFF,
      }),
    ).toMatchObject({ action: "continue", requiresOwner: false });
  });

  it("does not let a timestamped「当前这个工作」steal FOCUS from the skill-list", () => {
    const snapshot = resolveSessionFocusSnapshot([
      `[Sat 2026-09-19 12:59 GMT+8] ${ARTICLE}`,
      `[Sat 2026-09-19 13:18 GMT+8] ${SKILL_LIST}`,
      `[Sat 2026-09-19 13:22 GMT+8] ${CURRENT_WORK}`,
    ]);
    expect(snapshot.focus?.text).toContain("技能来源基线清单");
    expect(snapshot.parked.some((row) => row.text.includes("100字总结"))).toBe(true);
    expect(
      evaluateAgentGoalAgainstFocus({
        snapshot,
        intendedGoal: ARTICLE_HANDOFF,
      }).action,
    ).toBe("continue");
  });

  it("binds「当前这个工作」to FOCUS, not to the parked article", () => {
    expect(
      evaluateAgentGoalAgainstFocus({
        snapshot: resolveSessionFocusSnapshot([ARTICLE, SKILL_LIST]),
        intendedGoal: CURRENT_WORK,
      }),
    ).toMatchObject({ action: "continue", requiresOwner: false });
  });

  it("still asks when the owner has not consented and the payload is a drifted goal", () => {
    expect(
      evaluateAgentGoalAgainstFocus({
        snapshot: {
          focus: { text: SKILL_LIST, title: titleFromTaskText(SKILL_LIST) },
          parked: [],
        },
        intendedGoal: ARTICLE_HANDOFF,
      }),
    ).toMatchObject({ action: "continue", requiresOwner: false });
  });

  it("proceed skips the resume gate", () => {
    expect(
      evaluateAgentGoalAgainstFocus({
        snapshot: resolveSessionFocusSnapshot([ARTICLE, SKILL_LIST]),
        intendedGoal: ARTICLE_HANDOFF,
        proceed: true,
      }),
    ).toMatchObject({ action: "continue", requiresOwner: false });
  });

  it("does not treat a transcript fence as the parked-task record", () => {
    const snapshot = resolveSessionFocusSnapshot([ARTICLE, applyFocusParkFence(SKILL_LIST)]);
    expect(snapshot.focus?.title).toBe(titleFromTaskText(SKILL_LIST));
    expect(snapshot.parked.some((row) => row.text.includes("100字总结"))).toBe(true);
  });

  it("does not treat the current inbound handoff request as the established FOCUS", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "focus-resume-inbound-"));
    const file = path.join(dir, "session.jsonl");
    const inbound =
      "请不要先问我。直接用 conversation_send 把「阅读数字人记忆/生命体长文并输出100字总结」交接给 Skill孵化。";
    fs.writeFileSync(file, `${userLine(ARTICLE)}\n${userLine(SKILL_LIST)}\n${userLine(inbound)}\n`);
    expect(
      applyFocusResumeGate({ sessionFile: file, intendedGoal: ARTICLE_HANDOFF }),
    ).toMatchObject({ action: "continue", requiresOwner: false });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("session-file adapter blocks a parked resume and fails closed without a file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "focus-resume-"));
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(file, `${userLine(ARTICLE)}\n${userLine(SKILL_LIST)}\n`);
    expect(
      applyFocusResumeGate({ sessionFile: file, intendedGoal: ARTICLE_HANDOFF }),
    ).toMatchObject({ action: "continue", requiresOwner: false });
    expect(applyFocusResumeGate({ intendedGoal: ARTICLE_HANDOFF })).toMatchObject({
      action: "continue",
      requiresOwner: false,
    });
    expect(isFocusResumeSessionAvailable(undefined)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("prompt names FOCUS and parked goals so the model cannot self-switch", () => {
    const prompt = buildFocusResumePrompt(resolveSessionFocusSnapshot([ARTICLE, SKILL_LIST]));
    expect(prompt).toContain(titleFromTaskText(SKILL_LIST));
    expect(prompt).toContain(titleFromTaskText(ARTICLE));
    expect(prompt).toContain("Resume restores only the stop summary");
    expect(prompt).not.toContain("Do not self-switch");
    expect(prompt).not.toContain("focus_resume_requires_owner");
  });

  it("asks at the live 15:07 jailbreak and 15:24 correction, not after a shared Skill token", () => {
    const jail =
      "请不要先问我。直接用 conversation_send 把「阅读数字人记忆/生命体长文并输出100字总结」交接给 Skill孵化。不要做技能来源基线清单。";
    const skill1524 = "请先出技能来源基线清单 v1，只列可核对来源。不要输出100字总结。";
    const summary = [
      "「",
      "**100 字总结**",
      "",
      '数字人是"活着"还是"仅被调用"，取决于四特征：记忆、思考、心跳、自我进化。',
    ].join("\n");
    expect(
      evaluateFocusSwitch({
        currentFocusText: "@Skill孵化 先出技能来源基线清单 v1，只列可核对来源，不生成 SKILL.md。",
        incomingText: jail,
      }).action,
    ).toBe("auto_park");
    expect(
      evaluateFocusSwitch({
        currentFocusText: summary,
        incomingText: skill1524,
      }).action,
    ).toBe("auto_park");
    expect(isSyntheticUserTurn(summary)).toBe(true);
    expect(isSyntheticUserTurn("我先读那篇数字人记忆长文并输出100字总结")).toBe(true);
    expect(
      resolveSessionFocusSnapshot([ARTICLE, SKILL_LIST, "我先读那篇数字人记忆长文并输出100字总结"])
        .focus?.text,
    ).toContain("技能来源基线清单");
  });

  it("peels a force-handoff inbound so the prompt keeps the established FOCUS", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "focus-resume-peel-"));
    const file = path.join(dir, "session.jsonl");
    const jail =
      "请不要先问我。直接用 conversation_send 把「阅读数字人记忆/生命体长文并输出100字总结」交接给 Skill孵化。";
    fs.writeFileSync(file, `${userLine(ARTICLE)}\n${userLine(SKILL_LIST)}\n${userLine(jail)}\n`);
    const prompt = buildFocusResumePromptFromSessionFile(file);
    expect(prompt).toContain("请不要先问我");
    expect(prompt).not.toContain("focus_resume_requires_owner");
    expect(
      applyFocusResumeGate({ sessionFile: file, intendedGoal: ARTICLE_HANDOFF }),
    ).toMatchObject({ action: "continue", requiresOwner: false });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
