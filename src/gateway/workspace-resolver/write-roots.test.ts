import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isFilesystemWorkspaceLocator,
  resolveCronWriteRoot,
  resolveLiveRobotWriteRoot,
  listPollutingRobotOwnWorkspaceDirs,
  mergePollutingRobotWorkspaceIntoCanonical,
  resolvePlacedFilesystemWriteRoot,
  resolveRobotOwnWriteRoot,
  resolveRobotWriteRoot,
  resolveUnscopedHostWriteRoot,
} from "./write-roots.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("robot own write root", () => {
  it("uses tenants/users/OpenBot/agents/<id>/workspace", () => {
    expect(
      resolveRobotOwnWriteRoot({
        stateDir: "/tmp/openbot-state",
        tenantId: "001",
        userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
        agentId: "main",
      }),
    ).toBe(
      path.resolve(
        "/tmp/openbot-state/tenants/001/users/90fed19a-1c8b-4420-87e0-bcc6165e32fa/OpenBot/agents/main/workspace",
      ),
    );
  });

  it("writes to the robot own space and merges leftover employee files once", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-write-roots-"));
    tempDirs.push(stateDir);
    const leftover = listPollutingRobotOwnWorkspaceDirs({
      stateDir,
      tenantId: "001",
      userId: "user-elle",
      agentId: "main",
    }).find((dir) => dir.includes(`${path.sep}employees${path.sep}`))!;
    fs.mkdirSync(path.join(leftover, "memory"), { recursive: true });
    fs.writeFileSync(path.join(leftover, "memory", "old.md"), "# leftover\n");
    const written = resolveRobotWriteRoot({
      agentId: "main",
      tenantId: "001",
      userId: "user-elle",
      stateDir,
    });
    expect(written).toBe(
      resolveRobotOwnWriteRoot({
        stateDir,
        tenantId: "001",
        userId: "user-elle",
        agentId: "main",
      }),
    );
    expect(fs.readFileSync(path.join(written!, "memory", "old.md"), "utf8")).toBe("# leftover\n");
  });

  it("does not overwrite files already in the robot own space", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-write-roots-keep-"));
    tempDirs.push(stateDir);
    const canonical = resolveRobotOwnWriteRoot({
      stateDir,
      tenantId: "001",
      userId: "user-elle",
      agentId: "main",
    });
    fs.mkdirSync(path.join(canonical, "memory"), { recursive: true });
    fs.writeFileSync(path.join(canonical, "memory", "old.md"), "# live\n");
    const leftover = listPollutingRobotOwnWorkspaceDirs({
      stateDir,
      tenantId: "001",
      userId: "user-elle",
      agentId: "main",
    }).find((dir) => dir.includes(`${path.sep}employees${path.sep}`))!;
    fs.mkdirSync(path.join(leftover, "memory"), { recursive: true });
    fs.writeFileSync(path.join(leftover, "memory", "old.md"), "# leftover\n");
    mergePollutingRobotWorkspaceIntoCanonical({
      canonicalDir: canonical,
      stateDir,
      tenantId: "001",
      userId: "user-elle",
      agentId: "main",
    });
    expect(fs.readFileSync(path.join(canonical, "memory", "old.md"), "utf8")).toBe("# live\n");
  });

  it("returns null without a user identity so callers cannot use config workspace", () => {
    expect(
      resolveRobotWriteRoot({
        agentId: "main",
        stateDir: "/tmp/openbot-state",
      }),
    ).toBeNull();
  });

  it("keeps unscoped host fallback off config and leftover roots", () => {
    expect(
      resolveUnscopedHostWriteRoot({
        agentId: "ops",
        stateDir: "/tmp/openbot-state",
      }),
    ).toBe(path.resolve("/tmp/openbot-state/workspace-ops"));
  });

  it("merges leftover L2 OpenBot/workspace into the robot own space", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-write-roots-l2-"));
    tempDirs.push(stateDir);
    const leftover = path.join(
      stateDir,
      "tenants",
      "001",
      "users",
      "user-elle",
      "OpenBot",
      "workspace",
    );
    fs.mkdirSync(leftover, { recursive: true });
    fs.writeFileSync(path.join(leftover, "old.md"), "# l2 leftover\n");
    const written = resolveRobotWriteRoot({
      agentId: "main",
      tenantId: "001",
      userId: "user-elle",
      stateDir,
    });
    expect(fs.readFileSync(path.join(written!, "old.md"), "utf8")).toBe("# l2 leftover\n");
    expect(written).not.toBe(path.resolve(leftover));
  });

  it("merges leftover when tenant is inferred from a unique existing robot space", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-write-roots-scan-"));
    tempDirs.push(stateDir);
    const live = resolveRobotOwnWriteRoot({
      stateDir,
      tenantId: "tenant-a",
      userId: "user-elle",
      agentId: "main",
    });
    fs.mkdirSync(live, { recursive: true });
    fs.mkdirSync(path.join(stateDir, "tenants", "tenant-b"), { recursive: true });
    const leftover = listPollutingRobotOwnWorkspaceDirs({
      stateDir,
      userId: "user-elle",
      agentId: "main",
    }).find((dir) => dir.includes(`${path.sep}employees${path.sep}`))!;
    fs.mkdirSync(leftover, { recursive: true });
    fs.writeFileSync(path.join(leftover, "from-employees.md"), "# leftover\n");
    const written = resolveRobotWriteRoot({
      agentId: "main",
      userId: "user-elle",
      stateDir,
    });
    expect(written).toBe(live);
    expect(fs.readFileSync(path.join(written!, "from-employees.md"), "utf8")).toBe("# leftover\n");
  });

  it("keeps the robot own space when leftover merge hits a type clash", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-write-roots-clash-"));
    tempDirs.push(stateDir);
    const canonical = resolveRobotOwnWriteRoot({
      stateDir,
      tenantId: "001",
      userId: "user-elle",
      agentId: "main",
    });
    fs.mkdirSync(path.join(canonical, "notes.md"), { recursive: true });
    const leftover = listPollutingRobotOwnWorkspaceDirs({
      stateDir,
      tenantId: "001",
      userId: "user-elle",
      agentId: "main",
    }).find((dir) => dir.includes(`${path.sep}employees${path.sep}`))!;
    fs.mkdirSync(leftover, { recursive: true });
    fs.writeFileSync(path.join(leftover, "notes.md"), "# leftover file\n");
    expect(
      resolveRobotWriteRoot({
        agentId: "main",
        tenantId: "001",
        userId: "user-elle",
        stateDir,
      }),
    ).toBe(canonical);
  });

  it("merges host workspace-<id> into the robot own space", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-write-roots-host-"));
    tempDirs.push(stateDir);
    const host = path.join(stateDir, "workspace-bot-2");
    fs.mkdirSync(host, { recursive: true });
    fs.writeFileSync(path.join(host, "技能列表.xlsx"), "sheet");
    const written = resolveRobotWriteRoot({
      agentId: "bot-2",
      tenantId: "001",
      userId: "user-elle",
      stateDir,
    });
    expect(written).toBe(
      resolveRobotOwnWriteRoot({
        stateDir,
        tenantId: "001",
        userId: "user-elle",
        agentId: "bot-2",
      }),
    );
    expect(fs.readFileSync(path.join(written!, "技能列表.xlsx"), "utf8")).toBe("sheet");
    expect(
      listPollutingRobotOwnWorkspaceDirs({
        stateDir,
        tenantId: "001",
        userId: "user-elle",
        agentId: "bot-2",
      }).some((dir) => dir.includes(`${path.sep}employees${path.sep}`)),
    ).toBe(false);
  });

  it("does not merge main employees leftover into another robot", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-write-roots-no-cross-"));
    tempDirs.push(stateDir);
    const leftover = path.join(stateDir, "agents", "main", "employees", "user-elle", "workspace");
    fs.mkdirSync(leftover, { recursive: true });
    fs.writeFileSync(path.join(leftover, "Alice_resume.docx"), "main leftover");
    const written = resolveRobotWriteRoot({
      agentId: "bot-2",
      tenantId: "001",
      userId: "user-elle",
      stateDir,
    });
    expect(fs.existsSync(path.join(written!, "Alice_resume.docx"))).toBe(false);
  });
});

