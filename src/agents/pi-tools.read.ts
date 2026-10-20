import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-coding-agent";
import { resolveWorkspaceWriteLocator } from "../gateway/workspace-resolver/workspace-write-contract.js";
import {
  attachProvenanceToThrownError,
  decorateToolResultProvenance,
  emitExecutionChainProvenance,
  type MutationAttemptProvenance,
} from "../infra/execution-chain-provenance.js";
import {
  appendFileWithinRoot,
  SafeOpenError,
  openFileWithinRoot,
  readFileWithinRoot,
  writeFileWithinRoot,
} from "../infra/fs-safe.js";
import {
  formatDesktopSaveRoutingError,
  parseLocalDesktopSaveTarget,
} from "../infra/local-exec-permission.js";
import {
  assertNonEmptyWritePayload,
  assertWrittenFileNonEmpty,
} from "../infra/non-empty-workspace-write.js";
import { detectMime } from "../media/mime.js";
import { sniffMimeFromBase64 } from "../media/sniff-mime-from-base64.js";
import type { ImageSanitizationLimits } from "./image-sanitization.js";
import { toRelativeWorkspacePath } from "./path-policy.js";
import { wrapHostEditToolWithPostWriteRecovery } from "./pi-tools.host-edit.js";
import {
  CLAUDE_PARAM_GROUPS,
  assertRequiredParams,
  normalizeToolParams,
  patchToolSchemaForClaudeCompatibility,
  wrapToolParamNormalization,
} from "./pi-tools.params.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import { assertSandboxPath } from "./sandbox-paths.js";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.js";
import { sanitizeToolResultImages } from "./tool-images.js";

export {
  CLAUDE_PARAM_GROUPS,
  assertRequiredParams,
  normalizeToolParams,
  patchToolSchemaForClaudeCompatibility,
  wrapToolParamNormalization,
} from "./pi-tools.params.js";

// NOTE(steipete): Upstream read now does file-magic MIME detection; we keep the wrapper
// to normalize payloads and sanitize oversized images before they hit providers.
type ToolContentBlock = AgentToolResult<unknown>["content"][number];
type ImageContentBlock = Extract<ToolContentBlock, { type: "image" }>;
type TextContentBlock = Extract<ToolContentBlock, { type: "text" }>;

const DEFAULT_READ_PAGE_MAX_BYTES = 50 * 1024;
const MAX_ADAPTIVE_READ_MAX_BYTES = 512 * 1024;
const ADAPTIVE_READ_CONTEXT_SHARE = 0.2;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const MAX_ADAPTIVE_READ_PAGES = 8;

type OpenClawReadToolOptions = {
  modelContextWindowTokens?: number;
  imageSanitization?: ImageSanitizationLimits;
  modelHasVision?: boolean;
};

type ReadTruncationDetails = {
  truncated: boolean;
  outputLines: number;
  firstLineExceedsLimit: boolean;
};

const READ_CONTINUATION_NOTICE_RE =
  /\n\n\[(?:Showing lines [^\]]*?Use offset=\d+ to continue\.|\d+ more lines in file\. Use offset=\d+ to continue\.)\]\s*$/;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveAdaptiveReadMaxBytes(options?: OpenClawReadToolOptions): number {
  const contextWindowTokens = options?.modelContextWindowTokens;
  if (
    typeof contextWindowTokens !== "number" ||
    !Number.isFinite(contextWindowTokens) ||
    contextWindowTokens <= 0
  ) {
    return DEFAULT_READ_PAGE_MAX_BYTES;
  }
  const fromContext = Math.floor(
    contextWindowTokens * CHARS_PER_TOKEN_ESTIMATE * ADAPTIVE_READ_CONTEXT_SHARE,
  );
  return clamp(fromContext, DEFAULT_READ_PAGE_MAX_BYTES, MAX_ADAPTIVE_READ_MAX_BYTES);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  return `${bytes}B`;
}

