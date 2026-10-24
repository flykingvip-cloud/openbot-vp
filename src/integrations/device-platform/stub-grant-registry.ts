import { randomBytes } from "node:crypto";
import { basicHeader, pkceS256, randomId } from "../device-digital-human/util.js";
import { DevicePlatformError } from "./types.js";

const DEFAULT_STUB_ORIGIN = "http://127.0.0.1:8787";
const DEFAULT_REDIRECT_URI = "https://device.example/callback";

export type StubGrantView = {
  authorizationRef: string;
  bindingVersion: number;
  digitalHumanId: string;
  deviceId: string;
  status?: string;
  assistant?: Record<string, unknown>;
  authorizationCredential?: string;
};

export type StubGrantIssue = StubGrantView & {
  authorizationCredential: string;
};

export type StubGrantRegistry = {
  issue(input: {
    digitalHumanId: string;
    deviceId: string;
    scopes: string[];
    serviceAudience: string;
  }): Promise<StubGrantIssue>;
  rebind(input: { authorizationRef: string; digitalHumanId: string }): Promise<StubGrantView>;
  revoke(input: {
    authorizationRef: string;
    /** When omitted, integrations revoke-by-ref (service Basic auth owns the grant). */
    authorizationCredential?: string;
  }): Promise<StubGrantView>;
};

export type HttpStubGrantRegistryOptions = {
  origin: string;
  consentUser: string;
  consentPassword: string;
  serviceUser: string;
  servicePassword: string;
  redirectUri?: string;
  fetchImpl?: typeof fetch;
};

/**
 * Writes grants into the integrations stub process that device-control reads.
 * Exchange, rebind, and revoke all land in that process's grant map.
 */
