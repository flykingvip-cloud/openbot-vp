// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  extractGenToolRelativePath,
  isArtifactBackedTargetModality,
  pickModalityCompletionEvidence,
  resolveTrustedRunModalityCompletionEvidence,
} from "./modality-artifact-evidence.js";

describe("modality-artifact-evidence", () => {
  it("recognizes artifact-backed modalities only", () => {
    expect(isArtifactBackedTargetModality("image_generation")).toBe(true);
    expect(isArtifactBackedTargetModality("audio_music_generation")).toBe(true);
    expect(isArtifactBackedTargetModality("chat_model")).toBe(false);
    expect(isArtifactBackedTargetModality("audio_tts")).toBe(false);
  });

  it("extracts relativePath from image_gen / music_gen details", () => {
    expect(
      extractGenToolRelativePath("image_gen", {
        details: { relativePath: ".openbot/generated-images/a.png" },
      }),
    ).toBe(".openbot/generated-images/a.png");
    expect(
      extractGenToolRelativePath("music_gen", {
        content: [{ type: "text", text: "relativePath: .openbot/generated-audio/b.mp3\n" }],
      }),
    ).toBe(".openbot/generated-audio/b.mp3");
    expect(extractGenToolRelativePath("write", { details: { relativePath: "x" } })).toBeUndefined();
  });

  it("picks matching tool artifact for target modality", () => {
    const evidence = pickModalityCompletionEvidence({
      targetModality: "image_generation",
      artifacts: [
        { toolName: "music_gen", relativePath: ".openbot/generated-audio/a.mp3" },
        { toolName: "image_gen", relativePath: ".openbot/generated-images/a.png" },
      ],
    });
    expect(evidence).toEqual({
      kind: "execution_artifact",
      digestOrRef: ".openbot/generated-images/a.png",
      detail: "tool=image_gen",
    });
  });
});

describe("resolveTrustedRunModalityCompletionEvidence", () => {
  it("failure response yields no evidence", () => {
    expect(
      resolveTrustedRunModalityCompletionEvidence({
        targetModality: "image_generation",
        success: false,
        runId: "run-1",
        artifacts: [{ toolName: "image_gen", relativePath: ".openbot/generated-images/a.png" }],
      }),
    ).toBeUndefined();
  });

  it("success without artifact leaves image/music incomplete", () => {
    expect(
      resolveTrustedRunModalityCompletionEvidence({
        targetModality: "image_generation",
        success: true,
        runId: "run-1",
        artifacts: [],
      }),
    ).toBeUndefined();
    expect(
      resolveTrustedRunModalityCompletionEvidence({
        targetModality: "audio_music_generation",
        success: true,
        runId: "run-1",
      }),
    ).toBeUndefined();
  });

  it("success with real artifact returns execution_artifact evidence", () => {
    expect(
      resolveTrustedRunModalityCompletionEvidence({
        targetModality: "image_generation",
        success: true,
        runId: "run-1",
        artifacts: [{ toolName: "image_gen", relativePath: ".openbot/generated-images/a.png" }],
      }),
    ).toEqual({
      kind: "execution_artifact",
      digestOrRef: ".openbot/generated-images/a.png",
      detail: "tool=image_gen",
    });
    expect(
      resolveTrustedRunModalityCompletionEvidence({
        targetModality: "audio_music_generation",
        success: true,
        runId: "run-2",
        artifacts: [{ toolName: "music_gen", relativePath: ".openbot/generated-audio/b.mp3" }],
      }),
    ).toEqual({
      kind: "execution_artifact",
      digestOrRef: ".openbot/generated-audio/b.mp3",
      detail: "tool=music_gen",
    });
  });

  it("chat_model success still uses run_completed", () => {
    expect(
      resolveTrustedRunModalityCompletionEvidence({
        targetModality: "chat_model",
        success: true,
        runId: "run-chat",
      }),
    ).toEqual({
      kind: "run_completed",
      digestOrRef: "run:run-chat",
      detail: "trusted_runner_turn_success",
    });
  });
});