function getToolResultText(result: AgentToolResult<unknown>): string | undefined {
  const content = Array.isArray(result.content) ? result.content : [];
  const textBlocks = content
    .map((block) => {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        return (block as { text: string }).text;
      }
      return undefined;
    })
    .filter((value): value is string => typeof value === "string");
  if (textBlocks.length === 0) {
    return undefined;
  }
  return textBlocks.join("\n");
}

function withToolResultText(
  result: AgentToolResult<unknown>,
  text: string,
): AgentToolResult<unknown> {
  const content = Array.isArray(result.content) ? result.content : [];
  let replaced = false;
  const nextContent: ToolContentBlock[] = content.map((block) => {
    if (
      !replaced &&
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text"
    ) {
      replaced = true;
      return {
        ...(block as TextContentBlock),
        text,
      };
    }
    return block;
  });
  if (replaced) {
    return {
      ...result,
      content: nextContent as unknown as AgentToolResult<unknown>["content"],
    };
  }
  const textBlock = { type: "text", text } as unknown as TextContentBlock;
  return {
    ...result,
    content: [textBlock] as unknown as AgentToolResult<unknown>["content"],
  };
}

function extractReadTruncationDetails(
  result: AgentToolResult<unknown>,
): ReadTruncationDetails | null {
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") {
    return null;
  }
  const truncation = (details as { truncation?: unknown }).truncation;
  if (!truncation || typeof truncation !== "object") {
    return null;
  }
  const record = truncation as Record<string, unknown>;
  if (record.truncated !== true) {
    return null;
  }
  const outputLinesRaw = record.outputLines;
  const outputLines =
    typeof outputLinesRaw === "number" && Number.isFinite(outputLinesRaw)
      ? Math.max(0, Math.floor(outputLinesRaw))
      : 0;
  return {
    truncated: true,
    outputLines,
    firstLineExceedsLimit: record.firstLineExceedsLimit === true,
  };
}

function stripReadContinuationNotice(text: string): string {
  return text.replace(READ_CONTINUATION_NOTICE_RE, "");
}

function stripReadTruncationContentDetails(
  result: AgentToolResult<unknown>,
): AgentToolResult<unknown> {
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") {
    return result;
  }

  const detailsRecord = details as Record<string, unknown>;
  const truncationRaw = detailsRecord.truncation;
  if (!truncationRaw || typeof truncationRaw !== "object") {
    return result;
  }

  const truncation = truncationRaw as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(truncation, "content")) {
    return result;
  }

  const { content: _content, ...restTruncation } = truncation;
  return {
    ...result,
    details: {
      ...detailsRecord,
      truncation: restTruncation,
    },
  };
}

async function executeReadWithAdaptivePaging(params: {
  base: AnyAgentTool;
  toolCallId: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
  maxBytes: number;
}): Promise<AgentToolResult<unknown>> {
  const userLimit = params.args.limit;
  const hasExplicitLimit =
    typeof userLimit === "number" && Number.isFinite(userLimit) && userLimit > 0;
  if (hasExplicitLimit) {
    return await params.base.execute(params.toolCallId, params.args, params.signal);
  }

  const offsetRaw = params.args.offset;
  let nextOffset =
    typeof offsetRaw === "number" && Number.isFinite(offsetRaw) && offsetRaw > 0
      ? Math.floor(offsetRaw)
      : 1;
  let firstResult: AgentToolResult<unknown> | null = null;
  let aggregatedText = "";
  let aggregatedBytes = 0;
  let capped = false;
  let continuationOffset: number | undefined;

  for (let page = 0; page < MAX_ADAPTIVE_READ_PAGES; page += 1) {
    const pageArgs = { ...params.args, offset: nextOffset };
    const pageResult = await params.base.execute(params.toolCallId, pageArgs, params.signal);
    firstResult ??= pageResult;

    const rawText = getToolResultText(pageResult);
    if (typeof rawText !== "string") {
      return pageResult;
    }

    const truncation = extractReadTruncationDetails(pageResult);
    const canContinue =
      Boolean(truncation?.truncated) &&
      !truncation?.firstLineExceedsLimit &&
      (truncation?.outputLines ?? 0) > 0 &&
      page < MAX_ADAPTIVE_READ_PAGES - 1;
    const pageText = canContinue ? stripReadContinuationNotice(rawText) : rawText;
    const delimiter = aggregatedText ? "\n\n" : "";
    const nextBytes = Buffer.byteLength(`${delimiter}${pageText}`, "utf-8");

    if (aggregatedText && aggregatedBytes + nextBytes > params.maxBytes) {
      capped = true;
      continuationOffset = nextOffset;
      break;
    }

    aggregatedText += `${delimiter}${pageText}`;
    aggregatedBytes += nextBytes;

    if (!canContinue || !truncation) {
      return withToolResultText(pageResult, aggregatedText);
    }

    nextOffset += truncation.outputLines;
    continuationOffset = nextOffset;

    if (aggregatedBytes >= params.maxBytes) {
      capped = true;
      break;
    }
  }

  if (!firstResult) {
    return await params.base.execute(params.toolCallId, params.args, params.signal);
  }

  let finalText = aggregatedText;
  if (capped && continuationOffset) {
    finalText += `\n\n[Read output capped at ${formatBytes(params.maxBytes)} for this call. Use offset=${continuationOffset} to continue.]`;
  }
  return withToolResultText(firstResult, finalText);
}