describe("resolveCronWriteRoot", () => {
  it("uses robot own space when identity exists", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-cron-write-"));
    tempDirs.push(stateDir);
    expect(
      resolveCronWriteRoot({
        agentId: "main",
        tenantId: "001",
        userId: "user-elle",
        stateDir,
      }),
    ).toBe(
      resolveRobotOwnWriteRoot({
        stateDir,
        tenantId: "001",
        userId: "user-elle",
        agentId: "main",
      }),
    );
  });

  it("refuses host workspace-<id> and uses a non-git default workspace", () => {
    const fallback = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-cron-default-"));
    tempDirs.push(fallback);
    expect(
      resolveCronWriteRoot({
        agentId: "ops",
        configuredDefaultWorkspace: fallback,
      }),
    ).toBe(path.resolve(fallback));
    expect(fallback.includes("workspace-ops")).toBe(false);
  });

  it("throws when identity is missing and the configured default is a git checkout", () => {
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-cron-git-"));
    tempDirs.push(checkout);
    fs.mkdirSync(path.join(checkout, ".git"));
    expect(() =>
      resolveCronWriteRoot({
        agentId: "main",
        configuredDefaultWorkspace: checkout,
      }),
    ).toThrow(/refusing host workspace-<id>/);
  });

  it("allows a D1e default workspace even when leftover .git remains after merge", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-cron-d1e-git-"));
    tempDirs.push(stateDir);
    const d1e = resolveRobotOwnWriteRoot({
      stateDir,
      tenantId: "001",
      userId: "user-elle",
      agentId: "main",
    });
    fs.mkdirSync(path.join(d1e, ".git"), { recursive: true });
    expect(
      resolveCronWriteRoot({
        agentId: "main",
        configuredDefaultWorkspace: d1e,
      }),
    ).toBe(d1e);
    expect(
      resolveLiveRobotWriteRoot({
        agentId: "main",
        configuredDefaultWorkspace: d1e,
      }),
    ).toBe(d1e);
  });
});

