import { describe, expect, it } from "vitest";
import { hostNamedFileExecutionRequest } from "./named-file-execution.js";

describe("hostNamedFileExecutionRequest", () => {
  it("admits a Chinese make request that names a markdown file", () => {
    const message = "请制作一份入职清单，文件名为 onboarding-checklist.md";
    expect(hostNamedFileExecutionRequest(message)).toEqual({
      goal: message,
      acceptance: ["交付文件 onboarding-checklist.md"],
    });
  });

  it("admits an English create request with an explicit filename", () => {
    const message = "Create a markdown file named onboarding-checklist.md";
    expect(hostNamedFileExecutionRequest(message)).toEqual({
      goal: message,
      acceptance: ["交付文件 onboarding-checklist.md"],
    });
  });

  it("leaves chat, bare mentions, and unnamed work on the prose path", () => {
    expect(hostNamedFileExecutionRequest("你好，请告诉我今天是星期几")).toBeNull();
    expect(hostNamedFileExecutionRequest("刚才的回答请压缩成一句话。")).toBeNull();
    expect(hostNamedFileExecutionRequest("请制作一份报告")).toBeNull();
    expect(hostNamedFileExecutionRequest("onboarding-checklist.md 里写了什么")).toBeNull();
    expect(hostNamedFileExecutionRequest("文件名为 onboarding-checklist.md")).toBeNull();
  });
});
