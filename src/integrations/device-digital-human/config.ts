import { readFileSync } from "node:fs";
import { DeviceDhError } from "./errors.js";
import type { AssistantProfile, ClientRole } from "./types.js";
import { isRecord } from "./util.js";

export type StubClientConfig = {
  clientId: string;
  secret: string;
  role: ClientRole;
  allowedDigitalHumanIds?: string[];
  scopes?: string[];
  redirectUris?: string[];
};

const GATEWAY_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export type DigitalHumanConfig = {
  digitalHumanId: string;
  displayName: string;
  avatar?: string;
  animationManifestUrl?: string;
  locale?: string;
  voiceHint?: string;
  status?: "active" | "disabled";
  userSubject: string;
  tenantId: string;
  /**
   * Gateway agent this digital human executes. Required when agent mode is on.
   * Not an HTTP contract field.
   */
  gatewayAgentId?: string;
  /** Defaults to `[gatewayAgentId]` when omitted. */
  allowedGatewayAgentIds?: string[];
};

export type StubConfig = {
  clients: StubClientConfig[];
  digitalHumans: DigitalHumanConfig[];
};

const MIN_SECRET = 16;

function asStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new DeviceDhError("PARAM_UNSUPPORTED", "Expected a string array in stub config");
  }
  return value;
}

function parseClient(value: unknown): StubClientConfig {
  if (!isRecord(value)) {
    throw new DeviceDhError("PARAM_UNSUPPORTED", "Invalid stub client");
  }
  const clientId = value.clientId;
  const secret = value.secret;
  const role = value.role;
  if (typeof clientId !== "string" || clientId.length === 0) {
    throw new DeviceDhError("PARAM_UNSUPPORTED", "clientId is required");
  }
  if (typeof secret !== "string" || secret.length < MIN_SECRET) {
    throw new DeviceDhError("PARAM_UNSUPPORTED", "Client secret must be at least 16 characters");
  }
  if (role !== "consent" && role !== "service") {
    throw new DeviceDhError("PARAM_UNSUPPORTED", "Client role must be consent or service");
  }
  return {
    clientId,
    secret,
    role,
    allowedDigitalHumanIds: asStringArray(value.allowedDigitalHumanIds),
    scopes: asStringArray(value.scopes),
    redirectUris: asStringArray(value.redirectUris),
  };
}

function parseHuman(value: unknown): DigitalHumanConfig {
  if (!isRecord(value)) {
    throw new DeviceDhError("PARAM_UNSUPPORTED", "Invalid digital human");
  }
  const digitalHumanId = value.digitalHumanId;
  const displayName = value.displayName;
  const userSubject = value.userSubject;
  const tenantId = value.tenantId;
  if (
    typeof digitalHumanId !== "string" ||
    typeof displayName !== "string" ||
    typeof userSubject !== "string" ||
    typeof tenantId !== "string"
  ) {
    throw new DeviceDhError(
      "PARAM_UNSUPPORTED",
      "digitalHumanId, displayName, userSubject, and tenantId are required",
    );
  }
  const status = value.status;
  if (status !== undefined && status !== "active" && status !== "disabled") {
    throw new DeviceDhError("PARAM_UNSUPPORTED", "digital human status is invalid");
  }
  const gatewayAgentId = parseGatewayAgentId(value.gatewayAgentId);
  const allowedGatewayAgentIds = parseAllowedGatewayAgentIds(value.allowedGatewayAgentIds);
  return {
    digitalHumanId,
    displayName,
    avatar: typeof value.avatar === "string" ? value.avatar : undefined,
    animationManifestUrl:
      typeof value.animationManifestUrl === "string" ? value.animationManifestUrl : undefined,
    locale: typeof value.locale === "string" ? value.locale : undefined,
    voiceHint: typeof value.voiceHint === "string" ? value.voiceHint : undefined,
    status,
    userSubject,
    tenantId,
    ...(gatewayAgentId ? { gatewayAgentId } : {}),
    ...(allowedGatewayAgentIds ? { allowedGatewayAgentIds } : {}),
  };
}

function parseGatewayAgentId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !GATEWAY_AGENT_ID.test(value)) {
    throw new DeviceDhError("PARAM_UNSUPPORTED", "gatewayAgentId is invalid");
  }
  return value;
}

function parseAllowedGatewayAgentIds(value: unknown): string[] | undefined {
  const list = asStringArray(value);
  if (!list) {
    return undefined;
  }
  for (const id of list) {
    if (!GATEWAY_AGENT_ID.test(id)) {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "allowedGatewayAgentIds is invalid");
    }
  }
  return list;
}

export function parseStubConfig(value: unknown): StubConfig {
  if (!isRecord(value) || !Array.isArray(value.clients) || !Array.isArray(value.digitalHumans)) {
    throw new DeviceDhError("PARAM_UNSUPPORTED", "Stub config requires clients and digitalHumans");
  }
  const clients = value.clients.map(parseClient);
  const digitalHumans = value.digitalHumans.map(parseHuman);
  const ids = new Set<string>();
  for (const client of clients) {
    if (ids.has(client.clientId)) {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "Duplicate clientId in stub config");
    }
    ids.add(client.clientId);
  }
  if (digitalHumans.length === 0) {
    throw new DeviceDhError("PARAM_UNSUPPORTED", "At least one digital human is required");
  }
  return { clients, digitalHumans };
}

export function loadStubConfig(path: string): StubConfig {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  return parseStubConfig(raw);
}

export function assistantFromHuman(human: DigitalHumanConfig): AssistantProfile {
  return {
    digitalHumanId: human.digitalHumanId,
    displayName: human.displayName,
    ...(human.avatar ? { avatar: human.avatar } : {}),
    ...(human.animationManifestUrl ? { animationManifestUrl: human.animationManifestUrl } : {}),
    ...(human.locale ? { locale: human.locale } : {}),
    ...(human.voiceHint ? { voiceHint: human.voiceHint } : {}),
    status: human.status ?? "active",
  };
}
