import { describe, expect, it, vi } from "vitest";
import {
  DIAGNOSIS_CONVERSATION_ACTION_EVENT,
  dispatchDiagnosisConversationAction,
  parseDiagnoseConversationActions,
  parseDiagnoseReportActions,
  readDiagnosisConversationAction,
} from "./diagnosis-conversation-action.ts";

const REPORT = [
  "【诊断报告】",
  "八、可执行建议",
  "[补当日记忆]",
  "执行者：被诊断数字人",
  "通道：数字人会话",
  "会话：agent:bot-2:main",
  "任务：请把今日要点写入 memory/ 当日文件。",
].join("\n");

describe("diagnosis conversation action", () => {
  it("parses section-8 chips and ignores ordinary task lines", () => {
    expect(parseDiagnoseReportActions(REPORT)).toEqual([
      {
        title: "补当日记忆",
        prompt: "请把今日要点写入 memory/ 当日文件。",
        handoffChannel: "diagnosed_agent_session",
        targetSessionKey: "agent:bot-2:main",
        targetAgentId: "bot-2",
      },
    ]);
    expect(parseDiagnoseConversationActions(REPORT)).toHaveLength(1);
    expect(parseDiagnoseConversationActions("任务：请让市场助手补记忆。")).toEqual([]);
  });

  it("dispatches a composed 1:1 handoff event", () => {
    const host = new EventTarget();
    const listener = vi.fn();
    host.addEventListener(DIAGNOSIS_CONVERSATION_ACTION_EVENT, listener);
    dispatchDiagnosisConversationAction(
      host,
      {
        title: "补当日记忆",
        prompt: "请把今日要点写入 memory/ 当日文件。",
        handoffChannel: "diagnosed_agent_session",
        targetSessionKey: "agent:bot-2:main",
        targetAgentId: "bot-2",
      },
      "chat",
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readDiagnosisConversationAction(listener.mock.calls[0]?.[0] as Event)).toEqual({
      title: "补当日记忆",
      prompt: "请把今日要点写入 memory/ 当日文件。",
      handoffChannel: "diagnosed_agent_session",
      targetSessionKey: "agent:bot-2:main",
      targetAgentId: "bot-2",
      source: "chat",
    });
  });
});
