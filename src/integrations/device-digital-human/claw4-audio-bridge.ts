/**
 * Injectable audio bridge hook for Claw4 firmware HTTP compat (Agent B P0).
 *
 * Aligns with Agent A's device-sdk `createAudioBridge` (adapters/voice /
 * metalio / services). Source of truth while landing:
 *   flykingvip-cloud/openbot-device-sdk PR #27 @ 9069fd50
 * Pin as an optional peer / documented dependency after #27 merges; until then
 * this local interface is the B-side seam (do not block the PR on publish).
 *
 * Contract (B calls):
 *   bridge.transcribeWav(wavBytes, { signal? }) → Promise<string>
 * Abort via the handle returned by createAudioBridge(...).createAbortHandle()
 * (`handle.signal`). Product playback must inject a speaking TtsProvider —
 * do NOT use OpusFrameTtsProvider for product 播报 (A's docs; B only needs ASR).
 *
 * OpenBot does **not** vendor AsrProvider/TtsProvider or hardcode FunASR/tenclass.
 * Formal mode fails closed if ASR would otherwise invent a stub / silent text.
 */

export type Claw4TranscribeWavOptions = {
  signal?: AbortSignal;
};

/**
 * Minimal B-side surface matching Agent A AudioBridge.transcribeWav.
 * Intentionally omits TTS/Opus (B consumes text → turn; playback stays on A/device).
 */
export interface Claw4AudioBridge {
  transcribeWav(wavBytes: Buffer, options?: Claw4TranscribeWavOptions): Promise<string>;
}

let injectedBridge: Claw4AudioBridge | undefined;

/** Ops / tests: inject Agent A's createAudioBridge result (or a test double). */
export function setClaw4AudioBridge(bridge: Claw4AudioBridge | undefined): void {
  injectedBridge = bridge;
}

export function getClaw4AudioBridge(): Claw4AudioBridge | undefined {
  return injectedBridge;
}

/** Test helper: clear inject. */
export function resetClaw4AudioBridgeForTests(): void {
  injectedBridge = undefined;
}

/**
 * Resolve the bridge for an upload:
 *   explicit opts.bridge → setClaw4AudioBridge inject.
 */
export function resolveClaw4AudioBridge(
  opts: { bridge?: Claw4AudioBridge } = {},
): Claw4AudioBridge | undefined {
  return opts.bridge ?? injectedBridge;
}