function rewriteReadImageHeader(text: string, mimeType: string): string {
  // pi-coding-agent uses: "Read image file [image/png]"
  if (text.startsWith("Read image file [") && text.endsWith("]")) {
    return `Read image file [${mimeType}]`;
  }
  return text;
}

async function normalizeReadImageResult(
  result: AgentToolResult<unknown>,
  filePath: string,
): Promise<AgentToolResult<unknown>> {
  const content = Array.isArray(result.content) ? result.content : [];

  const image = content.find(
    (b): b is ImageContentBlock =>
      !!b &&
      typeof b === "object" &&
      (b as { type?: unknown }).type === "image" &&
      typeof (b as { data?: unknown }).data === "string" &&
      typeof (b as { mimeType?: unknown }).mimeType === "string",
  );
  if (!image) {
    return result;
  }

  if (!image.data.trim()) {
    throw new Error(`read: image payload is empty (${filePath})`);
  }

  const sniffed = await sniffMimeFromBase64(image.data);
  if (!sniffed) {
    return result;
  }

  if (!sniffed.startsWith("image/")) {
    throw new Error(
      `read: file looks like ${sniffed} but was treated as ${image.mimeType} (${filePath})`,
    );
  }

  if (sniffed === image.mimeType) {
    return result;
  }

  const nextContent = content.map((block) => {
    if (block && typeof block === "object" && (block as { type?: unknown }).type === "image") {
      const b = block as ImageContentBlock & { mimeType: string };
      return { ...b, mimeType: sniffed } satisfies ImageContentBlock;
    }
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      const b = block as TextContentBlock & { text: string };
      return {
        ...b,
        text: rewriteReadImageHeader(b.text, sniffed),
      } satisfies TextContentBlock;
    }
    return block;
  });

  return { ...result, content: nextContent };
}

function replaceImageBlocksForTextOnlyModel(
  result: AgentToolResult<unknown>,
  filePath: string,
): AgentToolResult<unknown> {
  const content = Array.isArray(result.content) ? result.content : [];
  const hasImage = content.some(
    (block) =>
      !!block && typeof block === "object" && (block as { type?: unknown }).type === "image",
  );
  if (!hasImage) {
    return result;
  }

  return {
    ...result,
    content: [
      {
        type: "text",
        text:
          `The requested file is an image (${filePath}), but the active model for this turn ` +
          "does not support native image input through the read tool. Use the image tool with " +
          "this path to inspect the pixels. If the image tool is unavailable or fails, say you cannot read the image.",
      } as unknown as TextContentBlock,
    ] as unknown as AgentToolResult<unknown>["content"],
  };
}

export type WorkspaceRootGuardOptions = {
  containerWorkdir?: string;
  sessionId?: string | null;
  sessionKey?: string | null;
  runId?: string | null;
};

export function wrapToolWorkspaceRootGuard(
  tool: AnyAgentTool,
  root: string,
  options?: WorkspaceRootGuardOptions,
): AnyAgentTool {
  return wrapToolWorkspaceRootGuardWithOptions(tool, root, options);
}

