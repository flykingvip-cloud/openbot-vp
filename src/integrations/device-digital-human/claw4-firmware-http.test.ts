import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createClaw4FirmwareServiceFromEnv,
  resetClaw4FirmwareBindForTests,
  resolveClaw4FirmwareService,
} from "./claw4-firmware-bind.js";
import {
  handleClaw4FirmwareHttpRequest,
  setClaw4FirmwareServiceForTests,
} from "./claw4-firmware-http.js";
import type { StubConfig } from "./config.js";
import { listenDeviceDh } from "./http.js";
import { DeviceDhService } from "./service.js";
import { basicHeader, pkceS256, randomId } from "./util.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "examples/fixtures");

const consentSecret = "consent-secret-16+";
const serviceSecret = "service-secret-16+";
const redirectUri = "https://device.example/callback";
const deviceId = "claw4-device-1";

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

async function exchangeGrant(service: DeviceDhService): Promise<{
  authorizationRef: string;
  credential: string;
  headers: Record<string, string>;
}> {
  const verifier = `v-${randomId(16)}`;
  const consent = service.authenticate("consent-sim", consentSecret, "consent");
  const issued = service.issueAuthorizationCode(
    consent,
    {
      serviceAudience: "device-platform",
      redirectUri,
      codeChallenge: pkceS256(verifier),
      codeChallengeMethod: "S256",
      digitalHumanId: "agent-demo-1",
      deviceId,
      scopes: ["chat"],
      state: "state-1",
    },
    "trace-issue",
  );
  const client = service.authenticate("device-platform", serviceSecret, "service");
  const exchanged = service.exchangeGrant(
    client,
    {
      authorizationCode: issued.authorizationCode,
      codeVerifier: verifier,
      redirectUri,
    },
    undefined,
    "trace-exchange",
  );
  const credential = String(exchanged.authorizationCredential);
  return {
    authorizationRef: String(exchanged.authorizationRef),
    credential,
    headers: {
      authorization: basicHeader("device-platform", serviceSecret),
      "x-openbot-grant-credential": credential,
      "x-device-id": deviceId,
    },
  };
}

