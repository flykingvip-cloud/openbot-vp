import { describe, expect, it } from "vitest";
import {
  EMPLOYEE_SHELL_BRIDGE_MESSAGE_TYPES,
  EMPLOYEE_SHELL_BRIDGE_VERSION,
  openAssistantMessage,
  openChatMessage,
  openDeviceSettingsMessage,
  openKnowledgeObjectMessage,
  openSpaceMessage,
  parseEmployeeShellBridgeJSON,
  parseEmployeeShellBridgeMessage,
  readyMessage,
  serializeEmployeeShellBridgeMessage,
  signOutMessage,
} from "./native-bridge.ts";

describe("bridge constructors round-trip through serialize/parse", () => {
  it("round-trips every constructor output", () => {
    const messages = [
      readyMessage("overview"),
      readyMessage(),
      openChatMessage({ sessionKey: "s-1", agentId: "a-1" }),
      openChatMessage(),
      openAssistantMessage({ agentId: "a-2" }),
      openSpaceMessage("space-42"),
      openKnowledgeObjectMessage("obj-1", "document"),
      openKnowledgeObjectMessage("obj-2"),
      openDeviceSettingsMessage("permissions"),
      openDeviceSettingsMessage(),
      signOutMessage(),
    ] as const;

    for (const original of messages) {
      const parsed = parseEmployeeShellBridgeJSON(serializeEmployeeShellBridgeMessage(original));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.message).toEqual(original);
        expect(parsed.message.version).toBe(EMPLOYEE_SHELL_BRIDGE_VERSION);
      }
    }
  });

  it("stamps the current version and a known type on every constructor", () => {
    const built = openSpaceMessage("s");
    expect(built.version).toBe(EMPLOYEE_SHELL_BRIDGE_VERSION);
    expect(EMPLOYEE_SHELL_BRIDGE_MESSAGE_TYPES).toContain(built.type);
  });
});

describe("parseEmployeeShellBridgeMessage rejects malformed input", () => {
  it("rejects non-objects and arrays", () => {
    expect(parseEmployeeShellBridgeMessage(null).ok).toBe(false);
    expect(parseEmployeeShellBridgeMessage("nope").ok).toBe(false);
    expect(parseEmployeeShellBridgeMessage(42).ok).toBe(false);
    expect(parseEmployeeShellBridgeMessage([]).ok).toBe(false);
  });

  it("rejects an unsupported version", () => {
    const result = parseEmployeeShellBridgeMessage({
      version: 999,
      type: "openSpace",
      payload: { spaceId: "s" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("version");
    }
  });

  it("rejects unknown types", () => {
    const result = parseEmployeeShellBridgeMessage({
      version: EMPLOYEE_SHELL_BRIDGE_VERSION,
      type: "wipeDevice",
      payload: {},
    });
    expect(result.ok).toBe(false);
  });

  it("accepts signOut with an empty payload", () => {
    const parsed = parseEmployeeShellBridgeMessage({
      version: EMPLOYEE_SHELL_BRIDGE_VERSION,
      type: "signOut",
      payload: {},
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.message.type).toBe("signOut");
      expect(parsed.message.payload).toEqual({});
    }
    const omitted = parseEmployeeShellBridgeMessage({
      version: EMPLOYEE_SHELL_BRIDGE_VERSION,
      type: "signOut",
    });
    expect(omitted.ok).toBe(true);
    expect(EMPLOYEE_SHELL_BRIDGE_MESSAGE_TYPES).toContain("signOut");
  });

  it("requires required payload fields", () => {
    const noSpace = parseEmployeeShellBridgeMessage({
      version: EMPLOYEE_SHELL_BRIDGE_VERSION,
      type: "openSpace",
      payload: {},
    });
    expect(noSpace.ok).toBe(false);

    const noObject = parseEmployeeShellBridgeMessage({
      version: EMPLOYEE_SHELL_BRIDGE_VERSION,
      type: "openKnowledgeObject",
      payload: { kind: "document" },
    });
    expect(noObject.ok).toBe(false);
  });

  it("rejects wrong types for optional fields", () => {
    const badAgent = parseEmployeeShellBridgeMessage({
      version: EMPLOYEE_SHELL_BRIDGE_VERSION,
      type: "openChat",
      payload: { agentId: 123 },
    });
    expect(badAgent.ok).toBe(false);

    const emptySpace = parseEmployeeShellBridgeMessage({
      version: EMPLOYEE_SHELL_BRIDGE_VERSION,
      type: "openSpace",
      payload: { spaceId: "   " },
    });
    expect(emptySpace.ok).toBe(false);
  });

  it("validates the ready surface against the embed contract", () => {
    const good = parseEmployeeShellBridgeMessage({
      version: EMPLOYEE_SHELL_BRIDGE_VERSION,
      type: "ready",
      payload: { surface: "workspace" },
    });
    expect(good.ok).toBe(true);

    const bad = parseEmployeeShellBridgeMessage({
      version: EMPLOYEE_SHELL_BRIDGE_VERSION,
      type: "ready",
      payload: { surface: "assistant" }, // chat is native, not an embed surface
    });
    expect(bad.ok).toBe(false);
  });

  it("rejects invalid JSON", () => {
    expect(parseEmployeeShellBridgeJSON("{not json").ok).toBe(false);
  });
});

describe("bridge constructor guards", () => {
  it("throws on empty required ids", () => {
    expect(() => openSpaceMessage("")).toThrow(TypeError);
    expect(() => openKnowledgeObjectMessage("")).toThrow(TypeError);
  });
});