function mapContainerPathToWorkspaceRoot(params: {
  filePath: string;
  root: string;
  containerWorkdir?: string;
}): string {
  const containerWorkdir = params.containerWorkdir?.trim();
  if (!containerWorkdir) {
    return params.filePath;
  }
  const normalizedWorkdir = containerWorkdir.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalizedWorkdir.startsWith("/")) {
    return params.filePath;
  }
  if (!normalizedWorkdir) {
    return params.filePath;
  }

  let candidate = params.filePath.startsWith("@") ? params.filePath.slice(1) : params.filePath;
  if (/^file:\/\//i.test(candidate)) {
    try {
      candidate = fileURLToPath(candidate);
    } catch {
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== "file:") {
          return params.filePath;
        }
        candidate = decodeURIComponent(parsed.pathname || "");
        if (!candidate.startsWith("/")) {
          return params.filePath;
        }
      } catch {
        return params.filePath;
      }
    }
  }

  const normalizedCandidate = candidate.replace(/\\/g, "/");
  if (normalizedCandidate === normalizedWorkdir) {
    return path.resolve(params.root);
  }
  const prefix = `${normalizedWorkdir}/`;
  if (!normalizedCandidate.startsWith(prefix)) {
    return candidate;
  }
  const relative = normalizedCandidate.slice(prefix.length);
  if (!relative) {
    return path.resolve(params.root);
  }
  return path.resolve(params.root, ...relative.split("/").filter(Boolean));
}

export function resolveToolPathAgainstWorkspaceRoot(params: {
  filePath: string;
  root: string;
  containerWorkdir?: string;
}): string {
  const mapped = mapContainerPathToWorkspaceRoot(params);
  const candidate = mapped.startsWith("@") ? mapped.slice(1) : mapped;
  return path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(params.root, candidate || ".");
}

type MemoryFlushAppendOnlyWriteOptions = {
  root: string;
  relativePath: string;
  containerWorkdir?: string;
  sandbox?: {
    root: string;
    bridge: SandboxFsBridge;
  };
};

