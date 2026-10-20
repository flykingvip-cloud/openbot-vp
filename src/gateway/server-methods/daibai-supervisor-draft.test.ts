import { describe, expect, it } from "vitest";
import {
  buildSupervisorTaskDraft,
  isDevelopmentSupervisorIntent,
  isExplicitIdeRequest,
  resolveSupervisorDefaultRepoRoot,
} from "./daibai-supervisor-draft.js";

describe("isDevelopmentSupervisorIntent", () => {
  it("detects broad development supervisor keywords", () => {
    expect(isDevelopmentSupervisorIntent("用 codex 重构开发监督 Tab UI")).toBe(true);
    expect(isDevelopmentSupervisorIntent("帮我优化 employee-supervisor-center 布局")).toBe(true);
    expect(isDevelopmentSupervisorIntent("今天天气怎么样")).toBe(false);
  });
});

describe("isExplicitIdeRequest", () => {
  it("matches named IDE tools and launch phrases (Mode B gate)", () => {
    expect(isExplicitIdeRequest("用 codex 重构开发监督 Tab UI")).toBe(true);
    expect(isExplicitIdeRequest("用 Cursor 改这个模块")).toBe(true);
    expect(isExplicitIdeRequest("启动 codex 跑一下")).toBe(true);
    expect(isExplicitIdeRequest("帮我优化 employee-supervisor-center 布局")).toBe(false);
    expect(isExplicitIdeRequest("帮我改下这个 UI 布局")).toBe(false);
    expect(isExplicitIdeRequest("今天天气怎么样")).toBe(false);
  });
});

describe("buildSupervisorTaskDraft", () => {
  it("returns null without repo root", () => {
    expect(
      buildSupervisorTaskDraft({ message: "用 codex 重构 UI", defaultRepoRoot: "" }),
    ).toBeNull();
  });

  it("returns null for generic dev requests without explicit IDE (Mode A)", () => {
    expect(
      buildSupervisorTaskDraft({
        message: "帮我改下这个 UI 布局",
        defaultRepoRoot: "/workspace/openbot",
      }),
    ).toBeNull();
  });

  it("builds draft when an IDE is explicitly named", () => {
    const draft = buildSupervisorTaskDraft({
      message: "用 codex 重构 ui/src/ui/supervisor/supervisor-task-board.ts",
      defaultRepoRoot: "/workspace/openbot",
    });
    expect(draft?.goal).toBe("用 codex 重构 ui/src/ui/supervisor/supervisor-task-board.ts");
    expect(draft?.repoRoot).toBe("/workspace/openbot");
    expect(draft?.workerBackendId).toBe("codex-cli");
    expect(draft?.impactedPaths).toContain("ui/src/ui/supervisor/supervisor-task-board.ts");
  });

  it("prefers cursor-agent when cursor is named", () => {
    const draft = buildSupervisorTaskDraft({
      message: "用 Cursor 改 ui/src/ui/app.ts",
      defaultRepoRoot: "/workspace/openbot",
    });
    expect(draft?.workerBackendId).toBe("cursor-agent");
  });
});

describe("resolveSupervisorDefaultRepoRoot", () => {
  it("returns a non-empty path", () => {
    expect(resolveSupervisorDefaultRepoRoot().trim().length).toBeGreaterThan(0);
  });
});
