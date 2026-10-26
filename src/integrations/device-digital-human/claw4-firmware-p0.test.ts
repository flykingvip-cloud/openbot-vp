import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEVICE_SDK_AUDIO_BRIDGE_SHA,
  assertSpeakingTtsProvider,
  bindClaw4AudioBridgeFromCreateAudioBridge,
  getClaw4AudioBridge,
  resetClaw4AudioBridgeForTests,
  setClaw4AudioBridge,
  type AgentACreateAudioBridge,
  type Claw4AsrProvider,
  type Claw4TtsProvider,
} from "./claw4-audio-bridge.js";
import { resetClaw4FirmwareBindForTests } from "./claw4-firmware-bind.js";
import {
  CLAW4_ASR_STUB_ENV,
  redactClaw4UploadUrlForLog,
  resolveClaw4Transcript,
  resolveClaw4UploadIdempotencyKey,
} from "./claw4-firmware-compat.js";
import {
  handleClaw4FirmwareHttpRequest,
  setClaw4FirmwareServiceForTests,
} from "./claw4-firmware-http.js";
import type { StubConfig } from "./config.js";
import { handleIntegrationsGrantHttpRequest } from "./integrations-grant-http.js";
import { DeviceDhService } from "./service.js";
import { basicHeader, pkceS256, randomId } from "./util.js";

const consentSecret = "consent-secret-16+";
const serviceSecret = "service-secret-16+";
const redirectUri = "https://device.example/callback";
const deviceId = "claw4-device-p0";

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
  if (!("authorizationCredential" in exchanged) || !("authorizationRef" in exchanged)) {
    throw new Error(`authorization exchange incomplete: ${JSON.stringify(exchanged)}`);
  }
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