async function readOptionalUtf8File(params: {
  absolutePath: string;
  relativePath: string;
  sandbox?: MemoryFlushAppendOnlyWriteOptions["sandbox"];
  signal?: AbortSignal;
}): Promise<string> {
  try {
    if (params.sandbox) {
      const stat = await params.sandbox.bridge.stat({
        filePath: params.relativePath,
        cwd: params.sandbox.root,
        signal: params.signal,
      });
      if (!stat) {
        return "";
      }
      const buffer = await params.sandbox.bridge.readFile({
        filePath: params.relativePath,
        cwd: params.sandbox.root,
        signal: params.signal,
      });
      return buffer.toString("utf-8");
    }
    return await fs.readFile(params.absolutePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function appendMemoryFlushContent(params: {
  absolutePath: string;
  root: string;
  relativePath: string;
  content: string;
  sandbox?: MemoryFlushAppendOnlyWriteOptions["sandbox"];
  signal?: AbortSignal;
}) {
  if (!params.sandbox) {
    await appendFileWithinRoot({
      rootDir: params.root,
      relativePath: params.relativePath,
      data: params.content,
      mkdir: true,
      prependNewlineIfNeeded: true,
    });
    return;
  }

  const existing = await readOptionalUtf8File({
    absolutePath: params.absolutePath,
    relativePath: params.relativePath,
    sandbox: params.sandbox,
    signal: params.signal,
  });
  const separator =
    existing.length > 0 && !existing.endsWith("\n") && !params.content.startsWith("\n") ? "\n" : "";
  const next = `${existing}${separator}${params.content}`;
  if (params.sandbox) {
    const parent = path.posix.dirname(params.relativePath);
    if (parent && parent !== ".") {
      await params.sandbox.bridge.mkdirp({
        filePath: parent,
        cwd: params.sandbox.root,
        signal: params.signal,
      });
    }
    await params.sandbox.bridge.writeFile({
      filePath: params.relativePath,
      cwd: params.sandbox.root,
      data: next,
      mkdir: true,
      signal: params.signal,
    });
    return;
  }
  await fs.mkdir(path.dirname(params.absolutePath), { recursive: true });
  await fs.writeFile(params.absolutePath, next, "utf-8");
}

export function wrapToolMemoryFlushAppendOnlyWrite(
  tool: AnyAgentTool,
  options: MemoryFlushAppendOnlyWriteOptions,
): AnyAgentTool {
  const allowedAbsolutePath = path.resolve(options.root, options.relativePath);
  return {
    ...tool,
    description: `${tool.description} During memory flush, this tool may only append to ${options.relativePath}.`,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const normalized = normalizeToolParams(args);
      const record =
        normalized ??
        (args && typeof args === "object" ? (args as Record<string, unknown>) : undefined);
      assertRequiredParams(record, CLAUDE_PARAM_GROUPS.write, tool.name);
      const filePath =
        typeof record?.path === "string" && record.path.trim() ? record.path : undefined;
      const content = typeof record?.content === "string" ? record.content : undefined;
      if (!filePath || content === undefined) {
        return tool.execute(toolCallId, normalized ?? args, signal, onUpdate);
      }

      const resolvedPath = resolveToolPathAgainstWorkspaceRoot({
        filePath,
        root: options.root,
        containerWorkdir: options.containerWorkdir,
      });
      if (resolvedPath !== allowedAbsolutePath) {
        throw new Error(
          `Memory flush writes are restricted to ${options.relativePath}; use that path only.`,
        );
      }

      await appendMemoryFlushContent({
        absolutePath: allowedAbsolutePath,
        root: options.root,
        relativePath: options.relativePath,
        content,
        sandbox: options.sandbox,
        signal,
      });
      return {
        content: [{ type: "text", text: `Appended content to ${options.relativePath}.` }],
        details: {
          path: options.relativePath,
          appendOnly: true,
        },
      };
    },
  };
}

const MUTATION_GUARD_TOOL_NAMES = new Set(["write", "edit"]);

export function wrapToolWorkspaceRootGuardWithOptions(
  tool: AnyAgentTool,
  root: string,
  options?: WorkspaceRootGuardOptions,
): AnyAgentTool {
  const emitMutation = MUTATION_GUARD_TOOL_NAMES.has(tool.name);
  const session_id = options?.sessionId?.trim() || null;
  const session_key = options?.sessionKey?.trim() || null;
  const run_id = options?.runId?.trim() || null;
  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const normalized = normalizeToolParams(args);
      const record =
        normalized ??
        (args && typeof args === "object" ? (args as Record<string, unknown>) : undefined);
      const filePath = record?.path;
      const resource = typeof filePath === "string" && filePath.trim() ? filePath : null;
      const buildMutationRecord = (
        decision: MutationAttemptProvenance["policy"]["decision"],
        reason: MutationAttemptProvenance["policy"]["reason"],
        result: MutationAttemptProvenance["result"],
      ): MutationAttemptProvenance => ({
        kind: "mutation_attempt",
        tool: tool.name,
        tool_call_id: toolCallId ?? null,
        session_id,
        session_key,
        run_id,
        resource,
        policy: {
          owner: "workspace-root-guard",
          decision,
          reason,
        },
        authorization: { decision: "unknown" },
        approval: { decision: "not_observed" },
        result,
        // `applied` = write/edit tool returned. Not an independently observed
        // filesystem mutation. This wrapper never writes `verified`.
        effectObserved:
          decision === "denied" ? "blocked" : result === "success" ? "applied" : "unknown",
      });
      if (typeof filePath === "string" && filePath.trim()) {
        const sandboxPath = mapContainerPathToWorkspaceRoot({
          filePath,
          root,
          containerWorkdir: options?.containerWorkdir,
        });
        try {
          await assertSandboxPath({ filePath: sandboxPath, cwd: root, root });
        } catch (err) {
          if (emitMutation) {
            attachProvenanceToThrownError(
              err,
              buildMutationRecord("denied", "sandbox_boundary", "denied"),
            );
          }
          throw err;
        }
      }
      try {
        const result = await tool.execute(toolCallId, normalized ?? args, signal, onUpdate);
        if (emitMutation) {
          const provenance = buildMutationRecord("allowed", "passed_existing_guard", "success");
          emitExecutionChainProvenance(provenance);
          return decorateToolResultProvenance(result, provenance);
        }
        return result;
      } catch (err) {
        if (emitMutation) {
          attachProvenanceToThrownError(
            err,
            buildMutationRecord("allowed", "passed_existing_guard", "error"),
          );
        }
        throw err;
      }
    },
  };
}

