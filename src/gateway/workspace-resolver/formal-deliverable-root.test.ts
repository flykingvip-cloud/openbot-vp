import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import { seatOwnedWriteOwnership } from "./canonical-write-root.js";
import {
  alignFormalRootForManagedAddressing,
  buildFormalFileRef,
  resolveFormalDeliverableRoot,
  resolveFormalPreviewAbsolutePath,
} from "./formal-deliverable-root.js";
import { resolveRobotOwnWriteRoot, resolveRobotWriteRoot } from "./write-roots.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveFormalDeliverableRoot", () => {
  it("seat: same sticky root for two chatting logins; preview ref opens write path", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-formal-seat-"));
    tempDirs.push(stateDir);
    const sticky = resolveRobotOwnWriteRoot({
      stateDir,
      tenantId: "001",
      userId: "user-elle",
      agentId: "agt-contract",
    });
    fs.mkdirSync(path.join(sticky, "output", "docx"), { recursive: true });
    const rel = "output/docx/ma.pdf";
    fs.writeFileSync(path.join(sticky, rel), "bytes");

    const identity = {
      kind: "seat" as const,
      seatId: "seat-cs",
      agentId: "agt-contract",
      stickyLocator: sticky,
    };
    const asElle = resolveFormalDeliverableRoot({
      tenantId: "001",
      resourceIdentity: identity,
      stateDir,
      ownership: seatOwnedWriteOwnership({
        seatId: "seat-cs",
        stickyLocator: sticky,
      }),
    });
    const asCeo = resolveFormalDeliverableRoot({
      tenantId: "001",
      resourceIdentity: identity,
      stateDir,
      ownership: seatOwnedWriteOwnership({
        seatId: "seat-cs",
        stickyLocator: sticky,
        hostUserId: "user-ceo",
      }),
    });
    expect(asElle.ok).toBe(true);
    expect(asCeo.ok).toBe(true);
    if (!asElle.ok || !asCeo.ok) {
      return;
    }
    expect(asElle.rootPath).toBe(asCeo.rootPath);
    expect(asElle.rootPath).toBe(path.resolve(sticky));
    const previewAbs = resolveFormalPreviewAbsolutePath({
      formalRoot: asElle,
      relativePath: rel,
    });
    expect(previewAbs).toBe(path.join(asElle.rootPath, rel));
    expect(fs.readFileSync(previewAbs, "utf8")).toBe("bytes");
    expect(buildFormalFileRef(rel)).toBe(rel);
  });

  it("seat: missing sticky/host → missing_binding (hard fail)", () => {
    const result = resolveFormalDeliverableRoot({
      tenantId: "001",
      resourceIdentity: {
        kind: "seat",
        seatId: "seat-cs",
        agentId: "agt-contract",
      },
      stateDir: "/tmp/openbot-formal-missing",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("missing_binding");
  });

  it("personal: owner roots diverge across users; same owner stable", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-formal-personal-"));
    tempDirs.push(stateDir);
    const a = resolveFormalDeliverableRoot({
      tenantId: "001",
      stateDir,
      resourceIdentity: { kind: "personal", ownerUserId: "user-a", agentId: "bot-me" },
    });
    const b = resolveFormalDeliverableRoot({
      tenantId: "001",
      stateDir,
      resourceIdentity: { kind: "personal", ownerUserId: "user-b", agentId: "bot-me" },
    });
    const a2 = resolveFormalDeliverableRoot({
      tenantId: "001",
      stateDir,
      resourceIdentity: { kind: "personal", ownerUserId: "user-a", agentId: "bot-me" },
    });
    expect(a.ok && b.ok && a2.ok).toBe(true);
    if (!a.ok || !b.ok || !a2.ok) {
      return;
    }
    expect(a.rootPath).toBe(
      resolveRobotWriteRoot({
        agentId: "bot-me",
        tenantId: "001",
        userId: "user-a",
        stateDir,
      }),
    );
    expect(a.rootPath).not.toBe(b.rootPath);
    expect(a.rootPath).toBe(a2.rootPath);
  });

  it("group: write root equals preview root (trusted locator)", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-formal-group-"));
    tempDirs.push(stateDir);
    const cfg = {
      collaboration: { defaults: { workspace: path.join(stateDir, "collaboration") } },
    } as OpenBotConfig;
    const result = resolveFormalDeliverableRoot({
      tenantId: null,
      cfg,
      profile: "personal_local",
      resourceIdentity: { kind: "group", groupId: "grp-hrqb" },
      ensureDirectory: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.kind).toBe("group");
    expect(result.rootPath).toContain(`${path.sep}groups${path.sep}`);
    expect(result.rootPath.endsWith("grp-hrqb") || result.rootPath.includes("grp-hrqb")).toBe(true);
    const rel = "deliverables/talent.docx";
    fs.mkdirSync(path.dirname(path.join(result.rootPath, rel)), { recursive: true });
    fs.writeFileSync(path.join(result.rootPath, rel), "group-bytes");
    const abs = resolveFormalPreviewAbsolutePath({ formalRoot: result, relativePath: rel });
    expect(fs.readFileSync(abs, "utf8")).toBe("group-bytes");
  });

  it("group managed_enterprise without tenantId → missing_binding", () => {
    const cfg = { collaboration: { defaults: { workspace: "/tmp/collab" } } } as OpenBotConfig;
    const result = resolveFormalDeliverableRoot({
      cfg,
      profile: "managed_enterprise",
      tenantId: null,
      resourceIdentity: { kind: "group", groupId: "grp-x" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("missing_binding");
  });

  it("cross-tenant seat sticky paths do not collide", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-formal-xtenant-"));
    tempDirs.push(stateDir);
    const stickyA = resolveRobotOwnWriteRoot({
      stateDir,
      tenantId: "001",
      userId: "user-elle",
      agentId: "agt-contract",
    });
    const stickyB = resolveRobotOwnWriteRoot({
      stateDir,
      tenantId: "002",
      userId: "user-elle",
      agentId: "agt-contract",
    });
    const a = resolveFormalDeliverableRoot({
      tenantId: "001",
      stateDir,
      resourceIdentity: {
        kind: "seat",
        seatId: "seat-cs",
        agentId: "agt-contract",
        stickyLocator: stickyA,
      },
    });
    const b = resolveFormalDeliverableRoot({
      tenantId: "002",
      stateDir,
      resourceIdentity: {
        kind: "seat",
        seatId: "seat-cs",
        agentId: "agt-contract",
        stickyLocator: stickyB,
      },
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) {
      return;
    }
    expect(a.rootPath).not.toBe(b.rootPath);
  });
});

describe("alignFormalRootForManagedAddressing", () => {
  it("remounts tenants user tree onto operators under shared addressing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-formal-align-"));
    tempDirs.push(root);
    const tenantsRoot = path.join(root, "tenants");
    const stateDir = path.join(root, "state");
    const tenantsWs = path.join(
      tenantsRoot,
      "001",
      "users",
      "user-elle",
      "OpenBot",
      "agents",
      "agt-x",
      "workspace",
    );
    const operatorsWs = path.join(
      stateDir,
      "operators",
      "user-elle",
      "OpenBot",
      "agents",
      "agt-x",
      "workspace",
    );
    fs.mkdirSync(tenantsWs, { recursive: true });
    const previous = {
      OPENBOT_STATE_DIR: process.env.OPENBOT_STATE_DIR,
      OPENBOT_TENANTS_ROOT: process.env.OPENBOT_TENANTS_ROOT,
      OPENBOT_MULTITENANT: process.env.OPENBOT_MULTITENANT,
      OPENBOT_DATA_MODE: process.env.OPENBOT_DATA_MODE,
    };
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_DATA_MODE = "managed";
    try {
      const aligned = alignFormalRootForManagedAddressing(tenantsWs, {
        config: { data: { mode: "managed" } } as OpenBotConfig,
      });
      expect(aligned).toBe(path.resolve(operatorsWs));
      // Group collaboration path must not remount.
      const groupPath = path.join(tenantsRoot, "001", "collaboration", "groups", "grp-a");
      expect(
        alignFormalRootForManagedAddressing(groupPath, {
          config: { data: { mode: "managed" } } as OpenBotConfig,
        }),
      ).toBe(path.resolve(groupPath));
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