describe("placed filesystem write root", () => {
  it("treats unplaced catalog locators as non-filesystem", () => {
    expect(isFilesystemWorkspaceLocator("unplaced://classified/ws:001:user:x:asset:main")).toBe(
      false,
    );
    expect(isFilesystemWorkspaceLocator("unplaced:/classified/ws:001")).toBe(false);
    expect(
      isFilesystemWorkspaceLocator(
        path.join("/tmp", "unplaced:", "classified", "ws:001:user:x:asset:main"),
      ),
    ).toBe(false);
    expect(isFilesystemWorkspaceLocator("/var/openbot/agents/main/workspace")).toBe(true);
  });

  it("places an unplaced catalog locator onto the robot-own write root", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-placed-root-"));
    tempDirs.push(stateDir);
    const placed = resolvePlacedFilesystemWriteRoot({
      locator: "unplaced://classified/ws:001:user:elle:asset:main",
      agentId: "main",
      tenantId: "001",
      userId: "elle",
      stateDir,
      ensureDirectory: true,
    });
    expect(placed).toBe(
      resolveRobotOwnWriteRoot({
        stateDir,
        tenantId: "001",
        userId: "elle",
        agentId: "main",
      }),
    );
    expect(fs.existsSync(placed!)).toBe(true);
    expect(placed!.includes(`${path.sep}unplaced:`)).toBe(false);
  });
});