type SandboxToolParams = {
  root: string;
  bridge: SandboxFsBridge;
  modelContextWindowTokens?: number;
  imageSanitization?: ImageSanitizationLimits;
  modelHasVision?: boolean;
};

export function createSandboxedReadTool(params: SandboxToolParams) {
  const base = createReadTool(params.root, {
    operations: createSandboxReadOperations(params),
  }) as unknown as AnyAgentTool;
  return createOpenClawReadTool(base, {
    modelContextWindowTokens: params.modelContextWindowTokens,
    imageSanitization: params.imageSanitization,
    modelHasVision: params.modelHasVision,
  });
}

export function createSandboxedWriteTool(params: SandboxToolParams) {
  const base = createWriteTool(params.root, {
    operations: createSandboxWriteOperations(params),
  }) as unknown as AnyAgentTool;
  return guardLocalDesktopMutation(wrapToolParamNormalization(base, CLAUDE_PARAM_GROUPS.write));
}

export function createSandboxedEditTool(params: SandboxToolParams) {
  const base = createEditTool(params.root, {
    operations: createSandboxEditOperations(params),
  }) as unknown as AnyAgentTool;
  return guardLocalDesktopMutation(wrapToolParamNormalization(base, CLAUDE_PARAM_GROUPS.edit));
}

export function createHostWorkspaceWriteTool(root: string, options?: { workspaceOnly?: boolean }) {
  const base = createWriteTool(root, {
    operations: createHostWriteOperations(root, options),
  }) as unknown as AnyAgentTool;
  return guardLocalDesktopMutation(wrapToolParamNormalization(base, CLAUDE_PARAM_GROUPS.write));
}

export function createHostWorkspaceEditTool(root: string, options?: { workspaceOnly?: boolean }) {
  const base = createEditTool(root, {
    operations: createHostEditOperations(root, options),
  }) as unknown as AnyAgentTool;
  const withRecovery = wrapHostEditToolWithPostWriteRecovery(base, root);
  return guardLocalDesktopMutation(
    wrapToolParamNormalization(withRecovery, CLAUDE_PARAM_GROUPS.edit),
  );
}

function localDesktopFileName(params: unknown): string | null {
  if (!params || typeof params !== "object") {
    return null;
  }
  const record = params as Record<string, unknown>;
  const raw = record.path ?? record.file_path;
  if (typeof raw !== "string") {
    return null;
  }
  return parseLocalDesktopSaveTarget(raw)?.fileName ?? null;
}

function guardLocalDesktopMutation(tool: AnyAgentTool): AnyAgentTool {
  return {
    ...tool,
    description:
      `${tool.description ?? ""} The user's own Desktop (~/Desktop, /Users/<name>/Desktop) is saved with exec host=node, not this tool.`.trim(),
    execute: async (toolCallId, params, signal, onUpdate) => {
      const fileName = localDesktopFileName(params);
      if (fileName) {
        const content =
          tool.name === "write" && params && typeof params === "object"
            ? (params as { content?: unknown }).content
            : undefined;
        throw new Error(
          formatDesktopSaveRoutingError({
            fileName,
            content: typeof content === "string" ? content : undefined,
          }),
        );
      }
      return tool.execute(toolCallId, params, signal, onUpdate);
    },
  };
}

