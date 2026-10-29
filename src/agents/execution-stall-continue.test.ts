import { describe, expect, it } from "vitest";
import {
  dropContinuedStallText,
  dropSupersededStallTexts,
  executionContinueKind,
  lastAssistantStopKind,
  lastAssistantStopText,
  shouldContinueAfterEmptyToolFinal,
  shouldContinueAfterExecutionStall,
  isSoftConfirmAfterAuthorizedGo,
} from "./execution-stall-continue.js";
import { PROTOCOL_FAILURE_USER_TEXT } from "./model-output-boundary.js";

const STALL = "正在收尾排版，稍等片刻。";

describe("execution stall continuation", () => {
  it("continues a tools-enabled stop on the WeChat holding line", () => {
    expect(shouldContinueAfterExecutionStall({ text: STALL, toolsDisabled: false })).toBe(true);
  });

  it("does not continue when tools are disabled or the reply is a real result", () => {
    expect(shouldContinueAfterExecutionStall({ text: STALL, toolsDisabled: true })).toBe(false);
    expect(
      shouldContinueAfterExecutionStall({
        text: "草稿已写入，mediaId=abc。",
        toolsDisabled: false,
      }),
    ).toBe(false);
  });

  it("reads only the latest assistant stop", () => {
    expect(
      lastAssistantStopText([
        { role: "assistant", stopReason: "stop", content: [{ type: "text", text: STALL }] },
        { role: "user", content: "开始排版和发布这篇文章到公众号" },
        {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "草稿已写入。" }],
        },
      ]),
    ).toBe("草稿已写入。");
  });

  it("ignores a latest tool-use or error stop", () => {
    expect(
      lastAssistantStopText([
        {
          role: "assistant",
          stopReason: "toolUse",
          content: [
            { type: "text", text: STALL },
            { type: "toolCall", name: "exec" },
          ],
        },
      ]),
    ).toBe("");
    expect(
      lastAssistantStopText([
        { role: "assistant", stopReason: "error", content: [{ type: "text", text: STALL }] },
      ]),
    ).toBe("");
  });

  it("drops the wait line from payloads only after a real continuation", () => {
    const texts = [STALL, "草稿已写入，mediaId=abc。"];
    dropContinuedStallText(texts, STALL);
    expect(texts).toEqual(["草稿已写入，mediaId=abc。"]);
  });

  it("allows a second progress-only continue and stops at the limit", () => {
    expect(executionContinueKind({ text: STALL, toolsDisabled: false, continuesUsed: 0 })).toBe(
      "progress-stall",
    );
    expect(
      executionContinueKind({ text: "马上就好。", toolsDisabled: false, continuesUsed: 1 }),
    ).toBe("progress-stall");
    expect(
      executionContinueKind({ text: STALL, toolsDisabled: false, continuesUsed: 2 }),
    ).toBeNull();
  });

  it("continues a soft 请确认 once when the user already said go", () => {
    const ask = "请确认后我再开始排版。";
    expect(
      shouldContinueAfterExecutionStall({
        text: ask,
        toolsDisabled: false,
        latestUserText: "开始排版和发布这篇文章到公众号",
      }),
    ).toBe(true);
    expect(
      executionContinueKind({
        text: ask,
        toolsDisabled: false,
        latestUserText: "开始排版和发布这篇文章到公众号",
        falseConfirmContinuesUsed: 1,
      }),
    ).toBeNull();
  });

  it("keeps price, scan, payment, auth, and cover confirms terminal", () => {
    const user = "开始排版和发布这篇文章到公众号";
    for (const text of [
      "请确认封面标题后再写入草稿箱。",
      "已经到收银台了，请扫码支付。",
      "请确认规格和价格后再下单。",
      "请确认授权后再发布。",
      "请确认发到哪个公众号？",
    ]) {
      expect(
        shouldContinueAfterExecutionStall({ text, toolsDisabled: false, latestUserText: user }),
      ).toBe(false);
    }
    expect(
      shouldContinueAfterExecutionStall({
        text: "请确认后我再排版。",
        toolsDisabled: false,
        latestUserText: "你好",
      }),
    ).toBe(false);
  });

  it("continues once after a successful tool when the final is empty and unfinished", () => {
    expect(
      lastAssistantStopKind([{ role: "assistant", stopReason: "stop", content: "NO_REPLY" }]),
    ).toBe("empty");
    expect(
      shouldContinueAfterEmptyToolFinal({
        stopKind: "empty",
        toolsDisabled: false,
        tools: [{ toolName: "read", success: true, meta: "notes.md" }],
      }),
    ).toBe(true);
    expect(
      shouldContinueAfterEmptyToolFinal({
        stopKind: "empty",
        toolsDisabled: false,
        continuesUsed: 1,
        tools: [{ toolName: "read", success: true, meta: "notes.md" }],
      }),
    ).toBe(false);
  });

  it("continues once after a failed browser/computer tool when the final is empty", () => {
    expect(
      shouldContinueAfterEmptyToolFinal({
        stopKind: "empty",
        toolsDisabled: false,
        tools: [
          {
            toolName: "browser",
            success: false,
            meta: "云电脑没有启动：docker create failed",
          },
        ],
      }),
    ).toBe(true);
    expect(
      shouldContinueAfterEmptyToolFinal({
        stopKind: "empty",
        toolsDisabled: false,
        continuesUsed: 1,
        tools: [{ toolName: "browser", success: false, meta: "create failed" }],
      }),
    ).toBe(false);
  });

  it("keeps honest-empty when no tool succeeded or a draft result already exists", () => {
    expect(
      shouldContinueAfterEmptyToolFinal({
        stopKind: "empty",
        toolsDisabled: false,
        tools: [],
      }),
    ).toBe(false);
    expect(
      shouldContinueAfterEmptyToolFinal({
        stopKind: "empty",
        toolsDisabled: false,
        tools: [{ toolName: "exec", success: false, meta: "failed" }],
      }),
    ).toBe(false);
    expect(
      shouldContinueAfterEmptyToolFinal({
        stopKind: "empty",
        toolsDisabled: false,
        tools: [{ toolName: "user_operational_identity", success: true, meta: "mediaId=abc" }],
      }),
    ).toBe(false);
    expect(
      shouldContinueAfterEmptyToolFinal({
        stopKind: "text",
        toolsDisabled: false,
        tools: [{ toolName: "read", success: true, meta: "notes.md" }],
      }),
    ).toBe(false);
  });

  it("continues once in a silent-exec window and keeps a two-SKU fork terminal", () => {
    const user = "沙箱已经具备 Playwright 和 Node 20 这个条件了，请继续尝试";
    const fishing = "绑定方向是微信运营身份还是邮箱？评审对象是哪份材料？";
    expect(
      executionContinueKind({
        text: fishing,
        toolsDisabled: false,
        latestUserText: user,
      }),
    ).toBe("silent-exec");
    expect(
      executionContinueKind({
        text: fishing,
        toolsDisabled: false,
        latestUserText: user,
        silentExecContinuesUsed: 1,
      }),
    ).toBeNull();
    expect(
      executionContinueKind({
        text: "有两种规格，请选规格 A 还是规格 B。",
        toolsDisabled: false,
        latestUserText: "请继续",
      }),
    ).toBeNull();
  });

  it("drops earlier wait lines and keeps the latest one when the turn is still stalled", () => {
    const texts = [STALL, "马上就好。"];
    dropSupersededStallTexts(texts, [STALL, "马上就好。"], "马上就好。");
    expect(texts).toEqual(["马上就好。"]);
  });
});

