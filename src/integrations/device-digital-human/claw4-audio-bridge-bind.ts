/**
 * Claw4 P1 startup / lazy bind of Agent A device-sdk audio bridge.
 *
 * Opt-in (default off — production cam_b / grayRelease untouched):
 *   OPENBOT_CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE=1|true  → allow bind
 *   OPENBOT_CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE=0|false → always deny
 *     (suppresses the INPROCESS implicit path below)
 *
 * Implicit allow (only when the explicit bind env is unset):
 *   OPENBOT_CLAW4_FIRMWARE_INPROCESS=1
 *   AND (OPENBOT_DEVICE_SDK_ROOT OR OPENBOT_DEVICE_SDK_AUDIO_BRIDGE_MODULE)
 *
 * When allowed, loads speaking ASR+TTS provider factories from:
 *   OPENBOT_DEVICE_SDK_ASR_MODULE
 *   OPENBOT_DEVICE_SDK_TTS_MODULE
 * then calls bindClaw4AudioBridgeFromDeviceSdk (createAudioBridge @ pin
 * DEVICE_SDK_AUDIO_BRIDGE_SHA). Missing provider modules → fail closed:
 * clear log, leave unbound (formal upload without transcript stays
 * PARAM_UNSUPPORTED). Never half-binds. Never invents FunASR/EdgeTTS paths.
 *
 * ROOT / AUDIO_BRIDGE_MODULE ≠ already bound — they only locate
 * createAudioBridge; providers still require the MODULE envs above.
 *
 * Product TTS: assertSpeakingTtsProvider rejects OpusFrameTtsProvider.
 *
 * Forward: after device-sdk P1-1 merges, may optionally use
 * createAudioBridgeFromVoiceEnv — this module must stay on createAudioBridge
 * @ DEVICE_SDK_AUDIO_BRIDGE_SHA (47ca71a7…) until that pin is deliberately bumped.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  bindClaw4AudioBridgeFromDeviceSdk,
  getClaw4AudioBridge,
  type Claw4AsrProvider,
  type Claw4TtsProvider,
} from "./claw4-audio-bridge.js";
import { isClaw4FirmwareInProcessEnabled } from "./claw4-firmware-bind.js";
import { DeviceDhError } from "./errors.js";

/** Explicit P1 bind switch (1|true allow; 0|false deny/suppress implicit). */
export const CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE_ENV = "OPENBOT_CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE";

/** Absolute module URL/path exporting an ASR provider factory (or instance). */
export const DEVICE_SDK_ASR_MODULE_ENV = "OPENBOT_DEVICE_SDK_ASR_MODULE";

/** Absolute module URL/path exporting a speaking TTS provider factory (or instance). */
export const DEVICE_SDK_TTS_MODULE_ENV = "OPENBOT_DEVICE_SDK_TTS_MODULE";

let bindAttempted = false;
let bindInFlight: Promise<boolean> | undefined;
let bindWarning: string | undefined;

export function claw4AudioBridgeEnvBindWarning(): string | undefined {
  return bindWarning;
}

/** Test helper: clear lazy-bind state (does not clear an injected bridge). */
export function resetClaw4AudioBridgeBindForTests(): void {
  bindAttempted = false;
  bindInFlight = undefined;
  bindWarning = undefined;
}

function envTruthyFlag(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function envFalsyFlag(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

function hasDeviceSdkBridgeLocator(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.OPENBOT_DEVICE_SDK_ROOT?.trim() || env.OPENBOT_DEVICE_SDK_AUDIO_BRIDGE_MODULE?.trim(),
  );
}

/**
 * Whether startup/lazy bind of the device-sdk audio bridge is allowed.
 * Explicit 0|false always wins over INPROCESS implicit allow. Default off.
 */
export function isClaw4DeviceSdkAudioBridgeBindAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE_ENV];
  if (envFalsyFlag(raw)) {
    return false;
  }
  if (envTruthyFlag(raw)) {
    return true;
  }
  // Implicit convenience: in-process firmware + SDK locator present.
  if (isClaw4FirmwareInProcessEnabled(env) && hasDeviceSdkBridgeLocator(env)) {
    return true;
  }
  return false;
}

function resolveModuleUrl(spec: string): string {
  const trimmed = spec.trim();
  if (
    trimmed.startsWith("file:") ||
    trimmed.startsWith("http:") ||
    trimmed.startsWith("https:") ||
    trimmed.startsWith("data:")
  ) {
    return trimmed;
  }
  return pathToFileURL(path.resolve(trimmed)).href;
}

function isAsrProvider(value: unknown): value is Claw4AsrProvider {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as Claw4AsrProvider).transcribe === "function",
  );
}

function isTtsProvider(value: unknown): value is Claw4TtsProvider {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as Claw4TtsProvider).synthesize === "function",
  );
}

type UnknownModule = Record<string, unknown>;

