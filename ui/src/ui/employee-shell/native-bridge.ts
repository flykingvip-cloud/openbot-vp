/**
 * Tri-Platform Employee Shell — native bridge protocol (Phase 1).
 *
 * A small, versioned, strictly-typed message protocol the embedded Employee
 * Shell (web) uses to ask its native host (macOS / iOS / Android) to perform
 * native-only actions: jump to a collaboration space, open a knowledge object,
 * open device/companion settings, or sign out. `openChat` / `openAssistant`
 * stay as bridge INTENTS; hosts route them into the same embed surfaces as web.
 *
 * Messages cross a trust boundary (web <-> native), so every inbound message is
 * validated as UNTRUSTED input via `parseEmployeeShellBridgeMessage`. There is
 * no `any`: unknown shapes are rejected with a reason, never coerced.
 */

import { isEmployeeEmbedSurface, type EmployeeEmbedSurface } from "./embed-routes.ts";

/** Bump when the wire shape changes incompatibly. */
export const EMPLOYEE_SHELL_BRIDGE_VERSION = 1 as const;

/** All bridge intents the employee shell can emit toward its native host. */
export const EMPLOYEE_SHELL_BRIDGE_MESSAGE_TYPES = [
  "ready",
  "openChat",
  "openAssistant",
  "openSpace",
  "openKnowledgeObject",
  "openDeviceSettings",
  "signOut",
] as const;

export type EmployeeShellBridgeMessageType = (typeof EMPLOYEE_SHELL_BRIDGE_MESSAGE_TYPES)[number];

/** Payload shape per message type. */
export type EmployeeShellBridgePayloadMap = {
  /** Handshake: the embed finished loading (optionally reports which surface). */
  ready: { surface?: EmployeeEmbedSurface };
  /** Open a native conversation, optionally targeting a session and/or agent. */
  openChat: { sessionKey?: string; agentId?: string };
  /** Open the native assistant, optionally for a specific agent. */
  openAssistant: { agentId?: string };
  /** Open a collaboration space by id. */
  openSpace: { spaceId: string };
  /** Open a knowledge object by id (optionally typed). */
  openKnowledgeObject: { objectId: string; kind?: string };
  /** Open device/companion settings (optionally a specific section). */
  openDeviceSettings: { section?: string };
  /** Clear the native PlatformAuth session (web logout in a WKWebView host). */
  signOut: Record<string, never>;
};

/** A validated, versioned bridge message (discriminated on `type`). */
export type EmployeeShellBridgeMessage = {
  [K in EmployeeShellBridgeMessageType]: {
    version: typeof EMPLOYEE_SHELL_BRIDGE_VERSION;
    type: K;
    payload: EmployeeShellBridgePayloadMap[K];
  };
}[EmployeeShellBridgeMessageType];

/** Result of validating an untrusted inbound message. */
export type BridgeParseResult =
  | { ok: true; message: EmployeeShellBridgeMessage }
  | { ok: false; error: string };

const MESSAGE_TYPE_SET: ReadonlySet<string> = new Set(EMPLOYEE_SHELL_BRIDGE_MESSAGE_TYPES);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Optional field: absent/undefined is fine, but if present it must be a non-empty string. */
function optionalString(
  record: Record<string, unknown>,
  key: string,
): { ok: true } | { ok: false } {
  const value = record[key];
  if (value === undefined) {
    return { ok: true };
  }
  return isNonEmptyString(value) ? { ok: true } : { ok: false };
}

function validatePayload(
  type: EmployeeShellBridgeMessageType,
  payloadRaw: unknown,
):
  | { ok: true; payload: EmployeeShellBridgePayloadMap[EmployeeShellBridgeMessageType] }
  | { ok: false; error: string } {
  // Payload may be omitted for intents that have no required fields.
  const record = payloadRaw === undefined ? {} : asRecord(payloadRaw);
  if (record === null) {
    return { ok: false, error: `payload must be an object for "${type}"` };
  }

  switch (type) {
    case "ready": {
      const { surface } = record;
      if (surface !== undefined && !isEmployeeEmbedSurface(surface)) {
        return { ok: false, error: "ready.surface must be a known employee surface" };
      }
      return { ok: true, payload: surface === undefined ? {} : { surface } };
    }
    case "openChat": {
      if (!optionalString(record, "sessionKey").ok) {
        return { ok: false, error: "openChat.sessionKey must be a non-empty string when present" };
      }
      if (!optionalString(record, "agentId").ok) {
        return { ok: false, error: "openChat.agentId must be a non-empty string when present" };
      }
      const payload: EmployeeShellBridgePayloadMap["openChat"] = {};
      if (record.sessionKey !== undefined) {
        payload.sessionKey = record.sessionKey as string;
      }
      if (record.agentId !== undefined) {
        payload.agentId = record.agentId as string;
      }
      return { ok: true, payload };
    }
    case "openAssistant": {
      if (!optionalString(record, "agentId").ok) {
        return {
          ok: false,
          error: "openAssistant.agentId must be a non-empty string when present",
        };
      }
      const payload: EmployeeShellBridgePayloadMap["openAssistant"] = {};
      if (record.agentId !== undefined) {
        payload.agentId = record.agentId as string;
      }
      return { ok: true, payload };
    }
    case "openSpace": {
      if (!isNonEmptyString(record.spaceId)) {
        return { ok: false, error: "openSpace.spaceId is required and must be a non-empty string" };
      }
      return { ok: true, payload: { spaceId: record.spaceId } };
    }
    case "openKnowledgeObject": {
      if (!isNonEmptyString(record.objectId)) {
        return {
          ok: false,
          error: "openKnowledgeObject.objectId is required and must be a non-empty string",
        };
      }
      if (!optionalString(record, "kind").ok) {
        return {
          ok: false,
          error: "openKnowledgeObject.kind must be a non-empty string when present",
        };
      }
      const payload: EmployeeShellBridgePayloadMap["openKnowledgeObject"] = {
        objectId: record.objectId,
      };
      if (record.kind !== undefined) {
        payload.kind = record.kind as string;
      }
      return { ok: true, payload };
    }
    case "openDeviceSettings": {
      if (!optionalString(record, "section").ok) {
        return {
          ok: false,
          error: "openDeviceSettings.section must be a non-empty string when present",
        };
      }
      const payload: EmployeeShellBridgePayloadMap["openDeviceSettings"] = {};
      if (record.section !== undefined) {
        payload.section = record.section as string;
      }
      return { ok: true, payload };
    }
    case "signOut": {
      return { ok: true, payload: {} };
    }
    default: {
      // Exhaustiveness guard: if a new type is added without a case, TS errors here.
      const exhaustive: never = type;
      return { ok: false, error: `unhandled message type: ${String(exhaustive)}` };
    }
  }
}

