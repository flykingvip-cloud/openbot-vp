/**
 * Injectable audio bridge for Claw4 firmware HTTP compat (Agent B P0).
 *
 * Pins and calls Agent A `createAudioBridge` from openbot-device-sdk:
 *   DEVICE_SDK_AUDIO_BRIDGE_SHA = 47ca71a7ec2c59ca86e06036998ce3be11e2880e
 *   (flykingvip-cloud/openbot-device-sdk PR #27 merged to main)
 *
 * OPENBOT_CONTRACT_SHA remains d7f0e1d834dc9ccece6723f6d71dea8fa0cfcb1f (unchanged).
 *
 * Wiring:
 *   1. Prefer `bindClaw4AudioBridgeFromCreateAudioBridge(createAudioBridge, { asr, tts })`
 *      after importing `createAudioBridge` from the pinned SDK tip.
 *   2. Or `importAgentACreateAudioBridge()` via OPENBOT_DEVICE_SDK_AUDIO_BRIDGE_MODULE /
 *      OPENBOT_DEVICE_SDK_ROOT (checkout at the pin SHA).
 *   3. Tests may `setClaw4AudioBridge` with a double.
 *
 * Product TTS: inject a speaking TtsProvider (or test ProportionalSilenceTtsProvider).
 * Do NOT use OpusFrameTtsProvider for product 播报 — it ignores text.
 * Abort in-flight ASR via `bridge.createAbortHandle().signal`.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import { DeviceDhError } from "./errors.js";

/** openbot-device-sdk main after PR #27 (createAudioBridge) merged. */
export const DEVICE_SDK_AUDIO_BRIDGE_SHA = "47ca71a7ec2c59ca86e06036998ce3be11e2880e";

/** Env: absolute module URL or file path to audio-bridge entry exporting createAudioBridge. */
export const DEVICE_SDK_AUDIO_BRIDGE_MODULE_ENV = "OPENBOT_DEVICE_SDK_AUDIO_BRIDGE_MODULE";

/** Env: checkout root of openbot-device-sdk at DEVICE_SDK_AUDIO_BRIDGE_SHA. */
export const DEVICE_SDK_ROOT_ENV = "OPENBOT_DEVICE_SDK_ROOT";

export type Claw4TranscribeWavOptions = {
  signal?: AbortSignal;
};

/** Minimal ASR provider shape (Agent A AsrProvider.transcribe). */
export type Claw4AsrProvider = {
  transcribe(
    audio: Buffer,
    options: { sampleRate: number; channels: number; format?: string },
  ): Promise<string>;
};

/** Minimal TTS provider shape (Agent A TtsProvider.synthesize). */
export type Claw4TtsProvider = {
  synthesize(text: string, options: { sampleRate: number }): AsyncIterable<Buffer>;
};

export type Claw4AudioBridgeAbortHandle = {
  abort(reason?: unknown): void;
  readonly signal: AbortSignal;
  readonly aborted: boolean;
};

/**
 * Agent A AudioBridge surface we depend on (createAudioBridge return value).
 * B only requires transcribeWav + createAbortHandle for upload ASR.
 */
export type AgentAAudioBridge = {
  createAbortHandle(): Claw4AudioBridgeAbortHandle;
  transcribeWav(wavBytes: Buffer, options?: Claw4TranscribeWavOptions): Promise<string>;
};

export type AgentACreateAudioBridge = (options: {
  asr: Claw4AsrProvider;
  tts: Claw4TtsProvider;
  ttsSampleRate?: number;
}) => AgentAAudioBridge;

/**
 * B-side upload ASR seam (wraps Agent A bridge or a test double).
 */
export interface Claw4AudioBridge {
  transcribeWav(wavBytes: Buffer, options?: Claw4TranscribeWavOptions): Promise<string>;
  /** Present when wrapped from Agent A createAudioBridge. */
  createAbortHandle?: () => Claw4AudioBridgeAbortHandle;
}

let injectedBridge: Claw4AudioBridge | undefined;

export function setClaw4AudioBridge(bridge: Claw4AudioBridge | undefined): void {
  injectedBridge = bridge;
}

export function getClaw4AudioBridge(): Claw4AudioBridge | undefined {
  return injectedBridge;
}

export function resetClaw4AudioBridgeForTests(): void {
  injectedBridge = undefined;
}

export function resolveClaw4AudioBridge(
  opts: { bridge?: Claw4AudioBridge } = {},
): Claw4AudioBridge | undefined {
  return opts.bridge ?? injectedBridge;
}