describe("recoverable-tool-failure continue", () => {
  it("classifies protocol failure after path_missing as recoverable-tool-failure", () => {
    expect(
      executionContinueKind({
        text: PROTOCOL_FAILURE_USER_TEXT,
        toolsDisabled: false,
        tools: [{ toolName: "exec", success: false, meta: "cd: /x: No such file or directory" }],
      }),
    ).toBe("recoverable-tool-failure");
  });

  it("continues soft 「用这张」 cover-reuse even when assistant mentions 封面", () => {
    const ask = "我打算改用你发来的那张 PNG 当封面再推一次，请回复「用这张」，我就立刻继续。";
    expect(isSoftConfirmAfterAuthorizedGo(ask, "请发送")).toBe(true);
    expect(
      shouldContinueAfterExecutionStall({
        text: ask,
        toolsDisabled: false,
        latestUserText: "请发送",
      }),
    ).toBe(true);
    // 「请确认封面标题」 stays terminal (content-hard, no 用这张).
    expect(
      shouldContinueAfterExecutionStall({
        text: "请确认封面标题后再写入草稿箱。",
        toolsDisabled: false,
        latestUserText: "开始排版和发布这篇文章到公众号",
      }),
    ).toBe(false);
  });

  it("soft ask without waiting_confirmation continues after authorized go", () => {
    expect(isSoftConfirmAfterAuthorizedGo("要不要推草稿箱？", "开始排版并写进草稿箱")).toBe(true);
    expect(
      isSoftConfirmAfterAuthorizedGo(
        "状态：waiting_confirmation，请确认是否推送",
        "开始排版并写进草稿箱",
      ),
    ).toBe(false);
  });
});
