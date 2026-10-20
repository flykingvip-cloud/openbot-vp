import { describe, expect, it } from "vitest";
import type { ExecApprovalDecision } from "./exec-approvals.js";
import {
  buildDesktopSaveExecCommand,
  buildLocalDesktopSavePromptLines,
  buildLocalExecPermissionLines,
  desktopSaveRunsOnNode,
  formatDesktopSaveRoutingError,
  formatLocalMachineLabel,
  isDesktopSaveExecCommand,
  isLocalExecHost,
  LOCAL_EXEC_PERMISSION_DECISIONS,
  LOCAL_EXEC_PERMISSION_LABEL,
  LOCAL_EXEC_PERMISSION_LABEL_ZH,
  normalizeLocalMachineDisplayName,
  parseLocalDesktopSaveTarget,
  resolveBroadcastNodeDisplayName,
} from "./local-exec-permission.js";

describe("local exec permission", () => {
  it("maps Always / Once / Never onto the existing exec approval decisions", () => {
    const decisions: readonly ExecApprovalDecision[] = LOCAL_EXEC_PERMISSION_DECISIONS;
    expect(decisions).toEqual(["allow-once", "allow-always", "deny"]);
    expect(LOCAL_EXEC_PERMISSION_LABEL["allow-always"]).toBe("Always Allow");
    expect(LOCAL_EXEC_PERMISSION_LABEL["allow-once"]).toBe("Allow Once");
    expect(LOCAL_EXEC_PERMISSION_LABEL.deny).toBe("Never");
    expect(LOCAL_EXEC_PERMISSION_LABEL_ZH["allow-always"]).toBe("始终授权");
    expect(LOCAL_EXEC_PERMISSION_LABEL_ZH["allow-once"]).toBe("本次授权");
    expect(LOCAL_EXEC_PERMISSION_LABEL_ZH.deny).toBe("拒绝");
  });

  it("describes a node-host prompt with the machine name and the three actions", () => {
    expect(isLocalExecHost("node")).toBe(true);
    expect(isLocalExecHost("gateway")).toBe(false);
    const lines = buildLocalExecPermissionLines({
      machineLabel: formatLocalMachineLabel({
        displayName: "UPBEYONDdeMacBook-Pro.local",
        nodeId: "node-1",
      }),
    });
    const text = lines.join("\n");
    expect(text).toContain("Allow OpenBot and all bots to run commands on this computer?");
    expect(text).toContain("Machine: UPBEYONDdeMacBook-Pro.local");
    expect(text).toContain("allow-once");
    expect(text).toContain("allow-always");
    expect(text).toContain("deny");
    expect(text).toContain("本次授权");
    expect(text).toContain("始终授权");
    expect(text).toContain("does not grant unrestricted shell");
  });

  it("falls back to the node id and drops control characters from display names", () => {
    expect(formatLocalMachineLabel({ nodeId: "node-1" })).toBe("node-1");
    expect(formatLocalMachineLabel({})).toBe("this computer");
    expect(normalizeLocalMachineDisplayName("  Studio\nMac.local\t")).toBe("Studio Mac.local");
    expect(normalizeLocalMachineDisplayName("   ")).toBeNull();
    expect(normalizeLocalMachineDisplayName(12)).toBeNull();
  });

  it("prefers an explicit machine name, then the connected node, and never invents a node id", () => {
    expect(
      resolveBroadcastNodeDisplayName({
        host: "node",
        supplied: "  UPBEYOND Mac\n",
        registryDisplayName: "Other Mac",
      }),
    ).toBe("UPBEYOND Mac");
    expect(
      resolveBroadcastNodeDisplayName({
        host: "node",
        supplied: "   ",
        registryDisplayName: "UPBEYOND Mac",
      }),
    ).toBe("UPBEYOND Mac");
    expect(
      resolveBroadcastNodeDisplayName({
        host: "node",
        registryDisplayName: undefined,
      }),
    ).toBeNull();
    expect(
      resolveBroadcastNodeDisplayName({
        host: "gateway",
        supplied: "UPBEYOND Mac",
        registryDisplayName: "UPBEYOND Mac",
      }),
    ).toBeNull();
  });
});

describe("desktop save exec template", () => {
  it("recognizes a single file on the user Desktop", () => {
    expect(parseLocalDesktopSaveTarget("/Users/daniel/Desktop/整理清单.txt")).toEqual({
      fileName: "整理清单.txt",
    });
    expect(parseLocalDesktopSaveTarget("~/Desktop/notes.txt")).toEqual({ fileName: "notes.txt" });
    expect(parseLocalDesktopSaveTarget("$HOME/Desktop/notes.txt")).toEqual({
      fileName: "notes.txt",
    });
    expect(parseLocalDesktopSaveTarget("~/Desktop")).toBeNull();
    expect(parseLocalDesktopSaveTarget("~/Desktop/.env")).toBeNull();
    expect(parseLocalDesktopSaveTarget("/Users/daniel/Desktop/nested/a.txt")).toBeNull();
    expect(parseLocalDesktopSaveTarget("/tmp/notes.txt")).toBeNull();
  });

  it("builds a quoted heredoc and rejects extra shell", () => {
    const command = buildDesktopSaveExecCommand({
      fileName: "整理清单.txt",
      content: "alpha\nbeta",
    });
    expect(command).toContain('cat > "$HOME/Desktop/整理清单.txt"');
    expect(isDesktopSaveExecCommand(command)).toBe(true);
    expect(desktopSaveRunsOnNode("node", command)).toBe(true);
    expect(desktopSaveRunsOnNode("sandbox", command)).toBe(false);
    expect(isDesktopSaveExecCommand(`${command}\nrm -rf /`)).toBe(false);
    expect(
      isDesktopSaveExecCommand(
        "printf 'openbot-local-ok\\n' > \"$HOME/Desktop/OpenBot-Local-Proof.txt\"",
      ),
    ).toBe(true);
    expect(isDesktopSaveExecCommand("printf 'ok' > /Users/daniel/Desktop/x.txt")).toBe(false);
    expect(
      isDesktopSaveExecCommand("cat > \"$HOME/Desktop/x.txt\" <<'OB_DESKTOP'\n$(id)\nOB_DESKTOP"),
    ).toBe(true);
    expect(() => buildDesktopSaveExecCommand({ fileName: "../x", content: "a" })).toThrow(
      /not allowed/,
    );
  });

  it("tells the model to use node exec instead of workspace write", () => {
    const message = formatDesktopSaveRoutingError({ fileName: "notes.txt", content: "hi" });
    expect(message).toContain('host "node"');
    expect(message).toContain('"$HOME/Desktop/notes.txt"');
    expect(message).toContain("hi");
    expect(message).not.toContain("Path escapes sandbox root");
    const lines = buildLocalDesktopSavePromptLines("exec");
    expect(lines.join("\n")).toContain("本机桌面");
    expect(lines.join("\n")).toContain("等待授权");
    expect(lines.join("\n")).not.toMatch(/no computer binding/i);
    expect(lines.join("\n")).toContain("does not approve the write");
  });
});
