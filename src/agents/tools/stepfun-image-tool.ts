import fs from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import { SILENT_REPLY_TOKEN } from "../../auto-reply/tokens.js";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { resolveUserPath } from "../../utils.js";
import { loadWebMedia } from "../../web/media.js";
import { resolveApiKeyForProvider } from "../model-auth.js";
import { optionalStringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { imageResultFromFile, readStringParam } from "./common.js";
import { resolveMediaToolLocalRoots } from "./media-tool-shared.js";
import {
  callStepfunImageEdit,
  callStepfunImageGeneration,
  normalizeStepfunImageSize,
  resolveStepfunImageEndpointConfig,
  saveGeneratedImageBuffer,
  toWorkspaceRelativeImagePath,
} from "./stepfun-image-tool.helpers.js";
import {
  createSandboxBridgeReadFile,
  resolveSandboxedBridgeMediaPath,
  type SandboxedBridgeMediaPathConfig,
  type SandboxFsBridge,
  type ToolFsPolicy,
} from "./tool-runtime.helpers.js";

type StepfunImageSandboxConfig = {
  root: string;
  bridge: SandboxFsBridge;
};

export function createStepfunImageTool(options?: {
  config?: OpenBotConfig;
  agentDir?: string;
  workspaceDir?: string;
  sandbox?: StepfunImageSandboxConfig;
  fsPolicy?: ToolFsPolicy;
}): AnyAgentTool | null {
  const cfg = options?.config ?? loadConfig();
  const endpoint = resolveStepfunImageEndpointConfig(cfg);
  if (!endpoint?.provider?.trim() || !endpoint.baseUrl?.trim()) {
    return null;
  }

  const localRoots = resolveMediaToolLocalRoots(options?.workspaceDir, {
    workspaceOnly: options?.fsPolicy?.workspaceOnly === true,
  });
  const sandboxConfig: SandboxedBridgeMediaPathConfig | null =
    options?.sandbox && options.sandbox.root.trim()
      ? {
          root: options.sandbox.root.trim(),
          bridge: options.sandbox.bridge,
          workspaceOnly: options?.fsPolicy?.workspaceOnly === true,
        }
      : null;

  return {
    label: "Image Generation",
    name: "image_gen",
    description: `Generate or edit images with Stepfun step-image-edit-2 (text-to-image or image editing). Use mode=generate for new images, mode=edit with image=<path> to edit an existing image. Image bytes are delivered automatically from the tool result. After success: (1) declare the workspace-relative path with <<DELIVERABLE title="标题" type="image" file=".openbot/generated-images/….png">>…<</DELIVERABLE>> using the exact relativePath from the tool details — never say "工作区根目录"; (2) reply with ${SILENT_REPLY_TOKEN} to avoid duplicate messages.`,
    parameters: Type.Object({
      prompt: Type.String({ description: "Text prompt describing the image to generate or edit." }),
      mode: optionalStringEnum(["generate", "edit"], {
        description: "generate = text-to-image (default); edit = modify the source image.",
      }),
      image: Type.Optional(
        Type.String({
          description: "Source image path or URL (required for edit mode).",
        }),
      ),
      size: Type.Optional(
        Type.String({
          description: "Output size. Allowed: 1024x1024, 768x1360, 896x1184, 1360x768, 1184x896.",
        }),
      ),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const prompt = readStringParam(params, "prompt", { required: true });
      const modeRaw = readStringParam(params, "mode");
      const imageInput = readStringParam(params, "image");
      const size = normalizeStepfunImageSize(readStringParam(params, "size"));

      const mode =
        modeRaw === "edit" || modeRaw === "generate"
          ? modeRaw
          : imageInput?.trim()
            ? "edit"
            : "generate";

      const auth = await resolveApiKeyForProvider({
        provider: endpoint.provider,
        cfg,
        agentDir: options?.agentDir,
      });
      const apiKey = auth.apiKey?.trim();
      if (!apiKey) {
        throw new Error(`No API key configured for provider "${endpoint.provider}".`);
      }

      let imageBuffer: Buffer;
      if (mode === "edit") {
        if (!imageInput?.trim()) {
          throw new Error("image is required when mode=edit.");
        }
        imageBuffer = await loadSourceImageBuffer({
          imageInput: imageInput.trim(),
          sandboxConfig,
          localRoots,
        });
        imageBuffer = await callStepfunImageEdit({
          apiKey,
          baseUrl: endpoint.baseUrl,
          model: endpoint.model,
          prompt,
          size,
          imageBuffer,
          filename: pathBasename(imageInput.trim()),
        });
      } else {
        imageBuffer = await callStepfunImageGeneration({
          apiKey,
          baseUrl: endpoint.baseUrl,
          model: endpoint.model,
          prompt,
          size,
        });
      }

      const savedPath = await saveGeneratedImageBuffer({
        buffer: imageBuffer,
        workspaceDir: options?.workspaceDir,
        prefix: mode === "edit" ? "stepfun-edit" : "stepfun-gen",
      });
      const relativePath = toWorkspaceRelativeImagePath(savedPath, options?.workspaceDir);
      const titleHint = pathBasename(relativePath).replace(/\.[^.]+$/u, "") || "generated-image";

      return await imageResultFromFile({
        label: "image_gen",
        path: savedPath,
        extraText: [
          `MEDIA:${savedPath}`,
          `relativePath: ${relativePath}`,
          `Declare: <<DELIVERABLE title="${titleHint}" type="image" file="${relativePath}">><</DELIVERABLE>>`,
          `Then reply with ${SILENT_REPLY_TOKEN}. Do not claim the file is at the workspace root.`,
          `Do not create an HTML wrapper/card for the image (no "AI 生成 · model · size" meta, no agent watermark).`,
        ].join("\n"),
        details: {
          mode,
          model: `${endpoint.provider}/${endpoint.model}`,
          size,
          provider: endpoint.provider,
          relativePath,
          workspaceFilename: relativePath,
        },
      });
    },
  };
}

function pathBasename(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("file://")) {
    return trimmed.slice("file://".length).split("/").pop() ?? "source.png";
  }
  return trimmed.split("/").pop() ?? "source.png";
}

async function loadSourceImageBuffer(params: {
  imageInput: string;
  sandboxConfig: SandboxedBridgeMediaPathConfig | null;
  localRoots: string[];
}): Promise<Buffer> {
  const imageInput = params.imageInput.trim();
  if (/^https?:\/\//i.test(imageInput)) {
    const media = await loadWebMedia(imageInput, {
      localRoots: params.localRoots,
    });
    return media.buffer;
  }

  if (params.sandboxConfig) {
    const resolved = await resolveSandboxedBridgeMediaPath({
      sandbox: params.sandboxConfig,
      mediaPath: imageInput,
    });
    const readFile = createSandboxBridgeReadFile({ sandbox: params.sandboxConfig });
    return await readFile(resolved.resolved);
  }

  const resolvedPath = resolveUserPath(imageInput);
  return await fs.readFile(resolvedPath);
}
