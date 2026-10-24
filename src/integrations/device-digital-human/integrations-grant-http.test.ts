import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetClaw4FirmwareBindForTests,
  setClaw4FirmwareServiceForTests,
} from "./claw4-firmware-bind.js";
import type { StubConfig } from "./config.js";
import { handleIntegrationsGrantHttpRequest } from "./integrations-grant-http.js";
import { DeviceDhService } from "./service.js";
import { basicHeader, pkceS256, randomId } from "./util.js";

const consentSecret = "consent-secret-16+";
const serviceSecret = "service-secret-16+";
const redirectUri = "https://device.example/callback";
const deviceId = "grant-surface-device-1";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function stubConfig(): StubConfig {
  return {
    clients: [
      {
        clientId: "consent-sim",
        secret: consentSecret,
        role: "consent",
        allowedDigitalHumanIds: ["agent-demo-1"],
        scopes: ["chat", "camera.capture", "media.read"],
      },
      {
        clientId: "device-platform",
        secret: serviceSecret,
        role: "service",
        redirectUris: [redirectUri],
      },
    ],
    digitalHumans: [
      {
        digitalHumanId: "agent-demo-1",
        displayName: "Demo Assistant",
        status: "active",
        userSubject: "user-demo",
        tenantId: "tenant-demo",
      },
    ],
  };
}

function makeService(): DeviceDhService {
  return new DeviceDhService({ config: stubConfig(), approvalToken: "test-approval" });
}