export class HttpStubGrantRegistry implements StubGrantRegistry {
  private readonly origin: string;
  private readonly consentAuthorization: string;
  private readonly serviceAuthorization: string;
  private readonly redirectUri: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpStubGrantRegistryOptions) {
    this.origin = assertLoopbackStubOrigin(options.origin);
    this.consentAuthorization = basicHeader(options.consentUser, options.consentPassword);
    this.serviceAuthorization = basicHeader(options.serviceUser, options.servicePassword);
    this.redirectUri = options.redirectUri?.trim() || DEFAULT_REDIRECT_URI;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async issue(input: {
    digitalHumanId: string;
    deviceId: string;
    scopes: string[];
    serviceAudience: string;
  }): Promise<StubGrantIssue> {
    const verifier = randomBytes(32).toString("base64url");
    const issued = await this.request("/api/integrations/v1/consent/authorization-codes", {
      authorization: this.consentAuthorization,
      body: {
        serviceAudience: input.serviceAudience,
        redirectUri: this.redirectUri,
        codeChallenge: pkceS256(verifier),
        codeChallengeMethod: "S256",
        digitalHumanId: input.digitalHumanId,
        deviceId: input.deviceId,
        scopes: input.scopes,
        state: `st_${randomId(8)}`,
      },
    });
    const authorizationCode = readString(issued, "authorizationCode");
    if (!authorizationCode) {
      throw new DevicePlatformError(
        "PLATFORM_UNAVAILABLE",
        "Integrations stub did not issue an authorization code",
      );
    }
    const exchanged = await this.request("/api/integrations/v1/grants/exchange", {
      authorization: this.serviceAuthorization,
      body: {
        authorizationCode,
        codeVerifier: verifier,
        redirectUri: this.redirectUri,
      },
    });
    return parseIssue(exchanged);
  }

  async rebind(input: {
    authorizationRef: string;
    digitalHumanId: string;
  }): Promise<StubGrantView> {
    const updated = await this.request(
      `/api/integrations/v1/grants/${encodeURIComponent(input.authorizationRef)}/rebind`,
      {
        authorization: this.consentAuthorization,
        body: { digitalHumanId: input.digitalHumanId },
      },
    );
    const view = parseView(updated);
    if (!view.assistant) {
      throw new DevicePlatformError(
        "PLATFORM_UNAVAILABLE",
        "Integrations stub grant view is incomplete",
      );
    }
    return view;
  }

  async revoke(input: {
    authorizationRef: string;
    authorizationCredential?: string;
  }): Promise<StubGrantView> {
    const revoked = await this.request(
      `/api/integrations/v1/grants/${encodeURIComponent(input.authorizationRef)}/revoke`,
      {
        authorization: this.serviceAuthorization,
        ...(input.authorizationCredential ? { credential: input.authorizationCredential } : {}),
        body: {},
      },
    );
    return parseView(revoked);
  }

  private async request(
    pathname: string,
    options: { authorization: string; credential?: string; body: Record<string, unknown> },
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.origin}${pathname}`, {
        method: "POST",
        headers: {
          authorization: options.authorization,
          "content-type": "application/json",
          ...(options.credential ? { "x-openbot-grant-credential": options.credential } : {}),
        },
        body: JSON.stringify(options.body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new DevicePlatformError(
        "PLATFORM_UNAVAILABLE",
        "Integrations stub did not accept the grant call",
      );
    }
    const json = await readJson(response);
    if (!response.ok) {
      // 404: grant already gone on stub (e.g. INPROCESS restart wiped memory).
      if (response.status === 404) {
        throw new DevicePlatformError(
          "NOT_FOUND",
          "Integrations stub grant was not found to revoke",
        );
      }
      throw new DevicePlatformError(
        "PLATFORM_UNAVAILABLE",
        "Integrations stub rejected the grant call",
      );
    }
    return json;
  }
}

/** Enables stub registration only when both consent and service Basic pairs are present. */
export function stubGrantRegistryFromEnv(
  env: NodeJS.ProcessEnv,
): HttpStubGrantRegistry | undefined {
  const consentUser = env.OPENBOT_STUB_CONSENT_USER?.trim() ?? "";
  const consentPassword = env.OPENBOT_STUB_CONSENT_PASSWORD ?? "";
  const serviceUser = env.OPENBOT_STUB_SERVICE_USER?.trim() ?? "";
  const servicePassword = env.OPENBOT_STUB_SERVICE_PASSWORD ?? "";
  if (!consentUser || !consentPassword || !serviceUser || !servicePassword) {
    return undefined;
  }
  return new HttpStubGrantRegistry({
    origin: env.OPENBOT_DEVICE_DH_STUB_URL?.trim() || DEFAULT_STUB_ORIGIN,
    consentUser,
    consentPassword,
    serviceUser,
    servicePassword,
    redirectUri: env.OPENBOT_STUB_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI,
  });
}

export function assertLoopbackStubOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new DevicePlatformError("VALIDATION", "Integrations stub origin is invalid");
  }
  if (url.username || url.password) {
    throw new DevicePlatformError(
      "SECRET_REJECTED",
      "Integrations stub origin must not contain credentials",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DevicePlatformError("VALIDATION", "Integrations stub origin is invalid");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new DevicePlatformError("VALIDATION", "Integrations stub origin must be loopback");
  }
  return url.origin;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseView(json: Record<string, unknown>): StubGrantView {
  const authorizationRef = readString(json, "authorizationRef");
  const digitalHumanId = readString(json, "digitalHumanId");
  const deviceId = readString(json, "deviceId");
  const bindingVersion = json.bindingVersion;
  const assistant = json.assistant;
  if (!authorizationRef || !digitalHumanId || !deviceId || typeof bindingVersion !== "number") {
    throw new DevicePlatformError(
      "PLATFORM_UNAVAILABLE",
      "Integrations stub grant view is incomplete",
    );
  }
  const status = readString(json, "status");
  const assistantRecord =
    assistant && typeof assistant === "object" && !Array.isArray(assistant)
      ? (assistant as Record<string, unknown>)
      : undefined;
  return {
    authorizationRef,
    bindingVersion,
    digitalHumanId,
    deviceId,
    ...(status ? { status } : {}),
    ...(assistantRecord ? { assistant: assistantRecord } : {}),
  };
}

function parseIssue(json: Record<string, unknown>): StubGrantIssue {
  const view = parseView(json);
  const authorizationCredential = readString(json, "authorizationCredential");
  if (!authorizationCredential || !view.assistant) {
    throw new DevicePlatformError(
      "PLATFORM_UNAVAILABLE",
      "Integrations stub exchange did not return a credential",
    );
  }
  return { ...view, authorizationCredential, assistant: view.assistant };
}