/**
 * Reject OpusFrameTtsProvider for product/formal bind — it ignores `text`.
 * Allow ProportionalSilenceTtsProvider (A's test reference) and real speaking TTS.
 */
export function assertSpeakingTtsProvider(tts: Claw4TtsProvider): void {
  const name = (tts as { constructor?: { name?: string } }).constructor?.name ?? "";
  if (name === "OpusFrameTtsProvider") {
    throw new DeviceDhError(
      "PARAM_UNSUPPORTED",
      "OpusFrameTtsProvider is format/lab only and ignores text — inject a speaking TtsProvider (or ProportionalSilenceTtsProvider in tests) for createAudioBridge",
    );
  }
}

/** Wrap Agent A AudioBridge as the Claw4 upload ASR seam (forwards abort signal). */
export function wrapAgentAAudioBridge(bridge: AgentAAudioBridge): Claw4AudioBridge {
  return {
    createAbortHandle: () => bridge.createAbortHandle(),
    async transcribeWav(wavBytes, options) {
      return bridge.transcribeWav(wavBytes, options);
    },
  };
}

/**
 * Call Agent A `createAudioBridge` for real and bind it for Claw4 formal uploads.
 * Pass a speaking `tts` (not OpusFrameTtsProvider). Abort via returned bridge's
 * `createAbortHandle().signal`.
 */
export function bindClaw4AudioBridgeFromCreateAudioBridge(
  createAudioBridge: AgentACreateAudioBridge,
  options: {
    asr: Claw4AsrProvider;
    tts: Claw4TtsProvider;
    ttsSampleRate?: number;
  },
): Claw4AudioBridge {
  assertSpeakingTtsProvider(options.tts);
  const agentBridge = createAudioBridge({
    asr: options.asr,
    tts: options.tts,
    ttsSampleRate: options.ttsSampleRate,
  });
  const wrapped = wrapAgentAAudioBridge(agentBridge);
  setClaw4AudioBridge(wrapped);
  return wrapped;
}

function defaultBridgeModuleFromRoot(root: string): string {
  return pathToFileURL(path.join(root, "adapters/voice/src/audio-bridge.ts")).href;
}

/**
 * Dynamically import Agent A `createAudioBridge` from the pinned SDK checkout
 * or an explicit module URL. Does not invent a stub bridge.
 */
export async function importAgentACreateAudioBridge(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentACreateAudioBridge> {
  const explicit = env[DEVICE_SDK_AUDIO_BRIDGE_MODULE_ENV]?.trim();
  const root = env[DEVICE_SDK_ROOT_ENV]?.trim();
  const moduleUrl = explicit
    ? explicit.startsWith("file:") || explicit.startsWith("http:")
      ? explicit
      : pathToFileURL(path.resolve(explicit)).href
    : root
      ? defaultBridgeModuleFromRoot(path.resolve(root))
      : undefined;
  if (!moduleUrl) {
    throw new DeviceDhError(
      "PARAM_UNSUPPORTED",
      `Set ${DEVICE_SDK_AUDIO_BRIDGE_MODULE_ENV} or ${DEVICE_SDK_ROOT_ENV} to import createAudioBridge from openbot-device-sdk@${DEVICE_SDK_AUDIO_BRIDGE_SHA}`,
    );
  }
  const mod = (await import(moduleUrl)) as {
    createAudioBridge?: AgentACreateAudioBridge;
  };
  if (typeof mod.createAudioBridge !== "function") {
    throw new DeviceDhError(
      "PARAM_UNSUPPORTED",
      `Module ${moduleUrl} does not export createAudioBridge (expected openbot-device-sdk@${DEVICE_SDK_AUDIO_BRIDGE_SHA})`,
    );
  }
  return mod.createAudioBridge;
}

/**
 * Import createAudioBridge from the pinned SDK and bind it with the given providers.
 */
export async function bindClaw4AudioBridgeFromDeviceSdk(options: {
  asr: Claw4AsrProvider;
  tts: Claw4TtsProvider;
  ttsSampleRate?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<Claw4AudioBridge> {
  const createAudioBridge = await importAgentACreateAudioBridge(options.env ?? process.env);
  return bindClaw4AudioBridgeFromCreateAudioBridge(createAudioBridge, {
    asr: options.asr,
    tts: options.tts,
    ttsSampleRate: options.ttsSampleRate,
  });
}
