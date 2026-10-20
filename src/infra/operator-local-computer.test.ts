import { describe, expect, it } from "vitest";
import { isPersonalMailTransportCommand } from "../gateway/user-operational-identity-guidance.js";
import { buildDesktopSaveExecCommand } from "./local-exec-permission.js";
import {
  collectConnectedPreferredNodeIds,
  decideLocalComputerHost,
  decideOperatorComputerBinding,
  formatOperatorComputerTurnPrompt,
  isDesktopBase64SaveCommand,
  isOperatorLocalComputerCommand,
  shouldSkipOperatorComputerApproval,
} from "./operator-local-computer.js";

const AGENTS = ["field-bot", "bot-skill", "main"] as const;

describe("operator local computer host policy", () => {
  it("allows bounded Desktop probes without a binding so the permission card can appear", () => {
    expect(
      decideLocalComputerHost({
        configuredHost: "sandbox",
        requestedHost: "node",
        command: 'ls -d "$HOME/Desktop"',
        elevatedRequested: false,
      }),
    ).toEqual({ kind: "allow" });
    for (const command of ["id", "touch /Users/ada/Desktop/x.txt", "rm -rf /"]) {
      expect(
        decideLocalComputerHost({
          configuredHost: "sandbox",
          requestedHost: "node",
          command,
          elevatedRequested: false,
        }),
      ).toEqual({ kind: "deny" });
    }
  });

  it("allows the bounded Desktop path for every granted seat bot, and pins that node", () => {
    const command = 'ls -d "$HOME/Desktop"';
    const binary = "base64 -d > \"$HOME/Desktop/slides.pptx\" <<'OB_DESKTOP'\nQUJD\nOB_DESKTOP";
    expect(isDesktopBase64SaveCommand(binary)).toBe(true);
    expect(isOperatorLocalComputerCommand(command)).toBe(true);
    for (const _agent of AGENTS) {
      expect(
        decideLocalComputerHost({
          configuredHost: "sandbox",
          requestedHost: "node",
          command,
          operatorNodeId: "mac-node",
          elevatedRequested: false,
        }),
      ).toEqual({ kind: "allow", pinNodeId: "mac-node" });
      expect(
        decideLocalComputerHost({
          configuredHost: "sandbox",
          requestedHost: "node",
          command: binary,
          operatorNodeId: "mac-node",
          elevatedRequested: false,
        }).kind,
      ).toBe("allow");
    }
  });

  it("keeps the Desktop write template without a binding and still denies a general shell", () => {
    const command = buildDesktopSaveExecCommand({ fileName: "notes.txt", content: "hi" });
    expect(
      decideLocalComputerHost({
        configuredHost: "sandbox",
        requestedHost: "node",
        command,
        elevatedRequested: false,
      }),
    ).toEqual({ kind: "allow" });
    expect(
      decideLocalComputerHost({
        configuredHost: "sandbox",
        requestedHost: "node",
        command: "rm -rf /",
        operatorNodeId: "mac-node",
        elevatedRequested: false,
      }),
    ).toEqual({ kind: "deny" });
  });
});

describe("operator computer binding", () => {
  it("uses the active seat binding for a granted bot and ignores the agent name", () => {
    const decision = decideOperatorComputerBinding({
      activeSeatId: "seat-ceo",
      operatorUserId: "emp-1",
      agentId: "field-bot",
      operatorAgentIds: ["main", "field-bot", "bot-skill"],
      occupiedSeatIds: ["seat-ceo", "seat-other"],
      bindings: [{ seatId: "seat-ceo", nodeId: "mac-node" }],
      approvedRequests: [],
    });
    expect(decision).toEqual({ permitted: true, nodeId: "mac-node" });
    expect(
      decideOperatorComputerBinding({
        activeSeatId: "seat-ceo",
        operatorUserId: "emp-1",
        agentId: "panda",
        operatorAgentIds: ["field-bot"],
        occupiedSeatIds: ["seat-ceo"],
        bindings: [{ seatId: "seat-ceo", nodeId: "mac-node" }],
        approvedRequests: [],
      }),
    ).toEqual({ permitted: false, reason: "agent-not-on-seat" });
  });

  it("aligns a same-operator binding that was stored on another seat", () => {
    expect(
      decideOperatorComputerBinding({
        activeSeatId: "seat-ceo",
        operatorUserId: "emp-1",
        agentId: "bot-skill",
        operatorAgentIds: ["bot-skill"],
        occupiedSeatIds: ["seat-ceo", "seat-stale"],
        bindings: [{ seatId: "seat-stale", nodeId: "mac-node" }],
        approvedRequests: [{ seatId: "seat-stale", nodeId: "mac-node", userId: "emp-1" }],
      }),
    ).toEqual({ permitted: true, nodeId: "mac-node", alignFromSeatId: "seat-stale" });
  });

  it("aligns a vacant-seat binding and does not take another employee's computer", () => {
    expect(
      decideOperatorComputerBinding({
        activeSeatId: "seat-ceo",
        operatorUserId: "emp-1",
        agentId: "field-bot",
        operatorAgentIds: ["field-bot"],
        occupiedSeatIds: ["seat-ceo"],
        bindings: [{ seatId: "seat-orphan", nodeId: "mac-node" }],
        approvedRequests: [],
      }),
    ).toEqual({ permitted: true, nodeId: "mac-node", alignFromSeatId: "seat-orphan" });
    expect(
      decideOperatorComputerBinding({
        activeSeatId: "seat-ceo",
        operatorUserId: "emp-1",
        agentId: "field-bot",
        operatorAgentIds: ["field-bot"],
        occupiedSeatIds: ["seat-ceo", "seat-staff"],
        bindings: [{ seatId: "seat-staff", nodeId: "staff-mac" }],
        approvedRequests: [{ seatId: "seat-staff", nodeId: "staff-mac", userId: "emp-2" }],
      }),
    ).toEqual({ permitted: false, reason: "no-binding" });
  });
});

