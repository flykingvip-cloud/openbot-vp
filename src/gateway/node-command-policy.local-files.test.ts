import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { NODE_LOCAL_FILES_READONLY_COMMANDS } from "../infra/node-commands.js";
import {
  capabilityProfileFromCaps,
  checkProfileCommandSet,
} from "../local-files/capability-profile.js";
import { LOCAL_FILES_CAP } from "../local-files/events.js";
import { LOCAL_FILES_READONLY_PROFILE } from "../local-files/types.js";
import { isNodeCommandAllowed, resolveNodeCommandAllowlist } from "./node-command-policy.js";

/**
 * Gateway half of the two-sided rejection. The node-side half lives in
 * `src/node-host/local-files/handlers.test.ts`; each must refuse independently.
 * Design: docs/design/openbot-local-disk-read-grant-2026-09-29.md section 10.3.
 */

const EMPTY_CONFIG = {} as OpenBotConfig;

const PROFILED_NODE = {
  platform: "darwin",
  deviceFamily: "Mac",
  capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
};

describe("resolveNodeCommandAllowlist with the local-files-readonly profile", () => {
  it("returns exactly the five profile commands", () => {
    const allow = resolveNodeCommandAllowlist(EMPTY_CONFIG, PROFILED_NODE);
    expect([...allow].toSorted()).toEqual([
      "archive.list",
      "archive.readEntry",
      "fs.list",
      "fs.read",
      "fs.stat",
    ]);
  });

  it("does not grant macOS SYSTEM_COMMANDS to a profiled node", () => {
    const allow = resolveNodeCommandAllowlist(EMPTY_CONFIG, PROFILED_NODE);
    for (const denied of [
      "system.run",
      "system.run.prepare",
      "system.which",
      "system.notify",
      "system.execApprovals.get",
      "system.execApprovals.set",
      "browser.proxy",
      "supervisor.worker.dispatch",
    ]) {
      expect(allow.has(denied)).toBe(false);
    }
  });

  it("cannot be widened by gateway.nodes.allowCommands", () => {
    // An operator-level allow entry must not be able to hand system.run to a
    // read-only device.
    const cfg = {
      gateway: { nodes: { allowCommands: ["system.run", "system.which"] } },
    } as unknown as OpenBotConfig;
    const allow = resolveNodeCommandAllowlist(cfg, PROFILED_NODE);
    expect(allow.has("system.run")).toBe(false);
    expect(allow.size).toBe(NODE_LOCAL_FILES_READONLY_COMMANDS.length);
  });

  it("still honours denyCommands, which can only narrow", () => {
    const cfg = {
      gateway: { nodes: { denyCommands: ["fs.read"] } },
    } as unknown as OpenBotConfig;
    const allow = resolveNodeCommandAllowlist(cfg, PROFILED_NODE);
    expect(allow.has("fs.read")).toBe(false);
    expect(allow.has("fs.stat")).toBe(true);
  });

  it("lets a paired Mac declare the file commands without dropping system.run", () => {
    // The handshake filter keeps only allowlisted commands. A paired Mac
    // declares both system.run and the five file commands; stripping the file
    // commands would make Desktop reads impossible. Invocation still requires
    // a signed capability on the node, and a node that did not declare them
    // cannot run them.
    const allow = resolveNodeCommandAllowlist(EMPTY_CONFIG, {
      platform: "darwin",
      deviceFamily: "Mac",
    });
    expect(allow.has("system.run")).toBe(true);
    for (const command of NODE_LOCAL_FILES_READONLY_COMMANDS) {
      expect(allow.has(command)).toBe(true);
    }
    expect(
      isNodeCommandAllowed({
        command: "fs.list",
        declaredCommands: ["system.run"],
        allowlist: allow,
      }).ok,
    ).toBe(false);
  });
});

