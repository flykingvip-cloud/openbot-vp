import { describe, expect, it } from "vitest";
import {
  buildCronEventPrompt,
  buildExecEventPrompt,
  isExecCompletionEvent,
  isExecEventPromptMessage,
  isInternalExecEventPromptText,
  omitInternalExecEventTurns,
} from "./heartbeat-events-filter.js";

describe("heartbeat event classification", () => {
  it("recognizes runtime exec completion copy, not just the test phrase", () => {
    expect(isExecCompletionEvent("exec finished: backup completed")).toBe(true);
    expect(isExecCompletionEvent("Exec completed (abc12345, code 0) :: ok")).toBe(true);
    expect(isExecCompletionEvent("Exec failed (abc12345, code 1)")).toBe(true);
    expect(isExecCompletionEvent("Notification posted (node=phone key=mail)")).toBe(false);
    expect(isExecCompletionEvent("Cron: rotate logs")).toBe(false);
  });
});

describe("heartbeat event prompts", () => {
  it("builds user-relay cron prompt by default", () => {
    const prompt = buildCronEventPrompt(["Cron: rotate logs"]);
    expect(prompt).toContain("Please relay this reminder to the user");
  });

  it("builds internal-only cron prompt when delivery is disabled", () => {
    const prompt = buildCronEventPrompt(["Cron: rotate logs"], { deliverToUser: false });
    expect(prompt).toContain("Handle this reminder internally");
    expect(prompt).not.toContain("Please relay this reminder to the user");
  });

  it("builds internal-only exec prompt when delivery is disabled", () => {
    const prompt = buildExecEventPrompt({ deliverToUser: false });
    expect(prompt).toContain("Handle the result internally");
    expect(prompt).not.toContain("Please relay the command output to the user");
  });

  it("omits an internal exec-event prompt and the assistant turn it induced", () => {
    const prompt = buildExecEventPrompt({ deliverToUser: false });
    const messages = [
      { role: "assistant", content: "方案 A / 方案 B / 方案 C" },
      { role: "user", content: prompt },
      { role: "assistant", content: "文章核心是：唐杰团队…" },
      { role: "user", content: "方案b" },
    ];
    expect(isInternalExecEventPromptText(prompt)).toBe(true);
    expect(isExecEventPromptMessage(messages[1])).toBe(true);
    expect(omitInternalExecEventTurns(messages)).toEqual([
      { role: "assistant", content: "方案 A / 方案 B / 方案 C" },
      { role: "user", content: "方案b" },
    ]);
  });

  it("keeps a user-relay exec completion assistant reply", () => {
    const prompt = buildExecEventPrompt({ deliverToUser: true });
    const messages = [
      { role: "user", content: prompt },
      { role: "assistant", content: "命令已完成：测试通过。" },
    ];
    expect(omitInternalExecEventTurns(messages)).toEqual(messages);
  });
});
