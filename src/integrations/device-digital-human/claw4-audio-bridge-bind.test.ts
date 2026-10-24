import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE_ENV,
  DEVICE_SDK_ASR_MODULE_ENV,
  DEVICE_SDK_TTS_MODULE_ENV,
  claw4AudioBridgeEnvBindWarning,
  ensureClaw4DeviceSdkAudioBridgeBound,
  isClaw4DeviceSdkAudioBridgeBindAllowed,
  resetClaw4AudioBridgeBindForTests,
} from "./claw4-audio-bridge-bind.js";
import {
  DEVICE_SDK_AUDIO_BRIDGE_MODULE_ENV,
  DEVICE_SDK_ROOT_ENV,
  getClaw4AudioBridge,
  resetClaw4AudioBridgeForTests,
} from "./claw4-audio-bridge.js";
import { resolveClaw4Transcript } from "./claw4-firmware-compat.js";

function writeModule(dir: string, name: string, source: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, source, "utf8");
  return pathToFileURL(filePath).href;
}

function makeFixtureDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "claw4-p1-bind-"));
}

afterEach(() => {
  resetClaw4AudioBridgeForTests();
  resetClaw4AudioBridgeBindForTests();
});

describe("claw4 P1 device-sdk audio bridge bind switch", () => {
  it("defaults off when bind env unset and no INPROCESS implicit", () => {
    expect(
      isClaw4DeviceSdkAudioBridgeBindAllowed({
        OPENBOT_CLAW4_FIRMWARE_INPROCESS: undefined,
        [DEVICE_SDK_ROOT_ENV]: "/tmp/sdk",
      }),
    ).toBe(false);
    expect(isClaw4DeviceSdkAudioBridgeBindAllowed({})).toBe(false);
  });

  it("explicit 1|true allows bind", () => {
    expect(
      isClaw4DeviceSdkAudioBridgeBindAllowed({
        [CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE_ENV]: "1",
      }),
    ).toBe(true);
    expect(
      isClaw4DeviceSdkAudioBridgeBindAllowed({
        [CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE_ENV]: "true",
      }),
    ).toBe(true);
  });

  it("INPROCESS + SDK locator implicitly allows when bind env unset", () => {
    expect(
      isClaw4DeviceSdkAudioBridgeBindAllowed({
        OPENBOT_CLAW4_FIRMWARE_INPROCESS: "1",
        [DEVICE_SDK_ROOT_ENV]: "/tmp/openbot-device-sdk",
      }),
    ).toBe(true);
    expect(
      isClaw4DeviceSdkAudioBridgeBindAllowed({
        OPENBOT_CLAW4_FIRMWARE_INPROCESS: "1",
        [DEVICE_SDK_AUDIO_BRIDGE_MODULE_ENV]: "file:///tmp/audio-bridge.js",
      }),
    ).toBe(true);
  });

  it("explicit 0|false suppresses INPROCESS implicit allow", () => {
    expect(
      isClaw4DeviceSdkAudioBridgeBindAllowed({
        [CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE_ENV]: "0",
        OPENBOT_CLAW4_FIRMWARE_INPROCESS: "1",
        [DEVICE_SDK_ROOT_ENV]: "/tmp/openbot-device-sdk",
      }),
    ).toBe(false);
    expect(
      isClaw4DeviceSdkAudioBridgeBindAllowed({
        [CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE_ENV]: "false",
        OPENBOT_CLAW4_FIRMWARE_INPROCESS: "1",
        [DEVICE_SDK_AUDIO_BRIDGE_MODULE_ENV]: "file:///tmp/audio-bridge.js",
      }),
    ).toBe(false);
  });
});