export function createOpenClawReadTool(
  base: AnyAgentTool,
  options?: OpenClawReadToolOptions,
): AnyAgentTool {
  const patched = patchToolSchemaForClaudeCompatibility(base);
  return {
    ...patched,
    description:
      options?.modelHasVision === false
        ? `${patched.description} Do not use this tool to inspect image pixels in the current turn; use the image tool for image files.`
        : patched.description,
    execute: async (toolCallId, params, signal) => {
      const normalized = normalizeToolParams(params);
      const record =
        normalized ??
        (params && typeof params === "object" ? (params as Record<string, unknown>) : undefined);
      assertRequiredParams(record, CLAUDE_PARAM_GROUPS.read, base.name);
      const result = await executeReadWithAdaptivePaging({
        base,
        toolCallId,
        args: (normalized ?? params ?? {}) as Record<string, unknown>,
        signal,
        maxBytes: resolveAdaptiveReadMaxBytes(options),
      });
      const filePath = typeof record?.path === "string" ? String(record.path) : "<unknown>";
      const strippedDetailsResult = stripReadTruncationContentDetails(result);
      const normalizedResult = await normalizeReadImageResult(strippedDetailsResult, filePath);
      if (options?.modelHasVision === false) {
        return replaceImageBlocksForTextOnlyModel(normalizedResult, filePath);
      }
      return sanitizeToolResultImages(
        normalizedResult,
        `read:${filePath}`,
        options?.imageSanitization,
      );
    },
  };
}

function createSandboxReadOperations(params: SandboxToolParams) {
  return {
    readFile: (absolutePath: string) =>
      params.bridge.readFile({ filePath: absolutePath, cwd: params.root }),
    access: async (absolutePath: string) => {
      const stat = await params.bridge.stat({ filePath: absolutePath, cwd: params.root });
      if (!stat) {
        throw createFsAccessError("ENOENT", absolutePath);
      }
    },
    detectImageMimeType: async (absolutePath: string) => {
      const buffer = await params.bridge.readFile({ filePath: absolutePath, cwd: params.root });
      const mime = await detectMime({ buffer, filePath: absolutePath });
      return mime && mime.startsWith("image/") ? mime : undefined;
    },
  } as const;
}

function createSandboxWriteOperations(params: SandboxToolParams) {
  return {
    mkdir: async (dir: string) => {
      await params.bridge.mkdirp({ filePath: dir, cwd: params.root });
    },
    writeFile: async (absolutePath: string, content: string) => {
      await writeSandboxFile(params, absolutePath, content);
    },
  } as const;
}

function createSandboxEditOperations(params: SandboxToolParams) {
  return {
    readFile: (absolutePath: string) =>
      params.bridge.readFile({ filePath: absolutePath, cwd: params.root }),
    writeFile: (absolutePath: string, content: string) =>
      writeSandboxFile(params, absolutePath, content),
    access: async (absolutePath: string) => {
      const stat = await params.bridge.stat({ filePath: absolutePath, cwd: params.root });
      if (!stat) {
        throw createFsAccessError("ENOENT", absolutePath);
      }
    },
  } as const;
}

async function writeSandboxFile(
  params: SandboxToolParams,
  absolutePath: string,
  content: string,
): Promise<void> {
  const decision = resolveWorkspaceWriteLocator({
    workspaceRoot: params.root,
    requestedPath: absolutePath,
    containerAliases: true,
  });
  if (!decision.ok) {
    throw new Error(decision.message);
  }
  // Payload gate only. A follow-up container stat would add a docker round-trip
  // on every edit; zero-byte success is the empty payload the tool is about to persist.
  assertNonEmptyWritePayload(content, decision.relativePath);
  await params.bridge.writeFile({
    filePath: decision.relativePath,
    cwd: params.root,
    data: content,
  });
}

async function writeContractedHostFile(root: string, absolutePath: string, content: string) {
  const decision = resolveWorkspaceWriteLocator({
    workspaceRoot: root,
    requestedPath: absolutePath,
    containerAliases: true,
  });
  if (!decision.ok) {
    throw new Error(decision.message);
  }
  await writeHostWorkspaceFile(decision.workspaceRoot, decision.absolutePath, content);
}