async function withHandler(
  service: DeviceDhService | undefined,
  run: (base: string) => Promise<void>,
): Promise<void> {
  resetClaw4FirmwareBindForTests();
  if (service) {
    setClaw4FirmwareServiceForTests(service);
  }
  const server = http.createServer((req, res) => {
    void handleIntegrationsGrantHttpRequest(req, res).then((owned) => {
      if (!owned && !res.writableEnded) {
        res.statusCode = 599;
        res.end("not-owned");
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    resetClaw4FirmwareBindForTests();
  }
}

describe("integrations grant HTTP (gateway co-locate)", () => {
  afterEach(() => {
    resetClaw4FirmwareBindForTests();
  });

  it("mints a grant via consent → exchange into the injected DeviceDhService", async () => {
    const service = makeService();
    await withHandler(service, async (base) => {
      const verifier = `v-${randomId(16)}`;
      const challenge = pkceS256(verifier);
      const consent = await fetch(`${base}/api/integrations/v1/consent/authorization-codes`, {
        method: "POST",
        headers: {
          authorization: basicHeader("consent-sim", consentSecret),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          serviceAudience: "device-platform",
          redirectUri,
          codeChallenge: challenge,
          codeChallengeMethod: "S256",
          digitalHumanId: "agent-demo-1",
          deviceId,
          scopes: ["chat"],
          state: "state-1",
        }),
      });
      expect(consent.status).toBe(201);
      const issued = (await consent.json()) as { authorizationCode: string };

      const exchanged = await fetch(`${base}/api/integrations/v1/grants/exchange`, {
        method: "POST",
        headers: {
          authorization: basicHeader("device-platform", serviceSecret),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          authorizationCode: issued.authorizationCode,
          codeVerifier: verifier,
          redirectUri,
        }),
      });
      expect(exchanged.status).toBe(200);
      const grant = (await exchanged.json()) as {
        authorizationRef: string;
        authorizationCredential: string;
      };
      expect(grant.authorizationRef).toMatch(/^azr_/);
      expect(grant.authorizationCredential).toBeTruthy();

      // Same in-process store: GET grant + Claw4-style requireGrant both see it.
      const got = await fetch(`${base}/api/integrations/v1/grants/${grant.authorizationRef}`, {
        headers: {
          authorization: basicHeader("device-platform", serviceSecret),
          "x-openbot-grant-credential": grant.authorizationCredential,
        },
      });
      expect(got.status).toBe(200);
      const view = (await got.json()) as { authorizationRef: string; deviceId: string };
      expect(view.authorizationRef).toBe(grant.authorizationRef);
      expect(view.deviceId).toBe(deviceId);

      const fromService = service.requireGrant(
        service.authenticate("device-platform", serviceSecret, "service"),
        grant.authorizationCredential,
        false,
      );
      expect(fromService.authorizationRef).toBe(grant.authorizationRef);
    });
  });

  it("revokes a minted grant by authorizationRef without credential (INPROCESS hash-only)", async () => {
    const service = makeService();
    await withHandler(service, async (base) => {
      const verifier = `v-${randomId(16)}`;
      const challenge = pkceS256(verifier);
      const consent = await fetch(`${base}/api/integrations/v1/consent/authorization-codes`, {
        method: "POST",
        headers: {
          authorization: basicHeader("consent-sim", consentSecret),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          serviceAudience: "device-platform",
          redirectUri,
          codeChallenge: challenge,
          codeChallengeMethod: "S256",
          digitalHumanId: "agent-demo-1",
          deviceId,
          scopes: ["chat"],
          state: "state-revoke-by-ref",
        }),
      });
      expect(consent.status).toBe(201);
      const issued = (await consent.json()) as { authorizationCode: string };
      const exchanged = await fetch(`${base}/api/integrations/v1/grants/exchange`, {
        method: "POST",
        headers: {
          authorization: basicHeader("device-platform", serviceSecret),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          authorizationCode: issued.authorizationCode,
          codeVerifier: verifier,
          redirectUri,
        }),
      });
      expect(exchanged.status).toBe(200);
      const grant = (await exchanged.json()) as {
        authorizationRef: string;
        authorizationCredential: string;
      };

      const revoked = await fetch(
        `${base}/api/integrations/v1/grants/${grant.authorizationRef}/revoke`,
        {
          method: "POST",
          headers: {
            authorization: basicHeader("device-platform", serviceSecret),
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      expect(revoked.status).toBe(200);
      const body = (await revoked.json()) as { status: string; authorizationRef: string };
      expect(body.status).toBe("revoked");
      expect(body.authorizationRef).toBe(grant.authorizationRef);

      expect(() =>
        service.requireGrant(
          service.authenticate("device-platform", serviceSecret, "service"),
          grant.authorizationCredential,
          false,
        ),
      ).toThrow(/revoked/i);
    });
  });

  it("does not claim grant paths when unbound (production fail-closed / unchanged)", async () => {
    await withHandler(undefined, async (base) => {
      const res = await fetch(`${base}/api/integrations/v1/grants/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(599);
      expect(await res.text()).toBe("not-owned");
    });
  });

  it("does not claim non-grant integrations paths even when service is injected", async () => {
    const service = makeService();
    await withHandler(service, async (base) => {
      const res = await fetch(`${base}/api/integrations/v1/conversations`, {
        method: "POST",
        headers: {
          authorization: basicHeader("device-platform", serviceSecret),
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(res.status).toBe(599);
      expect(await res.text()).toBe("not-owned");
    });
  });

  it("fail-closed 503 when INPROCESS is on but bind is misconfigured", async () => {
    resetClaw4FirmwareBindForTests();
    const prev = {
      inprocess: process.env.OPENBOT_CLAW4_FIRMWARE_INPROCESS,
      config: process.env.OPENBOT_DEVICE_DH_STUB_CONFIG,
    };
    process.env.OPENBOT_CLAW4_FIRMWARE_INPROCESS = "1";
    // Missing STUB_CONFIG → bind fails; grant surface must 503.
    delete process.env.OPENBOT_DEVICE_DH_STUB_CONFIG;

    const server = http.createServer((req, res) => {
      void handleIntegrationsGrantHttpRequest(req, res).then((owned) => {
        if (!owned && !res.writableEnded) {
          res.statusCode = 599;
          res.end("not-owned");
        }
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address() as AddressInfo;
    try {
      const res = await fetch(
        `http://127.0.0.1:${address.port}/api/integrations/v1/grants/exchange`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("UNAVAILABLE");
      expect(body.error.message).toMatch(/In-process bind failed|STUB_CONFIG/);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      restoreEnv("OPENBOT_CLAW4_FIRMWARE_INPROCESS", prev.inprocess);
      restoreEnv("OPENBOT_DEVICE_DH_STUB_CONFIG", prev.config);
      resetClaw4FirmwareBindForTests();
    }
  });

  it("env in-process bind serves consent → exchange without test inject", async () => {
    resetClaw4FirmwareBindForTests();
    const configPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "examples/stub-clients.sample.json",
    );
    const prev = {
      inprocess: process.env.OPENBOT_CLAW4_FIRMWARE_INPROCESS,
      config: process.env.OPENBOT_DEVICE_DH_STUB_CONFIG,
      placeholder: process.env.OPENBOT_DEVICE_DH_STUB_PLACEHOLDER,
      approval: process.env.OPENBOT_DEVICE_DH_APPROVAL_TOKEN,
      agent: process.env.OPENBOT_DEVICE_DH_AGENT,
    };
    process.env.OPENBOT_CLAW4_FIRMWARE_INPROCESS = "1";
    process.env.OPENBOT_DEVICE_DH_STUB_CONFIG = configPath;
    process.env.OPENBOT_DEVICE_DH_STUB_PLACEHOLDER = "1";
    process.env.OPENBOT_DEVICE_DH_APPROVAL_TOKEN = "test-approval";
    delete process.env.OPENBOT_DEVICE_DH_AGENT;

    const server = http.createServer((req, res) => {
      void handleIntegrationsGrantHttpRequest(req, res).then((owned) => {
        if (!owned && !res.writableEnded) {
          res.statusCode = 599;
          res.end("not-owned");
        }
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address() as AddressInfo;
    try {
      const verifier = `v-${randomId(16)}`;
      const consent = await fetch(
        `http://127.0.0.1:${address.port}/api/integrations/v1/consent/authorization-codes`,
        {
          method: "POST",
          headers: {
            authorization: basicHeader("consent-sim", consentSecret),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            serviceAudience: "device-platform",
            redirectUri,
            codeChallenge: pkceS256(verifier),
            codeChallengeMethod: "S256",
            digitalHumanId: "agent-demo-1",
            deviceId,
            scopes: ["chat"],
            state: "state-env",
          }),
        },
      );
      expect(consent.status).toBe(201);
      const issued = (await consent.json()) as { authorizationCode: string };
      const exchanged = await fetch(
        `http://127.0.0.1:${address.port}/api/integrations/v1/grants/exchange`,
        {
          method: "POST",
          headers: {
            authorization: basicHeader("device-platform", serviceSecret),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            authorizationCode: issued.authorizationCode,
            codeVerifier: verifier,
            redirectUri,
          }),
        },
      );
      expect(exchanged.status).toBe(200);
      const grant = (await exchanged.json()) as { authorizationRef: string };
      expect(grant.authorizationRef).toMatch(/^azr_/);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      restoreEnv("OPENBOT_CLAW4_FIRMWARE_INPROCESS", prev.inprocess);
      restoreEnv("OPENBOT_DEVICE_DH_STUB_CONFIG", prev.config);
      restoreEnv("OPENBOT_DEVICE_DH_STUB_PLACEHOLDER", prev.placeholder);
      restoreEnv("OPENBOT_DEVICE_DH_APPROVAL_TOKEN", prev.approval);
      restoreEnv("OPENBOT_DEVICE_DH_AGENT", prev.agent);
      resetClaw4FirmwareBindForTests();
    }
  });
});