async function withGateway(
  service: DeviceDhService,
  run: (base: string) => Promise<void>,
): Promise<void> {
  setClaw4FirmwareServiceForTests(service);
  const server = http.createServer((req, res) => {
    void handleClaw4FirmwareHttpRequest(req, res).then((owned) => {
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
    setClaw4FirmwareServiceForTests(undefined);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("claw4 firmware HTTP compat (B1)", () => {
  afterEach(() => {
    resetClaw4FirmwareBindForTests();
  });

  it("upload happy-path returns {code:0,data:{text,conversationId}} and lists messages", async () => {
    const service = new DeviceDhService({ config: stubConfig(), approvalToken: "test-approval" });
    const grant = await exchangeGrant(service);

    await withGateway(service, async (base) => {
      const wav = Buffer.from("RIFF....WAVEfmt "); // minimal non-empty body
      const upload = await fetch(`${base}/api/v1/upload`, {
        method: "POST",
        headers: {
          ...grant.headers,
          "content-type": "audio/wav",
          // Fetch Headers are ByteString; use ASCII pass-through in tests.
          "x-transcript-text": "hello-claw4",
        },
        body: wav,
      });
      expect(upload.status).toBe(200);
      const body = (await upload.json()) as {
        code: number;
        data: { text: string; conversationId: string };
      };
      expect(body.code).toBe(0);
      expect(body.data.text).toBe("hello-claw4");
      expect(body.data.conversationId).toMatch(/^conv_/);

      // Wait briefly for placeholder model to finish visible text.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const messages = await fetch(
        `${base}/api/v1/conversation/${body.data.conversationId}/messages`,
        { headers: grant.headers },
      );
      expect(messages.status).toBe(200);
      const listed = (await messages.json()) as {
        code: number;
        data: { messages: Array<{ role: string; text: string }> };
      };
      expect(listed.code).toBe(0);
      expect(listed.data.messages.some((m) => m.role === "user" && m.text === "hello-claw4")).toBe(
        true,
      );
    });
  });

  it("revoked device fails immediately on upload and messages", async () => {
    const service = new DeviceDhService({ config: stubConfig(), approvalToken: "test-approval" });
    const grant = await exchangeGrant(service);
    const client = service.authenticate("device-platform", serviceSecret, "service");
    const active = service.requireGrant(client, grant.credential, false);
    service.revokeGrant(active, grant.authorizationRef, "trace-revoke");

    await withGateway(service, async (base) => {
      const upload = await fetch(`${base}/api/v1/upload`, {
        method: "POST",
        headers: {
          ...grant.headers,
          "content-type": "audio/wav",
          "x-transcript-text": "should-not-run",
        },
        body: Buffer.from("RIFF"),
      });
      expect(upload.status).toBe(401);
      const uploadBody = (await upload.json()) as {
        code: number;
        error: { code: string };
      };
      expect(uploadBody.code).toBe(401);
      expect(uploadBody.error.code).toBe("AUTH_REVOKED");

      const messages = await fetch(`${base}/api/v1/conversation/conv_missing/messages`, {
        headers: grant.headers,
      });
      expect(messages.status).toBe(401);
      const msgBody = (await messages.json()) as { error: { code: string } };
      expect(msgBody.error.code).toBe("AUTH_REVOKED");
    });
  });

  it("rejects camera media content-types on upload", async () => {
    const service = new DeviceDhService({ config: stubConfig(), approvalToken: "test-approval" });
    const grant = await exchangeGrant(service);
    await withGateway(service, async (base) => {
      const upload = await fetch(`${base}/api/v1/upload`, {
        method: "POST",
        headers: {
          ...grant.headers,
          "content-type": "image/jpeg",
        },
        body: Buffer.from([0xff, 0xd8, 0xff]),
      });
      expect(upload.status).toBe(400);
      const body = (await upload.json()) as { error: { code: string }; message: string };
      expect(body.error.code).toBe("PARAM_UNSUPPORTED");
      expect(body.message.toLowerCase()).toContain("audio/wav");
    });
  });

  it("adjacent stub serves the same firmware routes", async () => {
    const service = new DeviceDhService({ config: stubConfig(), approvalToken: "test-approval" });
    const listening = await listenDeviceDh({ service, fixtureDir, port: 0 });
    try {
      const grant = await exchangeGrant(service);
      const upload = await fetch(`${listening.url}/api/v1/upload?conversationId=`, {
        method: "POST",
        headers: {
          ...grant.headers,
          "content-type": "audio/wav",
        },
        body: Buffer.from("RIFF stub wav"),
      });
      expect(upload.status).toBe(200);
      const body = (await upload.json()) as {
        code: number;
        data: { text: string; conversationId: string };
      };
      expect(body.code).toBe(0);
      expect(body.data.text).toContain("claw4-asr-stub");
      expect(body.data.conversationId).toMatch(/^conv_/);

      const record = await fetch(`${listening.url}/api/v1/record/upload`, {
        method: "POST",
        headers: grant.headers,
        body: Buffer.from("later"),
      });
      expect(record.status).toBe(200);
      const reserved = (await record.json()) as {
        code: number;
        data: { reserved?: boolean };
      };
      expect(reserved.code).toBe(0);
      expect(reserved.data.reserved).toBe(true);
    } finally {
      await listening.close();
    }
  });

  it("returns 503 UNAVAILABLE when no DeviceDhService is bound", async () => {
    resetClaw4FirmwareBindForTests();
    const server = http.createServer((req, res) => {
      void handleClaw4FirmwareHttpRequest(req, res).then((owned) => {
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
      const upload = await fetch(`http://127.0.0.1:${address.port}/api/v1/upload`, {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: Buffer.from("RIFF"),
      });
      expect(upload.status).toBe(503);
      const body = (await upload.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("UNAVAILABLE");
      expect(body.error.message.toLowerCase()).toContain("openbot_claw4_firmware_inprocess");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("env in-process bind creates a usable DeviceDhService without test inject", async () => {
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

    try {
      expect(createClaw4FirmwareServiceFromEnv()).toBeTruthy();
      const resolved = resolveClaw4FirmwareService();
      expect(resolved).toBeTruthy();

      const grant = await exchangeGrant(resolved!);
      // No setClaw4FirmwareServiceForTests — handler must use env-bound singleton.
      const server = http.createServer((req, res) => {
        void handleClaw4FirmwareHttpRequest(req, res).then((owned) => {
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
        const upload = await fetch(`http://127.0.0.1:${address.port}/api/v1/upload`, {
          method: "POST",
          headers: {
            ...grant.headers,
            "content-type": "audio/wav",
            "x-transcript-text": "hello-inprocess",
          },
          body: Buffer.from("RIFF....WAVEfmt "),
        });
        expect(upload.status).toBe(200);
        const body = (await upload.json()) as {
          code: number;
          data: { text: string; conversationId: string };
        };
        expect(body.code).toBe(0);
        expect(body.data.text).toBe("hello-inprocess");
        expect(body.data.conversationId).toMatch(/^conv_/);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      restoreEnv("OPENBOT_CLAW4_FIRMWARE_INPROCESS", prev.inprocess);
      restoreEnv("OPENBOT_DEVICE_DH_STUB_CONFIG", prev.config);
      restoreEnv("OPENBOT_DEVICE_DH_STUB_PLACEHOLDER", prev.placeholder);
      restoreEnv("OPENBOT_DEVICE_DH_APPROVAL_TOKEN", prev.approval);
      restoreEnv("OPENBOT_DEVICE_DH_AGENT", prev.agent);
      resetClaw4FirmwareBindForTests();
    }
  });

  it("env bind stays off without OPENBOT_CLAW4_FIRMWARE_INPROCESS", () => {
    resetClaw4FirmwareBindForTests();
    const configPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "examples/stub-clients.sample.json",
    );
    expect(
      createClaw4FirmwareServiceFromEnv({
        OPENBOT_DEVICE_DH_STUB_CONFIG: configPath,
      }),
    ).toBeUndefined();
    expect(resolveClaw4FirmwareService({}, {})).toBeUndefined();
  });
});