/**
 * Validate an untrusted value as a bridge message. Returns a discriminated
 * result rather than throwing, so hosts can log-and-drop malformed input.
 */
export function parseEmployeeShellBridgeMessage(raw: unknown): BridgeParseResult {
  const record = asRecord(raw);
  if (record === null) {
    return { ok: false, error: "message must be a non-null object" };
  }
  if (record.version !== EMPLOYEE_SHELL_BRIDGE_VERSION) {
    return {
      ok: false,
      error: `unsupported bridge version: expected ${EMPLOYEE_SHELL_BRIDGE_VERSION}, got ${String(record.version)}`,
    };
  }
  const type = record.type;
  if (typeof type !== "string" || !MESSAGE_TYPE_SET.has(type)) {
    return { ok: false, error: `unknown message type: ${String(type)}` };
  }
  const validated = validatePayload(type as EmployeeShellBridgeMessageType, record.payload);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }
  return {
    ok: true,
    message: {
      version: EMPLOYEE_SHELL_BRIDGE_VERSION,
      type,
      payload: validated.payload,
    } as EmployeeShellBridgeMessage,
  };
}

/** Parse a JSON string into a bridge message (rejects malformed JSON). */
export function parseEmployeeShellBridgeJSON(json: string): BridgeParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  return parseEmployeeShellBridgeMessage(raw);
}

/** Serialize a bridge message for transport to the native host. */
export function serializeEmployeeShellBridgeMessage(message: EmployeeShellBridgeMessage): string {
  return JSON.stringify(message);
}

// ---- typed constructors (build valid messages from the web side) ------------

type MessageOfType<K extends EmployeeShellBridgeMessageType> = Extract<
  EmployeeShellBridgeMessage,
  { type: K }
>;

function message<K extends EmployeeShellBridgeMessageType>(
  type: K,
  payload: EmployeeShellBridgePayloadMap[K],
): MessageOfType<K> {
  return { version: EMPLOYEE_SHELL_BRIDGE_VERSION, type, payload } as MessageOfType<K>;
}

export function readyMessage(surface?: EmployeeEmbedSurface): MessageOfType<"ready"> {
  return message("ready", surface === undefined ? {} : { surface });
}

export function openChatMessage(
  payload: EmployeeShellBridgePayloadMap["openChat"] = {},
): MessageOfType<"openChat"> {
  return message("openChat", payload);
}

export function openAssistantMessage(
  payload: EmployeeShellBridgePayloadMap["openAssistant"] = {},
): MessageOfType<"openAssistant"> {
  return message("openAssistant", payload);
}

export function openSpaceMessage(spaceId: string): MessageOfType<"openSpace"> {
  if (!isNonEmptyString(spaceId)) {
    throw new TypeError("openSpaceMessage: spaceId must be a non-empty string");
  }
  return message("openSpace", { spaceId });
}

export function openKnowledgeObjectMessage(
  objectId: string,
  kind?: string,
): MessageOfType<"openKnowledgeObject"> {
  if (!isNonEmptyString(objectId)) {
    throw new TypeError("openKnowledgeObjectMessage: objectId must be a non-empty string");
  }
  return message("openKnowledgeObject", kind === undefined ? { objectId } : { objectId, kind });
}

export function openDeviceSettingsMessage(section?: string): MessageOfType<"openDeviceSettings"> {
  return message("openDeviceSettings", section === undefined ? {} : { section });
}

export function signOutMessage(): MessageOfType<"signOut"> {
  return message("signOut", {});
}
