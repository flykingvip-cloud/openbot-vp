import { describe, expect, it } from "vitest";
import { PROTOCOL_FAILURE_USER_TEXT } from "./model-output-boundary.js";
import {
  classifyRecoverableToolFailure,
  enrichPathMissingToolError,
  RECOVERABLE_TOOL_FAILURE_CONTINUE_LIMIT,
  shouldContinueAfterRecoverableToolFailure,
} from "./recoverable-tool-failure.js";

describe("classifyRecoverableToolFailure", () => {
  it("classifies sandbox_runtime", () => {
    expect(
      classifyRecoverableToolFailure(
        "Sandbox mode requires Docker, but the docker CLI was not found",
      ),
    ).toBe("sandbox_runtime");
    expect(
      classifyRecoverableToolFailure(
        "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
      ),
    ).toBe("sandbox_runtime");
  });

  it("classifies path_missing", () => {
    expect(classifyRecoverableToolFailure("cd: /tmp/missing: No such file or directory")).toBe(
      "path_missing",
    );
    expect(classifyRecoverableToolFailure("ENOENT: no such file or directory, open 'x.pptx'")).toBe(
      "path_missing",
    );
  });

  it("classifies export_empty", () => {
    expect(classifyRecoverableToolFailure("export empty: pptx size=0 bytes")).toBe("export_empty");
    expect(classifyRecoverableToolFailure("产物为空，请检查模板")).toBe("export_empty");
  });

  it("returns null for unrelated errors", () => {
    expect(classifyRecoverableToolFailure("permission denied")).toBeNull();
    expect(classifyRecoverableToolFailure("")).toBeNull();
  });

  it("returns null for permanent permission / args / account failures", () => {
    expect(classifyRecoverableToolFailure("bash: /x: Permission denied")).toBeNull();
    expect(classifyRecoverableToolFailure("EACCES: permission denied, open '/secret'")).toBeNull();
    expect(classifyRecoverableToolFailure("Error: invalid argument: --foo")).toBeNull();
    expect(
      classifyRecoverableToolFailure(
        "Managed multitenant sandbox requires a server-derived account (tenantId + userId).",
      ),
    ).toBeNull();
    expect(
      classifyRecoverableToolFailure("cron_account:missing Managed multitenant sandbox requires"),
    ).toBeNull();
    // Permanent phrase wins even when path_missing wording is also present.
    expect(
      classifyRecoverableToolFailure("Permission denied: No such file or directory"),
    ).toBeNull();
  });
});

describe("enrichPathMissingToolError", () => {
  it("appends workspace_root once", () => {
    const once = enrichPathMissingToolError({
      errorText: "cd: foo: No such file or directory",
      workspaceRoot: "/ws/agent",
    });
    expect(once).toContain("workspace_root=/ws/agent");
    const twice = enrichPathMissingToolError({
      errorText: once,
      workspaceRoot: "/ws/agent",
    });
    expect(twice).toBe(once);
  });

  it("skips when root missing", () => {
    expect(
      enrichPathMissingToolError({
        errorText: "cd: foo: No such file or directory",
        workspaceRoot: "  ",
      }),
    ).toBe("cd: foo: No such file or directory");
  });

  it("rejects relative or traversal workspace roots", () => {
    expect(
      enrichPathMissingToolError({
        errorText: "cd: foo: No such file or directory",
        workspaceRoot: "relative/ws",
      }),
    ).toBe("cd: foo: No such file or directory");
    expect(
      enrichPathMissingToolError({
        errorText: "cd: foo: No such file or directory",
        workspaceRoot: "/ws/../etc",
      }),
    ).toBe("cd: foo: No such file or directory");
  });
});

describe("shouldContinueAfterRecoverableToolFailure", () => {
  it("continues on protocol-failure copy after path_missing tool", () => {
    expect(
      shouldContinueAfterRecoverableToolFailure({
        stopText: PROTOCOL_FAILURE_USER_TEXT,
        toolsDisabled: false,
        tools: [{ toolName: "exec", success: false, meta: "cd: /x: No such file or directory" }],
      }),
    ).toBe(true);
  });

  it("continues on 请重试 after export_empty", () => {
    expect(
      shouldContinueAfterRecoverableToolFailure({
        stopText: "导出失败，请重试。",
        toolsDisabled: false,
        tools: [{ toolName: "pptx_export", success: false, meta: "export empty size=0" }],
      }),
    ).toBe(true);
  });

  it("respects continue limit", () => {
    expect(
      shouldContinueAfterRecoverableToolFailure({
        stopText: PROTOCOL_FAILURE_USER_TEXT,
        toolsDisabled: false,
        continuesUsed: RECOVERABLE_TOOL_FAILURE_CONTINUE_LIMIT,
        tools: [{ toolName: "exec", success: false, meta: "ENOENT" }],
      }),
    ).toBe(false);
  });

  it("skips when tools disabled", () => {
    expect(
      shouldContinueAfterRecoverableToolFailure({
        stopText: PROTOCOL_FAILURE_USER_TEXT,
        toolsDisabled: true,
        tools: [{ toolName: "exec", success: false, meta: "ENOENT" }],
      }),
    ).toBe(false);
  });

  it("does not continue from stop-text guess when tools ran without recoverable failure", () => {
    expect(
      shouldContinueAfterRecoverableToolFailure({
        stopText: "Sandbox mode requires Docker, but the docker CLI was not found — 请重试",
        toolsDisabled: false,
        tools: [{ toolName: "exec", success: false, meta: "permission denied" }],
      }),
    ).toBe(false);
  });

  it("does not continue on permanent account-missing tool meta", () => {
    expect(
      shouldContinueAfterRecoverableToolFailure({
        stopText: PROTOCOL_FAILURE_USER_TEXT,
        toolsDisabled: false,
        tools: [
          {
            toolName: "exec",
            success: false,
            meta: "Managed multitenant sandbox requires a server-derived account",
          },
        ],
      }),
    ).toBe(false);
  });
});
