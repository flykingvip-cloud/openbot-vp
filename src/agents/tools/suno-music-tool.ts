import { Type } from "@sinclair/typebox";
import { SILENT_REPLY_TOKEN } from "../../auto-reply/tokens.js";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { resolveApiKeyForProvider } from "../model-auth.js";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";
import {
  callSunoMusicGeneration,
  resolveSunoMusicEndpointConfig,
  saveGeneratedAudioBuffer,
  toWorkspaceRelativeAudioPath,
} from "./suno-music-tool.helpers.js";

export function createSunoMusicTool(options?: {
  config?: OpenBotConfig;
  agentDir?: string;
  workspaceDir?: string;
  fetchImpl?: typeof fetch;
}): AnyAgentTool | null {
  const cfg = options?.config ?? loadConfig();
  const endpoint = resolveSunoMusicEndpointConfig(cfg);
  if (!endpoint?.provider?.trim() || !endpoint.baseUrl?.trim()) {
    return null;
  }

  return {
    label: "Music Generation",
    name: "music_gen",
    description: `Generate a music / soundtrack clip (Suno-compatible music generation API). After success: (1) declare the workspace-relative path with <<DELIVERABLE title="标题" type="audio" file=".openbot/generated-audio/….mp3">>…<</DELIVERABLE>> using the exact relativePath from the tool details; (2) reply with ${SILENT_REPLY_TOKEN} to avoid duplicate messages.`,
    parameters: Type.Object({
      prompt: Type.String({
        description: "Text prompt describing the music, mood, genre, or lyrics intent.",
      }),
      durationSeconds: Type.Optional(
        Type.Number({
          description: "Optional target duration in seconds (provider-dependent).",
        }),
      ),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const prompt = readStringParam(params, "prompt", { required: true });
      const durationRaw = params.durationSeconds;
      const durationSeconds =
        typeof durationRaw === "number" && Number.isFinite(durationRaw) ? durationRaw : undefined;

      const auth = await resolveApiKeyForProvider({
        provider: endpoint.provider,
        cfg,
        agentDir: options?.agentDir,
      });
      const apiKey = auth.apiKey?.trim();
      if (!apiKey) {
        throw new Error(`No API key configured for provider "${endpoint.provider}".`);
      }

      const audioBuffer = await callSunoMusicGeneration({
        apiKey,
        baseUrl: endpoint.baseUrl,
        model: endpoint.model,
        prompt,
        durationSeconds,
        fetchImpl: options?.fetchImpl,
      });

      const savedPath = await saveGeneratedAudioBuffer({
        buffer: audioBuffer,
        workspaceDir: options?.workspaceDir,
        prefix: "suno-gen",
        extension: "mp3",
      });
      const relativePath = toWorkspaceRelativeAudioPath(savedPath, options?.workspaceDir);
      const titleHint =
        relativePath
          .split("/")
          .pop()
          ?.replace(/\.[^.]+$/u, "") || "generated-audio";

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `MEDIA:${savedPath}`,
              `relativePath: ${relativePath}`,
              `Declare: <<DELIVERABLE title="${titleHint}" type="audio" file="${relativePath}">><</DELIVERABLE>>`,
              `Then reply with ${SILENT_REPLY_TOKEN}. Do not claim the file is at the workspace root.`,
            ].join("\n"),
          },
        ],
        details: {
          model: `${endpoint.provider}/${endpoint.model}`,
          provider: endpoint.provider,
          relativePath,
          workspaceFilename: relativePath,
          audioPath: savedPath,
        },
      };
    },
  };
}
