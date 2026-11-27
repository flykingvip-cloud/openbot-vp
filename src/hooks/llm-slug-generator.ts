/**
 * LLM-based slug generator for session memory filenames.
 * Auxiliary inference only: uses shared model governance; never creates or advances tasks.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createUnifiedExecutionLifecycle,
  runEmbeddedPiAgent,
} from "../agent-runtime/execution/index.js";
import {
  resolveDefaultAgentId,
  resolveAgentWorkspaceDir,
  resolveAgentDir,
  resolveAgentEffectiveModelPrimary,
} from "../agents/agent-scope.js";
import { DEFAULT_PROVIDER, DEFAULT_MODEL } from "../agents/defaults.js";
import { parseModelRef } from "../agents/model-selection.js";
import type { OpenBotConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("llm-slug-generator");

/**
 * Generate a short 1-2 word filename slug from session content using LLM
 */
export async function generateSlugViaLLM(params: {
  sessionContent: string;
  cfg: OpenBotConfig;
  /** Optional parent turn id for inherited model-set governance. */
  parentRunId?: string;
}): Promise<string | null> {
  let tempSessionFile: string | null = null;

  try {
    const agentId = resolveDefaultAgentId(params.cfg);
    const workspaceDir = resolveAgentWorkspaceDir(params.cfg, agentId);
    const agentDir = resolveAgentDir(params.cfg, agentId);

    // Create a temporary session file for this one-off LLM call
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-slug-"));
    tempSessionFile = path.join(tempDir, "session.jsonl");

    const prompt = `Based on this conversation, generate a short 1-2 word filename slug (lowercase, hyphen-separated, no file extension).

Conversation summary:
${params.sessionContent.slice(0, 2000)}

Reply with ONLY the slug, nothing else. Examples: "vendor-pitch", "api-design", "bug-fix"`;

    // Resolve model from agent config instead of using hardcoded defaults
    const modelRef = resolveAgentEffectiveModelPrimary(params.cfg, agentId);
    const parsed = modelRef ? parseModelRef(modelRef, DEFAULT_PROVIDER) : null;
    const provider = parsed?.provider ?? DEFAULT_PROVIDER;
    const model = parsed?.model ?? DEFAULT_MODEL;
    const runId = `slug-gen-${Date.now()}`;
    const lifecycle = createUnifiedExecutionLifecycle({
      mode: "auxiliary",
      runId,
      purpose: "slug_filename",
      parentRunId: params.parentRunId,
    });
    let fallbackResult: Awaited<ReturnType<typeof lifecycle.infer>>;
    try {
      await lifecycle.prepare({ config: params.cfg });
      fallbackResult = await lifecycle.infer({
        cfg: params.cfg,
        provider,
        model,
        agentDir,
        taskText: prompt,
        run: async (providerOverride, modelOverride) =>
          runEmbeddedPiAgent({
            sessionId: `slug-generator-${Date.now()}`,
            sessionKey: "temp:slug-generator",
            agentId,
            sessionFile: tempSessionFile!,
            workspaceDir,
            agentDir,
            config: params.cfg,
            prompt,
            provider: providerOverride,
            model: modelOverride,
            timeoutMs: 15_000, // 15 second timeout
            runId,
          }),
      });
    } finally {
      await lifecycle.dispose();
    }

    const result = fallbackResult.result as { payloads?: Array<{ text?: string }> } | undefined;

    // Extract text from payloads
    if (result?.payloads && result.payloads.length > 0) {
      const textPayload = result.payloads[0]?.text;
      if (textPayload) {
        // Clean up the response - extract just the slug
        const slug = textPayload
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 30); // Max 30 chars

        return slug || null;
      }
    }

    return null;
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.error(`Failed to generate slug: ${message}`);
    return null;
  } finally {
    // Clean up temporary session file
    if (tempSessionFile) {
      try {
        await fs.rm(path.dirname(tempSessionFile), { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
