import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SHARED_FS_RESOURCE_OWNER,
  assertSharedFsExecMutationAllowed,
  extractExecFilesystemMutationTargets,
  isSafeSystemDevicePath,
  stripShellHeredocBodies,
  wouldWriteDenyPath,
} from "./shared-fs-resource-policy.js";

describe("shared-fs-resource-policy", () => {
  const workspaceRoot = path.join(os.tmpdir(), "openbot-shared-fs-ws");

  it("exports stable shared owner id", () => {
    expect(SHARED_FS_RESOURCE_OWNER).toBe("shared-fs-resource");
  });

  it("wouldWriteDenyPath matches outside vs inside workspace", () => {
    expect(wouldWriteDenyPath("/tmp/outside-openbot-f5.txt", workspaceRoot)).toBe(true);
    expect(wouldWriteDenyPath(path.join(workspaceRoot, "inside.txt"), workspaceRoot)).toBe(false);
  });

  it("extracts redirection and tee mutation targets", () => {
    const outside = "/tmp/openbot-f5-extract.txt";
    const targets = extractExecFilesystemMutationTargets(
      `printf 'x\\n' > ${outside}`,
      workspaceRoot,
    );
    expect(targets).toContain(path.resolve(outside));

    const teeTargets = extractExecFilesystemMutationTargets(
      `printf 'x\\n' | tee ${outside}`,
      workspaceRoot,
    );
    expect(teeTargets).toContain(path.resolve(outside));
  });

  it("assert no-ops when workspaceOnly=false", () => {
    expect(() =>
      assertSharedFsExecMutationAllowed({
        command: "printf 'x\\n' > /tmp/should-allow-when-flag-off.txt",
        workdir: workspaceRoot,
        workspaceRoot,
        workspaceOnly: false,
      }),
    ).not.toThrow();
  });

  it("assert denies outside-workspace redirection when workspaceOnly=true", () => {
    expect(() =>
      assertSharedFsExecMutationAllowed({
        command: "printf 'x\\n' > /tmp/openbot-f5-deny.txt",
        workdir: workspaceRoot,
        workspaceRoot,
        workspaceOnly: true,
      }),
    ).toThrow(/exec denied: shared-fs-resource intersect/);
  });

  it("assert allows in-workspace relative redirection when workspaceOnly=true", () => {
    expect(() =>
      assertSharedFsExecMutationAllowed({
        command: "printf 'ok\\n' > ./inside.txt",
        workdir: workspaceRoot,
        workspaceRoot,
        workspaceOnly: true,
      }),
    ).not.toThrow();
  });

  it("treats /dev/null and stdio device sinks as safe outside workspace", () => {
    expect(isSafeSystemDevicePath("/dev/null")).toBe(true);
    expect(isSafeSystemDevicePath("/dev/stdout")).toBe(true);
    expect(isSafeSystemDevicePath("/dev/stderr")).toBe(true);
    expect(isSafeSystemDevicePath("/tmp/outside.txt")).toBe(false);
  });

  it("assert allows /dev/null redirects when workspaceOnly=true", () => {
    expect(() =>
      assertSharedFsExecMutationAllowed({
        command: "ls -la 2>/dev/null",
        workdir: workspaceRoot,
        workspaceRoot,
        workspaceOnly: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertSharedFsExecMutationAllowed({
        command: "printf 'x\\n' >/dev/null",
        workdir: workspaceRoot,
        workspaceRoot,
        workspaceOnly: true,
      }),
    ).not.toThrow();
  });

  it("assert still denies real outside-workspace writes when workspaceOnly=true", () => {
    expect(() =>
      assertSharedFsExecMutationAllowed({
        command: "printf 'x\\n' > /tmp/openbot-f5-still-deny.txt 2>/dev/null",
        workdir: workspaceRoot,
        workspaceRoot,
        workspaceOnly: true,
      }),
    ).toThrow(/exec denied: shared-fs-resource intersect/);
  });

  it("does not treat heredoc body text as mutation redirect targets", () => {
    const cmd = [
      "cat > skills/comment-reply-post/SKILL.md <<'EOF'",
      "# Skill",
      "Mention > /tmp/should-not-extract",
      "Also > /Users/daniel/.openbot/tenants/001/users/x/workspace/leak",
      "EOF",
    ].join("\n");
    const targets = extractExecFilesystemMutationTargets(cmd, workspaceRoot);
    expect(targets).toContain(path.resolve(workspaceRoot, "skills/comment-reply-post/SKILL.md"));
    expect(targets.some((t) => t.includes("/tmp/should-not-extract"))).toBe(false);
    expect(targets.some((t) => t.includes("tenants/001"))).toBe(false);
  });

  it("still extracts redirect on the heredoc introducer line", () => {
    const cmd = ["cat <<'EOF' > skills/out.md", "body > /tmp/ignored-from-body", "EOF"].join("\n");
    const targets = extractExecFilesystemMutationTargets(cmd, workspaceRoot);
    expect(targets).toContain(path.resolve(workspaceRoot, "skills/out.md"));
    expect(targets.some((t) => t.includes("/tmp/ignored-from-body"))).toBe(false);
  });

  it("stripShellHeredocBodies keeps introducer and removes body", () => {
    const stripped = stripShellHeredocBodies("cat <<'EOF' > out.md\nhello > /tmp/x\nEOF\n");
    expect(stripped).not.toContain("/tmp/x");
    expect(stripped).toContain("<<'EOF' > out.md");
  });
});