describe("the connect handshake keeps a profiled node's commands (design 9.5)", () => {
  // This reproduces the two steps the real handshake performs in order:
  // message-handler filters the declared commands against the resolved allowlist,
  // and then checkProfileCommandSet requires the surviving set to equal the
  // profile exactly. Both steps are cheap to call directly, and they have to be
  // tested together: each is correct alone, and the pair was broken. The
  // in-process activation test cannot see this, because it bridges the websocket
  // hop and so never runs the handshake at all.
  function handshake(caps: string[], declared: string[]) {
    const capabilityProfile = capabilityProfileFromCaps(caps);
    const allowlist = resolveNodeCommandAllowlist({} as OpenBotConfig, {
      platform: "darwin",
      deviceFamily: "Mac",
      capabilityProfile,
    });
    // Mirrors the real order: the profile check sees the declared set, and only
    // then are non-allowlisted commands filtered out.
    const check =
      capabilityProfile === undefined
        ? { ok: true as const, extra: [], missing: [] }
        : checkProfileCommandSet(declared);
    const filtered = declared
      .map((cmd) => cmd.trim())
      .filter((cmd) => cmd.length > 0 && allowlist.has(cmd));
    return { filtered, check };
  }

  it("survives the command filter and then passes the profile check", () => {
    const declared = [...NODE_LOCAL_FILES_READONLY_COMMANDS];
    const result = handshake([LOCAL_FILES_CAP], declared);
    // Without the profile the filter uses the macOS defaults, which contain none
    // of these five, so the set would arrive empty and the check would close the
    // connection with 1008.
    expect(result.filtered.toSorted()).toEqual(declared.toSorted());
    expect(result.check.ok).toBe(true);
  });

  it("derives the profile from the advertised capability", () => {
    expect(capabilityProfileFromCaps([LOCAL_FILES_CAP])).toBe(LOCAL_FILES_READONLY_PROFILE);
    expect(capabilityProfileFromCaps(["browser", "camera"])).toBeUndefined();
    expect(capabilityProfileFromCaps(undefined)).toBeUndefined();
    // A paired computer advertises system and local-files together. That is
    // not the exclusive profile, so the exact-set handshake does not reject it.
    expect(capabilityProfileFromCaps([LOCAL_FILES_CAP, "system"])).toBeUndefined();
  });

  it("refuses a node that asks for both, rather than narrowing it", () => {
    // The check runs on the DECLARED set, before the filter strips anything. If it
    // ran on the filtered set, system.run would be removed, the remaining five
    // would look correct, and an over-declaring node would be admitted quietly.
    // Design 9.5 asks for a refusal, so this asserts the refusal, and separately
    // that the filter would indeed have hidden the extra command.
    const declared = [...NODE_LOCAL_FILES_READONLY_COMMANDS, "system.run"];
    const result = handshake([LOCAL_FILES_CAP], declared);
    expect(result.check.ok).toBe(false);
    expect(result.filtered).not.toContain("system.run");
    expect(checkProfileCommandSet(result.filtered).ok).toBe(true);
    expect(handshake([LOCAL_FILES_CAP], ["system.run"]).check.ok).toBe(false);
  });

  it("leaves an ordinary macOS node's handshake alone", () => {
    const result = handshake([], ["system.run", "system.notify"]);
    expect(result.filtered).toContain("system.run");
  });
});

describe("isNodeCommandAllowed for a profiled node", () => {
  const allowlist = resolveNodeCommandAllowlist(EMPTY_CONFIG, PROFILED_NODE);
  const declared = [...NODE_LOCAL_FILES_READONLY_COMMANDS];

  it("permits the profile commands the node declared", () => {
    for (const command of declared) {
      expect(isNodeCommandAllowed({ command, declaredCommands: declared, allowlist }).ok).toBe(
        true,
      );
    }
  });

  it("refuses system.run even if a misconfigured node declares it (acceptance 6.8)", () => {
    const res = isNodeCommandAllowed({
      command: "system.run",
      declaredCommands: [...declared, "system.run"],
      allowlist,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("command not allowlisted");
  });

  it("refuses a profile command the node did not declare", () => {
    const res = isNodeCommandAllowed({
      command: "fs.read",
      declaredCommands: declared.filter((cmd) => cmd !== "fs.read"),
      allowlist,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("command not declared by node");
  });

  it("refuses everything when the node declared no commands", () => {
    const res = isNodeCommandAllowed({ command: "fs.stat", declaredCommands: [], allowlist });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("node did not declare commands");
  });
});
