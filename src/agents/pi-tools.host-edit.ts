import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import type { AnyAgentTool } from "./pi-tools.types.js";

/** Resolve path for host edit: expand ~ and resolve relative paths against root. */
function resolveHostEditPath(root: string, pathParam: string): string {
  const expanded =
    pathParam.startsWith("~/") || pathParam === "~"
      ? pathParam.replace(/^~/, os.homedir())
      : pathParam;
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(root, expanded);
}

function readEditTextField(
  record: Record<string, unknown> | undefined,
  camel: "oldText" | "newText",
  snake: "old_string" | "new_string",
): string | undefined {
  if (!record) {
    return undefined;
  }
  const top = record[camel];
  if (typeof top === "string") {
    return top;
  }
  const aliased = record[snake];
  if (typeof aliased === "string") {
    return aliased;
  }
  if (!Array.isArray(record.edits)) {
    return undefined;
  }
  for (let index = record.edits.length - 1; index >= 0; index -= 1) {
    const entry = record.edits[index];
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const edit = entry as Record<string, unknown>;
    if (typeof edit[camel] === "string") {
      return edit[camel];
    }
    if (typeof edit[snake] === "string") {
      return edit[snake];
    }
  }
  return undefined;
}

/**
 * When the upstream edit tool throws after having already written (e.g. generateDiffString fails),
 * the file may be correctly updated but the tool reports failure. This wrapper catches errors and
 * if the target file on disk contains the intended newText, returns success so we don't surface
 * a false "edit failed" to the user (fixes #32333, same pattern as #30773 for write).
 */
export function wrapHostEditToolWithPostWriteRecovery(
  base: AnyAgentTool,
  root: string,
): AnyAgentTool {
  return {
    ...base,
    execute: async (
      toolCallId: string,
      params: unknown,
      signal: AbortSignal | undefined,
      onUpdate?: AgentToolUpdateCallback<unknown>,
    ) => {
      try {
        return await base.execute(toolCallId, params, signal, onUpdate);
      } catch (err) {
        const record =
          params && typeof params === "object" ? (params as Record<string, unknown>) : undefined;
        const pathParam = record && typeof record.path === "string" ? record.path : undefined;
        const newText = readEditTextField(record, "newText", "new_string");
        const oldText = readEditTextField(record, "oldText", "old_string");
        if (!pathParam || !newText) {
          throw err;
        }
        try {
          const absolutePath = resolveHostEditPath(root, pathParam);
          const content = await fs.readFile(absolutePath, "utf-8");
          // Only recover when the replacement likely occurred: newText is present and oldText
          // is no longer present. This avoids false success when upstream threw before writing
          // (e.g. oldText not found) but the file already contained newText (review feedback).
          const hasNew = content.includes(newText);
          const stillHasOld =
            oldText !== undefined && oldText.length > 0 && content.includes(oldText);
          if (hasNew && !stillHasOld) {
            return {
              content: [
                {
                  type: "text",
                  text: `Successfully replaced text in ${pathParam}.`,
                },
              ],
              details: { diff: "", firstChangedLine: undefined },
            } as AgentToolResult<unknown>;
          }
        } catch {
          // File read failed or path invalid; rethrow original error.
        }
        throw err;
      }
    },
  };
}