describe("claw4 firmware P0 revision", () => {
  afterEach(() => {
    resetClaw4FirmwareBindForTests();
    resetClaw4AudioBridgeForTests();
    delete process.env[CLAW4_ASR_STUB_ENV];
  });

  it("formal mode rejects stub ASR when bridge and transcript are absent", async () => {
    delete process.env[CLAW4_ASR_STUB_ENV];
    const service = new DeviceDhService({ config: stubConfig(), approvalToken: "test-approval" });
    const grant = await exchangeGrant(service);
    await withGateway(service, async (base) => {
      const upload = await fetch(`${base}/api/v1/upload`, {
        method: "POST",
        headers: {
          ...grant.headers,
          "content-type": "audio/wav",
        },
        body: Buffer.from("RIFF....WAVEfmt "),
      });
      expect(upload.status).toBe(400);
      const body = (await upload.json()) as { error: { code: string }; message: string };
      expect(body.error.code).toBe("PARAM_UNSUPPORTED");
      expect(body.message.toLowerCase()).toContain("audio bridge");
      expect(body.message).toContain(CLAW4_ASR_STUB_ENV);
    });
  });

  it("formal mode accepts injected audio bridge (Agent A createAudioBridge shape)", async () => {
    delete process.env[CLAW4_ASR_STUB_ENV];
    setClaw4AudioBridge({
      async transcribeWav(wavBytes) {
        return `bridge-heard:${wavBytes.length}`;
      },
    });
    const service = new DeviceDhService({ config: stubConfig(), approvalToken: "test-approval" });
    const grant = await exchangeGrant(service);
    await withGateway(service, async (base) => {
      const wav = Buffer.from("RIFF....WAVEfmt ");
      const upload = await fetch(`${base}/api/v1/upload`, {
        method: "POST",
        headers: {
          ...grant.headers,
          "content-type": "audio/wav",
        },
        body: wav,
      });
      expect(upload.status).toBe(200);
      const body = (await upload.json()) as {
        code: number;
        data: { text: string };
      };
      expect(body.code).toBe(0);
      expect(body.data.text).toBe(`bridge-heard:${wav.length}`);
    });
  });

  it("pins device-sdk audio bridge SHA 87a4a1a", () => {
    expect(DEVICE_SDK_AUDIO_BRIDGE_SHA).toBe("87a4a1a1448286ff0db4ad45c2f9a2a29c2b5e37");
  });

  it("bindClaw4AudioBridgeFromCreateAudioBridge calls Agent A factory for real", async () => {
    delete process.env[CLAW4_ASR_STUB_ENV];
    let called = 0;
    const asr: Claw4AsrProvider = {
      async transcribe() {
        return "unused";
      },
    };
    const tts: Claw4TtsProvider = {
      async *synthesize() {
        yield Buffer.alloc(0);
      },
    };
    const createAudioBridge: AgentACreateAudioBridge = (opts) => {
      called += 1;
      expect(opts.asr).toBe(asr);
      expect(opts.tts).toBe(tts);
      return {
        createAbortHandle() {
          const ac = new AbortController();
          return {
            abort: (reason?: unknown) => ac.abort(reason),
            get signal() {
              return ac.signal;
            },
            get aborted() {
              return ac.signal.aborted;
            },
          };
        },
        async transcribeWav(wavBytes, options) {
          expect(options?.signal).toBeDefined();
          return `from-createAudioBridge:${wavBytes.length}`;
        },
      };
    };
    const wrapped = bindClaw4AudioBridgeFromCreateAudioBridge(createAudioBridge, { asr, tts });
    expect(called).toBe(1);
    expect(getClaw4AudioBridge()).toBe(wrapped);

    const service = new DeviceDhService({ config: stubConfig(), approvalToken: "test-approval" });
    const grant = await exchangeGrant(service);
    await withGateway(service, async (base) => {
      const wav = Buffer.from("RIFF....WAVEfmt ");
      const upload = await fetch(`${base}/api/v1/upload`, {
        method: "POST",
        headers: {
          ...grant.headers,
          "content-type": "audio/wav",
        },
        body: wav,
      });
      expect(upload.status).toBe(200);
      const body = (await upload.json()) as { code: number; data: { text: string } };
      expect(body.code).toBe(0);
      expect(body.data.text).toBe(`from-createAudioBridge:${wav.length}`);
    });
  });

  it("rejects OpusFrameTtsProvider for product TTS bind", () => {
    class OpusFrameTtsProvider {
      async *synthesize() {
        yield Buffer.alloc(0);
      }
    }
    expect(() => assertSpeakingTtsProvider(new OpusFrameTtsProvider())).toThrow(
      /OpusFrameTtsProvider/,
    );
  });

  it("abort uses createAbortHandle().signal", async () => {
    let seenSignal: AbortSignal | undefined;
    const createAudioBridge: AgentACreateAudioBridge = () => ({
      createAbortHandle() {
        const ac = new AbortController();
        return {
          abort: (reason?: unknown) => ac.abort(reason),
          get signal() {
            return ac.signal;
          },
          get aborted() {
            return ac.signal.aborted;
          },
        };
      },
      async transcribeWav(_wav, options) {
        seenSignal = options?.signal;
        return "heard";
      },
    });
    bindClaw4AudioBridgeFromCreateAudioBridge(createAudioBridge, {
      asr: {
        async transcribe() {
          return "";
        },
      },
      tts: {
        async *synthesize() {
          yield Buffer.alloc(0);
        },
      },
    });
    const resolved = await resolveClaw4Transcript(Buffer.from("RIFF"), { env: {} });
    expect(resolved.asr).toBe("bridge");
    expect(resolved.text).toBe("heard");
    expect(seenSignal).toBeDefined();
    expect(seenSignal!.aborted).toBe(false);
  });

  it("formal mode rejects empty/silent bridge transcript", async () => {
    await expect(
      resolveClaw4Transcript(Buffer.from("RIFF"), {
        bridge: {
          async transcribeWav() {
            return "   ";
          },
        },
        env: {},
      }),
    ).rejects.toMatchObject({ code: "PARAM_UNSUPPORTED" });
  });

  it("stub switch still allows labeled stub ASR", async () => {
    const resolved = await resolveClaw4Transcript(Buffer.from("RIFF"), {
      env: { [CLAW4_ASR_STUB_ENV]: "1" },
    });
    expect(resolved.asr).toBe("stub");
    expect(resolved.text).toContain("claw4-asr-stub");
  });

  it("upload idempotency key is client-stable (not random turnId)", () => {
    const wav = Buffer.from("RIFF same-bytes");
    const first = resolveClaw4UploadIdempotencyKey({
      clientIdempotencyKey: "client-stable-1",
      authorizationRef: "aref_1",
      conversationId: "conv_1",
      wavBytes: wav,
    });
    const second = resolveClaw4UploadIdempotencyKey({
      clientIdempotencyKey: "client-stable-1",
      authorizationRef: "aref_1",
      conversationId: "conv_1",
      wavBytes: wav,
    });
    expect(first.idempotencyKey).toBe("client-stable-1");
    expect(first.turnId).toBe(second.turnId);
    expect(first.turnId.startsWith("claw4_")).toBe(true);

    const contentA = resolveClaw4UploadIdempotencyKey({
      authorizationRef: "aref_1",
      conversationId: "conv_1",
      wavBytes: wav,
    });
    const contentB = resolveClaw4UploadIdempotencyKey({
      authorizationRef: "aref_1",
      conversationId: "conv_1",
      wavBytes: wav,
    });
    expect(contentA.idempotencyKey).toBe(contentB.idempotencyKey);
    expect(contentA.turnId).toBe(contentB.turnId);
    expect(contentA.idempotencyKey).toContain("claw4-upload:");
  });

  it("retry with same Idempotency-Key + conversationId does not mint a second user turn", async () => {
    const service = new DeviceDhService({ config: stubConfig(), approvalToken: "test-approval" });
    const grant = await exchangeGrant(service);
    const wav = Buffer.from("RIFF....WAVEfmt retry");
    await withGateway(service, async (base) => {
      const headers = {
        ...grant.headers,
        "content-type": "audio/wav",
        "x-transcript-text": "idempotent-hello",
        "idempotency-key": "claw4-client-key-42",
      };
      const first = await fetch(`${base}/api/v1/upload`, { method: "POST", headers, body: wav });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as { data: { conversationId: string } };
      const pinned = await fetch(
        `${base}/api/v1/upload?conversationId=${encodeURIComponent(firstBody.data.conversationId)}`,
        { method: "POST", headers, body: wav },
      );
      expect(pinned.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const messages = await fetch(
        `${base}/api/v1/conversation/${firstBody.data.conversationId}/messages`,
        { headers: grant.headers },
      );
      const listed = (await messages.json()) as {
        code: number;
        data: { messages: Array<{ role: string; text: string }> };
      };
      expect(listed.code).toBe(0);
      const userTurns = listed.data.messages.filter(
        (m) => m.role === "user" && m.text === "idempotent-hello",
      );
      expect(userTurns).toHaveLength(1);
    });
  });

  it("redacts transcript query for access-log safety", () => {
    const redacted = redactClaw4UploadUrlForLog(
      "/api/v1/upload?conversationId=conv_1&transcript=secret-speech",
    );
    expect(redacted).toContain("transcript=%5Bredacted%5D");
    expect(redacted).not.toContain("secret-speech");
  });

  it("grant mint stays fail-closed when unbound (no inject / INPROCESS)", async () => {
    resetClaw4FirmwareBindForTests();
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
      const exchange = await fetch(
        `http://127.0.0.1:${address.port}/api/integrations/v1/grants/exchange`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      expect(exchange.status).toBe(599);
      expect(await exchange.text()).toBe("not-owned");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("Claw4 rejects consent Basic (restricted service callers only)", async () => {
    const service = new DeviceDhService({ config: stubConfig(), approvalToken: "test-approval" });
    const grant = await exchangeGrant(service);
    await withGateway(service, async (base) => {
      const upload = await fetch(`${base}/api/v1/upload`, {
        method: "POST",
        headers: {
          authorization: basicHeader("consent-sim", consentSecret),
          "x-openbot-grant-credential": grant.credential,
          "x-device-id": deviceId,
          "content-type": "audio/wav",
          "x-transcript-text": "nope",
        },
        body: Buffer.from("RIFF"),
      });
      expect(upload.status).toBe(401);
      const body = (await upload.json()) as { error: { code: string } };
      expect(body.error.code).toBe("AUTH_INVALID");
    });
  });
});
