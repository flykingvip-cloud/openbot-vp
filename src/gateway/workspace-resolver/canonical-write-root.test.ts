import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import {
  extractWorkspaceHostUserIdFromLocator,
  inferSeatOwnershipFromAgentConfig,
  resolveCanonicalRobotWriteRoot,
  seatOwnedWriteOwnership,
} from "./canonical-write-root.js";
import { resolveRobotOwnWriteRoot, resolveRobotWriteRoot } from "./write-roots.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveCanonicalRobotWriteRoot", () => {
  it("seat-owned: two chatting userIds resolve to the same sticky host root", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-canonical-seat-"));
    tempDirs.push(stateDir);
    const ownership = seatOwnedWriteOwnership({
      seatId: "seat-cs",
      hostUserId: "user-elle",
      agentAssetId: "asset-contract",
    });
    const asElle = resolveCanonicalRobotWriteRoot({
      agentId: "agt-contract",
      tenantId: "001",
      chattingUserId: "user-elle",
      stateDir,
      ownership,
    });
    const asCeo = resolveCanonicalRobotWriteRoot({
      agentId: "agt-contract",
      tenantId: "001",
      chattingUserId: "user-ceo",
      stateDir,
      ownership,
    });
    const expected = resolveRobotOwnWriteRoot({
      stateDir,
      tenantId: "001",
      userId: "user-elle",
      agentId: "agt-contract",
    });
    expect(asElle).toBe(expected);
    expect(asCeo).toBe(expected);
    expect(asElle).toBe(asCeo);
  });

  it("seat-owned sticky locator wins over chatting userId", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-canonical-sticky-"));
    tempDirs.push(stateDir);
    const sticky = resolveRobotOwnWriteRoot({
      stateDir,
      tenantId: "001",
      userId: "user-elle",
      agentId: "agt-contract",
    });
    fs.mkdirSync(path.join(sticky, "output", "pdf"), { recursive: true });
    fs.writeFileSync(path.join(sticky, "output", "pdf", "a.pdf"), "pdf");
    const ownership = seatOwnedWriteOwnership({
      seatId: "seat-cs",
      stickyLocator: sticky,
      hostUserId: "user-ceo", // ignored when sticky present
    });
    const asCeo = resolveCanonicalRobotWriteRoot({
      agentId: "agt-contract",
      tenantId: "001",
      chattingUserId: "user-ceo",
      stateDir,
      ownership,
    });
    expect(asCeo).toBe(path.resolve(sticky));
    expect(fs.existsSync(path.join(asCeo!, "output", "pdf", "a.pdf"))).toBe(true);
  });

  it("seat-owned without sticky/host fails closed (null)", () => {
    expect(
      resolveCanonicalRobotWriteRoot({
        agentId: "agt-contract",
        tenantId: "001",
        chattingUserId: "user-ceo",
        stateDir: "/tmp/openbot-state",
        ownership: seatOwnedWriteOwnership({ seatId: "seat-cs" }),
      }),
    ).toBeNull();
  });

  it("personal bot: two chatting userIds still diverge", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-canonical-personal-"));
    tempDirs.push(stateDir);
    const a = resolveCanonicalRobotWriteRoot({
      agentId: "bot-personal",
      tenantId: "001",
      chattingUserId: "user-a",
      stateDir,
      ownership: { kind: "personal" },
    });
    const b = resolveCanonicalRobotWriteRoot({
      agentId: "bot-personal",
      tenantId: "001",
      chattingUserId: "user-b",
      stateDir,
      ownership: { kind: "personal" },
    });
    expect(a).toBe(
      resolveRobotWriteRoot({
        agentId: "bot-personal",
        tenantId: "001",
        userId: "user-a",
        stateDir,
      }),
    );
    expect(b).toBe(
      resolveRobotWriteRoot({
        agentId: "bot-personal",
        tenantId: "001",
        userId: "user-b",
        stateDir,
      }),
    );
    expect(a).not.toBe(b);
  });
});

describe("inferSeatOwnershipFromAgentConfig", () => {
  it("detects position ownerType and shared scope", () => {
    const cfg = {
      agents: {
        list: [
          { id: "agt-contract", ownerType: "position", ownerId: "seat-cs", scope: "shared" },
          { id: "bot-me", scope: "self", ownerId: "user-a" },
        ],
      },
    } as OpenBotConfig;
    expect(inferSeatOwnershipFromAgentConfig(cfg, "agt-contract")).toEqual({ seatId: "seat-cs" });
    expect(inferSeatOwnershipFromAgentConfig(cfg, "bot-me")).toBeNull();
  });
});

describe("extractWorkspaceHostUserIdFromLocator", () => {
  it("reads the users/<id> segment from a robot-own path", () => {
    expect(
      extractWorkspaceHostUserIdFromLocator(
        "/data/tenants/001/users/user-elle/OpenBot/agents/agt-x/workspace",
      ),
    ).toBe("user-elle");
  });
});