function pickNamedCreate(mod: UnknownModule, names: string[]): (() => unknown) | undefined {
  for (const name of names) {
    const value = mod[name];
    if (typeof value === "function") {
      return value as () => unknown;
    }
  }
  for (const [key, value] of Object.entries(mod)) {
    if (key === "default" || key === "module.exports") {
      continue;
    }
    if (key.startsWith("create") && typeof value === "function") {
      return value as () => unknown;
    }
  }
  return undefined;
}

function resolveProviderFromModule(
  mod: UnknownModule,
  kind: "asr" | "tts",
): Claw4AsrProvider | Claw4TtsProvider {
  const preferred =
    kind === "asr"
      ? ["createAsrProvider", "createMockAsrProvider", "createASR"]
      : ["createTtsProvider", "createProportionalSilenceTtsProvider", "createTTS"];

  const named = pickNamedCreate(mod, preferred);
  if (named) {
    const created = named();
    if (kind === "asr" && isAsrProvider(created)) {
      return created;
    }
    if (kind === "tts" && isTtsProvider(created)) {
      return created;
    }
    throw new DeviceDhError(
      "PARAM_UNSUPPORTED",
      `Device SDK ${kind.toUpperCase()} module create*() did not return a valid ${kind} provider`,
    );
  }

  const def = mod.default;
  if (typeof def === "function") {
    const created = (def as () => unknown)();
    if (kind === "asr" && isAsrProvider(created)) {
      return created;
    }
    if (kind === "tts" && isTtsProvider(created)) {
      return created;
    }
    // default export may itself be a provider-shaped class constructor
    if (kind === "asr" && isAsrProvider(def)) {
      return def;
    }
    if (kind === "tts" && isTtsProvider(def)) {
      return def;
    }
    throw new DeviceDhError(
      "PARAM_UNSUPPORTED",
      `Device SDK ${kind.toUpperCase()} module default export is not a provider factory/instance`,
    );
  }
  if (kind === "asr" && isAsrProvider(def)) {
    return def;
  }
  if (kind === "tts" && isTtsProvider(def)) {
    return def;
  }

  throw new DeviceDhError(
    "PARAM_UNSUPPORTED",
    `Device SDK ${kind.toUpperCase()} module must default-export a factory/instance or export create*()`,
  );
}

async function importProvider(
  moduleSpec: string,
  kind: "asr" | "tts",
): Promise<Claw4AsrProvider | Claw4TtsProvider> {
  const moduleUrl = resolveModuleUrl(moduleSpec);
  const mod = (await import(moduleUrl)) as UnknownModule;
  return resolveProviderFromModule(mod, kind);
}

async function attemptBind(env: NodeJS.ProcessEnv): Promise<boolean> {
  if (getClaw4AudioBridge()) {
    bindWarning = undefined;
    return true;
  }
  if (!isClaw4DeviceSdkAudioBridgeBindAllowed(env)) {
    return false;
  }

  const asrSpec = env[DEVICE_SDK_ASR_MODULE_ENV]?.trim();
  const ttsSpec = env[DEVICE_SDK_TTS_MODULE_ENV]?.trim();
  if (!asrSpec || !ttsSpec) {
    bindWarning =
      `Claw4 device-sdk audio bridge bind is allowed but ${DEVICE_SDK_ASR_MODULE_ENV} / ${DEVICE_SDK_TTS_MODULE_ENV} are missing — leaving unbound (formal upload without transcript stays PARAM_UNSUPPORTED). ` +
      `OPENBOT_DEVICE_SDK_ROOT / OPENBOT_DEVICE_SDK_AUDIO_BRIDGE_MODULE locate createAudioBridge only; they are not a bound bridge.`;
    console.warn(`[claw4-audio-bridge-bind] ${bindWarning}`);
    return false;
  }

  try {
    const asr = (await importProvider(asrSpec, "asr")) as Claw4AsrProvider;
    const tts = (await importProvider(ttsSpec, "tts")) as Claw4TtsProvider;
    await bindClaw4AudioBridgeFromDeviceSdk({ asr, tts, env });
    bindWarning = undefined;
    console.info(
      "[claw4-audio-bridge-bind] Bound Claw4 audio bridge from device-sdk createAudioBridge (speaking TTS asserted)",
    );
    return true;
  } catch (error) {
    const message =
      error instanceof DeviceDhError || error instanceof Error
        ? error.message
        : "Claw4 device-sdk audio bridge bind failed";
    bindWarning = message;
    console.warn(`[claw4-audio-bridge-bind] Bind failed (fail-closed, unbound): ${message}`);
    return false;
  }
}

/**
 * Lazy once-per-process bind of Agent A createAudioBridge into setClaw4AudioBridge.
 * Safe to call repeatedly. Returns true when a bridge is available after the call.
 */
export async function ensureClaw4DeviceSdkAudioBridgeBound(
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (getClaw4AudioBridge()) {
    return true;
  }
  if (bindInFlight) {
    return bindInFlight;
  }
  if (bindAttempted) {
    return Boolean(getClaw4AudioBridge());
  }
  bindAttempted = true;
  bindInFlight = attemptBind(env).finally(() => {
    bindInFlight = undefined;
  });
  return bindInFlight;
}
