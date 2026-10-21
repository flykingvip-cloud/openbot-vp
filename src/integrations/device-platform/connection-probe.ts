import {
  DeviceControlHttpError,
  HttpDevicePlatformControl,
  type DeviceControlFetch,
} from "./http-control-client.js";
import type { StoredServiceCredential } from "./store.js";
import type { DevicePlatformConnection } from "./types.js";
import { assertResolvedServiceHost, assertSafeServiceBaseUrl } from "./url-safety.js";

const DEVICE_CONTRACT = "openbot.device-platform.control.v1";

const COMPATIBLE_CONTRACTS = new Set(["1", "v1", "v1-draft", DEVICE_CONTRACT]);

export type ConnectionProbeChecks = {
  health: "ok" | "failed";
  capabilities: "ok" | "failed" | "skipped";
};

export type ConnectionProbeResult = {
  connection: DevicePlatformConnection;
  checks: ConnectionProbeChecks;
  partial: boolean;
};

/**
 * Admin test-connection. GET health and GET capabilities on the device-platform
 * origin with the stored service Basic credential. A failed check never leaves
 * health as ok. Redirects are not followed.
 */
export async function probeDevicePlatformConnection(input: {
  connection: DevicePlatformConnection;
  credential: StoredServiceCredential | null;
  now: string;
  fetchImpl?: DeviceControlFetch;
  timeoutMs?: number;
}): Promise<ConnectionProbeResult> {
  const connection: DevicePlatformConnection = {
    ...input.connection,
    healthCheckedAt: input.now,
    updatedAt: input.now,
  };
  const fail = (
    code: string,
    message: string,
    checks: ConnectionProbeChecks,
  ): ConnectionProbeResult => {
    connection.health = "down";
    connection.healthCode = code;
    connection.healthError = redact(message, input.credential?.secret);
    return {
      connection,
      checks,
      partial: checks.health === "ok" && checks.capabilities !== "ok",
    };
  };

  try {
    assertSafeServiceBaseUrl(connection.serviceBaseUrl, connection.environment);
    await assertResolvedServiceHost(connection.serviceBaseUrl, connection.environment);
  } catch (error) {
    return fail(
      "URL_REJECTED",
      error instanceof Error ? error.message : "serviceBaseUrl is not allowed",
      { health: "failed", capabilities: "skipped" },
    );
  }

  if (!input.credential?.secret || !connection.clientIdentity.trim()) {
    return fail("CREDENTIAL_MISSING", "Service credential is not configured", {
      health: "failed",
      capabilities: "skipped",
    });
  }

  const client = new HttpDevicePlatformControl({
    serviceBaseUrl: connection.serviceBaseUrl,
    serviceUser: connection.clientIdentity,
    servicePassword: input.credential.secret,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  });

  try {
    await client.getHealth();
  } catch (error) {
    return fail(probeCode(error, "HEALTH_FAILED"), probeMessage(error), {
      health: "failed",
      capabilities: "skipped",
    });
  }

  // parseHealth accepts only maturity=v1-frozen. Keep v1-draft on read until that passes.
  if (connection.contractVersion === "v1-draft") {
    connection.contractVersion = "v1";
  }

  try {
    await client.getCapabilities();
  } catch (error) {
    return fail(probeCode(error, "CAPABILITIES_FAILED"), probeMessage(error), {
      health: "ok",
      capabilities: "failed",
    });
  }

  if (!COMPATIBLE_CONTRACTS.has(connection.contractVersion)) {
    return fail("CONTRACT_INCOMPATIBLE", "Contract version is not compatible", {
      health: "ok",
      capabilities: "failed",
    });
  }

  connection.health = "ok";
  connection.healthCode = "ok";
  delete connection.healthError;
  return {
    connection,
    checks: { health: "ok", capabilities: "ok" },
    partial: false,
  };
}

function probeCode(error: unknown, fallback: string): string {
  if (error instanceof DeviceControlHttpError) {
    if (error.code === "TIMEOUT" || error.code === "REDIRECT" || error.code === "CONTRACT") {
      return error.code;
    }
    return fallback;
  }
  return fallback;
}

function probeMessage(error: unknown): string {
  if (error instanceof DeviceControlHttpError) {
    return error.message;
  }
  return "Device platform check failed";
}

function redact(message: string, secret: string | undefined): string {
  let text = message.replace(/\s+/g, " ").trim() || "Device platform check failed";
  if (secret && secret.length >= 4) {
    text = text.split(secret).join("[redacted]");
  }
  return text.slice(0, 200);
}