describe("claw4 P1 ensureClaw4DeviceSdkAudioBridgeBound", () => {
  it("switch off does not bind", async () => {
    const ok = await ensureClaw4DeviceSdkAudioBridgeBound({});
    expect(ok).toBe(false);
    expect(getClaw4AudioBridge()).toBeUndefined();
  });

  it("explicit on without provider modules leaves unbound (fail-closed)", async () => {
    const ok = await ensureClaw4DeviceSdkAudioBridgeBound({
      [CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE_ENV]: "1",
      [DEVICE_SDK_AUDIO_BRIDGE_MODULE_ENV]: "file:///tmp/missing-bridge.js",
    });
    expect(ok).toBe(false);
    expect(getClaw4AudioBridge()).toBeUndefined();
    expect(claw4AudioBridgeEnvBindWarning()).toMatch(/ASR_MODULE|TTS_MODULE/);
  });

  it("explicit on + mock modules binds successfully", async () => {
    const dir = makeFixtureDir();
    const bridgeUrl = writeModule(
      dir,
      "audio-bridge.mjs",
      `
export function createAudioBridge({ asr, tts }) {
  return {
    createAbortHandle() {
      const ac = new AbortController();
      return {
        abort: (reason) => ac.abort(reason),
        get signal() { return ac.signal; },
        get aborted() { return ac.signal.aborted; },
      };
    },
    async transcribeWav(wavBytes, options) {
      const text = await asr.transcribe(wavBytes, { sampleRate: 16000, channels: 1, format: "wav" });
      void tts;
      void options;
      return text;
    },
  };
}
`,
    );
    const asrUrl = writeModule(
      dir,
      "asr.mjs",
      `
export function createMockAsrProvider() {
  return {
    async transcribe(audio) {
      return "mock-asr:" + audio.length;
    },
  };
}
`,
    );
    const ttsUrl = writeModule(
      dir,
      "tts.mjs",
      `
export function createProportionalSilenceTtsProvider() {
  return {
    async *synthesize(text, options) {
      void text;
      void options;
      yield Buffer.alloc(0);
    },
  };
}
`,
    );

    const env = {
      [CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE_ENV]: "1",
      [DEVICE_SDK_AUDIO_BRIDGE_MODULE_ENV]: bridgeUrl,
      [DEVICE_SDK_ASR_MODULE_ENV]: asrUrl,
      [DEVICE_SDK_TTS_MODULE_ENV]: ttsUrl,
    };
    const ok = await ensureClaw4DeviceSdkAudioBridgeBound(env);
    expect(ok).toBe(true);
    const bridge = getClaw4AudioBridge();
    expect(bridge).toBeDefined();
    const text = await bridge!.transcribeWav(Buffer.from("RIFF...."));
    expect(text).toBe("mock-asr:8");

    // Transcript path also sees the bound bridge.
    const resolved = await resolveClaw4Transcript(Buffer.from("RIFF...."), { env: {} });
    expect(resolved.asr).toBe("bridge");
    expect(resolved.text).toBe("mock-asr:8");
  });

  it("rejects OpusFrameTtsProvider and leaves unbound", async () => {
    const dir = makeFixtureDir();
    const bridgeUrl = writeModule(
      dir,
      "audio-bridge.mjs",
      `
export function createAudioBridge() {
  return {
    createAbortHandle() {
      const ac = new AbortController();
      return { abort: (r) => ac.abort(r), get signal() { return ac.signal; }, get aborted() { return ac.signal.aborted; } };
    },
    async transcribeWav() { return "should-not-bind"; },
  };
}
`,
    );
    const asrUrl = writeModule(
      dir,
      "asr.mjs",
      `
export function createMockAsrProvider() {
  return { async transcribe() { return "x"; } };
}
`,
    );
    const ttsUrl = writeModule(
      dir,
      "opus-tts.mjs",
      `
export class OpusFrameTtsProvider {
  async *synthesize() { yield Buffer.alloc(0); }
}
export function createTtsProvider() {
  return new OpusFrameTtsProvider();
}
`,
    );

    const ok = await ensureClaw4DeviceSdkAudioBridgeBound({
      [CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE_ENV]: "1",
      [DEVICE_SDK_AUDIO_BRIDGE_MODULE_ENV]: bridgeUrl,
      [DEVICE_SDK_ASR_MODULE_ENV]: asrUrl,
      [DEVICE_SDK_TTS_MODULE_ENV]: ttsUrl,
    });
    expect(ok).toBe(false);
    expect(getClaw4AudioBridge()).toBeUndefined();
    expect(claw4AudioBridgeEnvBindWarning()).toMatch(/OpusFrameTtsProvider/);
  });

  it("explicit 0 suppresses INPROCESS implicit even with modules present", async () => {
    const dir = makeFixtureDir();
    const bridgeUrl = writeModule(
      dir,
      "audio-bridge.mjs",
      `
export function createAudioBridge({ asr }) {
  return {
    createAbortHandle() {
      const ac = new AbortController();
      return { abort: (r) => ac.abort(r), get signal() { return ac.signal; }, get aborted() { return ac.signal.aborted; } };
    },
    async transcribeWav(wav) { return asr.transcribe(wav, { sampleRate: 16000, channels: 1 }); },
  };
}
`,
    );
    const asrUrl = writeModule(
      dir,
      "asr.mjs",
      `export default function createAsrProvider() { return { async transcribe() { return "nope"; } }; }`,
    );
    const ttsUrl = writeModule(
      dir,
      "tts.mjs",
      `export default function createTtsProvider() { return { async *synthesize() { yield Buffer.alloc(0); } }; }`,
    );

    const ok = await ensureClaw4DeviceSdkAudioBridgeBound({
      [CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE_ENV]: "0",
      OPENBOT_CLAW4_FIRMWARE_INPROCESS: "1",
      [DEVICE_SDK_AUDIO_BRIDGE_MODULE_ENV]: bridgeUrl,
      [DEVICE_SDK_ASR_MODULE_ENV]: asrUrl,
      [DEVICE_SDK_TTS_MODULE_ENV]: ttsUrl,
    });
    expect(ok).toBe(false);
    expect(getClaw4AudioBridge()).toBeUndefined();
  });
});