describe("operator computer popup auth", () => {
  it("tells the model to say 等待授权 instead of unbound/settings", () => {
    const unbound = formatOperatorComputerTurnPrompt(null);
    expect(unbound).toContain("等待授权");
    expect(unbound).toContain("本次授权");
    expect(unbound).toContain("始终授权");
    expect(unbound).not.toMatch(/must bind|go to settings|no computer binding/i);
  });

  it("skips approval only after Always Allow for Desktop-class commands", () => {
    expect(
      shouldSkipOperatorComputerApproval({
        command: 'ls -d "$HOME/Desktop"',
        alwaysAllowDesktop: true,
      }),
    ).toBe(true);
    expect(
      shouldSkipOperatorComputerApproval({
        command: 'ls -d "$HOME/Desktop"',
        alwaysAllowDesktop: false,
      }),
    ).toBe(false);
    expect(
      shouldSkipOperatorComputerApproval({
        command: "id",
        alwaysAllowDesktop: true,
      }),
    ).toBe(false);
  });

  it("matches historical approved-request email against employee UUID aliases", () => {
    expect(
      decideOperatorComputerBinding({
        activeSeatId: "seat-ceo",
        operatorUserId: "emp-uuid-1",
        operatorUserIdAliases: ["ceo@example.com"],
        agentId: "field-bot",
        operatorAgentIds: ["field-bot"],
        occupiedSeatIds: ["seat-ceo", "seat-stale"],
        bindings: [{ seatId: "seat-stale", nodeId: "mac-live" }],
        approvedRequests: [{ seatId: "seat-stale", nodeId: "mac-live", userId: "ceo@example.com" }],
      }),
    ).toEqual({ permitted: true, nodeId: "mac-live", alignFromSeatId: "seat-stale" });
  });

  it("ignores a stale approved nodeId when preferred online nodes are provided", () => {
    expect(
      decideOperatorComputerBinding({
        activeSeatId: "seat-ceo",
        operatorUserId: "emp-1",
        preferredNodeIds: ["mac-live"],
        agentId: "field-bot",
        operatorAgentIds: ["field-bot"],
        occupiedSeatIds: ["seat-ceo"],
        bindings: [],
        approvedRequests: [{ seatId: "seat-old", nodeId: "mac-stale", userId: "emp-1" }],
      }),
    ).toEqual({ permitted: false, reason: "no-binding" });
  });

  it("prefers the live approved node when both stale and live exist", () => {
    expect(
      decideOperatorComputerBinding({
        activeSeatId: "seat-ceo",
        operatorUserId: "emp-1",
        preferredNodeIds: ["mac-live"],
        agentId: "field-bot",
        operatorAgentIds: ["field-bot"],
        occupiedSeatIds: ["seat-ceo"],
        bindings: [],
        approvedRequests: [
          { seatId: "seat-old", nodeId: "mac-stale", userId: "emp-1" },
          { seatId: "seat-old", nodeId: "mac-live", userId: "emp-1" },
        ],
      }),
    ).toEqual({ permitted: true, nodeId: "mac-live", alignFromSeatId: "seat-old" });
  });
});

describe("personal mail transport", () => {
  it("rejects sandbox mail probes and leaves ordinary commands alone", () => {
    expect(isPersonalMailTransportCommand("which mail sendmail mutt; env | grep smtp")).toBe(true);
    expect(isPersonalMailTransportCommand("mail -s hi ada@example.com")).toBe(true);
    expect(isPersonalMailTransportCommand("echo hello")).toBe(false);
    const save = buildDesktopSaveExecCommand({
      fileName: "notes.txt",
      content: "do not use sendmail",
    });
    expect(isPersonalMailTransportCommand(save)).toBe(false);
  });
});

describe("production preferredNodeIds composition (attempt → seat-turn)", () => {
  it("filters stale offline approvals using collectConnectedPreferredNodeIds like attempt.ts", () => {
    const preferredNodeIds = collectConnectedPreferredNodeIds([
      { nodeId: "mac-live", connected: true },
      { nodeId: "mac-stale", connected: false },
    ]);
    expect(preferredNodeIds).toEqual(["mac-live"]);
    expect(
      decideOperatorComputerBinding({
        activeSeatId: "seat-ceo",
        operatorUserId: "emp-1",
        preferredNodeIds,
        agentId: "field-bot",
        operatorAgentIds: ["field-bot"],
        occupiedSeatIds: ["seat-ceo"],
        bindings: [],
        approvedRequests: [{ seatId: "seat-old", nodeId: "mac-stale", userId: "emp-1" }],
      }),
    ).toEqual({ permitted: false, reason: "no-binding" });
  });
});

describe("collectConnectedPreferredNodeIds", () => {
  it("keeps only connected node ids for production preferredNodeIds wiring", () => {
    expect(
      collectConnectedPreferredNodeIds([
        { nodeId: "mac-live", connected: true },
        { nodeId: "mac-stale", connected: false },
        { nodeId: "ios-1", connected: true },
        { nodeId: "  ", connected: true },
        { nodeId: "mac-live", connected: true },
      ]),
    ).toEqual(["mac-live", "ios-1"]);
  });

  it("returns [] when nothing is connected so seat-turn omits preferredNodeIds", () => {
    expect(
      collectConnectedPreferredNodeIds([
        { nodeId: "mac-stale", connected: false },
        { nodeId: "mac-offline" },
      ]),
    ).toEqual([]);
  });
});