async function mkdirContractedHost(root: string, dir: string) {
  const decision = resolveWorkspaceWriteLocator({
    workspaceRoot: root,
    requestedPath: dir,
    purpose: "directory",
    containerAliases: true,
  });
  if (!decision.ok) {
    throw new Error(decision.message);
  }
  const resolved = decision.relativePath
    ? path.resolve(decision.workspaceRoot, decision.relativePath)
    : path.resolve(decision.workspaceRoot);
  await fs.mkdir(resolved, { recursive: true });
}

async function writeHostWorkspaceFile(root: string, absolutePath: string, content: string) {
  assertNonEmptyWritePayload(content, absolutePath);
  const relative = toRelativeWorkspacePath(root, absolutePath);
  await writeFileWithinRoot({
    rootDir: root,
    relativePath: relative,
    data: content,
    mkdir: true,
  });
  await assertWrittenFileNonEmpty(path.resolve(root, relative));
}

function createHostWriteOperations(root: string, options?: { workspaceOnly?: boolean }) {
  const workspaceOnly = options?.workspaceOnly ?? false;
  const writeFile = (absolutePath: string, content: string) =>
    writeContractedHostFile(root, absolutePath, content);

  if (!workspaceOnly) {
    // Deliverable writes stay inside this bot's workspace even when the
    // broader fs.workspaceOnly flag is off. Reads are unchanged.
    return {
      mkdir: (dir: string) => mkdirContractedHost(root, dir),
      writeFile,
    } as const;
  }

  // When workspaceOnly is true, enforce workspace boundary
  return {
    mkdir: async (dir: string) => {
      const relative = toRelativeWorkspacePath(root, dir, { allowRoot: true });
      const resolved = relative ? path.resolve(root, relative) : path.resolve(root);
      await assertSandboxPath({ filePath: resolved, cwd: root, root });
      await fs.mkdir(resolved, { recursive: true });
    },
    writeFile,
  } as const;
}

function createHostEditOperations(root: string, options?: { workspaceOnly?: boolean }) {
  const workspaceOnly = options?.workspaceOnly ?? false;

  if (!workspaceOnly) {
    // Reads may leave the workspace. The bytes of an edit must land inside it.
    return {
      readFile: async (absolutePath: string) => {
        const resolved = path.resolve(absolutePath);
        return await fs.readFile(resolved);
      },
      writeFile: (absolutePath: string, content: string) =>
        writeContractedHostFile(root, absolutePath, content),
      access: async (absolutePath: string) => {
        const resolved = path.resolve(absolutePath);
        await fs.access(resolved);
      },
    } as const;
  }

  // When workspaceOnly is true, enforce workspace boundary
  return {
    readFile: async (absolutePath: string) => {
      const relative = toRelativeWorkspacePath(root, absolutePath);
      const safeRead = await readFileWithinRoot({
        rootDir: root,
        relativePath: relative,
      });
      return safeRead.buffer;
    },
    writeFile: (absolutePath: string, content: string) =>
      writeContractedHostFile(root, absolutePath, content),
    access: async (absolutePath: string) => {
      let relative: string;
      try {
        relative = toRelativeWorkspacePath(root, absolutePath);
      } catch {
        // Path escapes workspace root.  Don't throw here – the upstream
        // library replaces any `access` error with a misleading "File not
        // found" message.  By returning silently the subsequent `readFile`
        // call will throw the same "Path escapes workspace root" error
        // through a code-path that propagates the original message.
        return;
      }
      try {
        const opened = await openFileWithinRoot({
          rootDir: root,
          relativePath: relative,
        });
        await opened.handle.close().catch(() => {});
      } catch (error) {
        if (error instanceof SafeOpenError && error.code === "not-found") {
          throw createFsAccessError("ENOENT", absolutePath);
        }
        if (error instanceof SafeOpenError && error.code === "outside-workspace") {
          // Don't throw here – see the comment above about the upstream
          // library swallowing access errors as "File not found".
          return;
        }
        throw error;
      }
    },
  } as const;
}

function createFsAccessError(code: string, filePath: string): NodeJS.ErrnoException {
  const error = new Error(`Sandbox FS error (${code}): ${filePath}`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}
