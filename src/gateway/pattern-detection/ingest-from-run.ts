/**
 * Server-side pattern ingest from an embedded runner turn.
 * Records concrete tool names; never hashes raw user text.
 */
import { registerNamedPatternCandidateProposal } from "../evolution-control/pattern-proposal.js";
import { applyToolsUsedByRunId, ingestPatternSample } from "./store.js";
import { structureHashFromIo, structureHashFromToolTrace } from "./structure-hash.js";
import type { PatternCandidate, PatternSample } from "./types.js";

const HEX16 = /^[0-9a-f]{16}$/;

export type IngestPatternSampleFromRunInput = {
  agentId: string;
  tenantId?: string | null;
  runId?: string | null;
  sessionKey?: string | null;
  toolsUsed: readonly string[];
  success?: boolean | null;
};

export function namedToolsFromList(tools: readonly string[]): string[] {
  return [
    ...new Set(tools.map((name) => name.trim()).filter((name) => name && !HEX16.test(name))),
  ].slice(0, 32);
}

export function ingestPatternSampleFromRun(
  input: IngestPatternSampleFromRunInput,
): { sample: PatternSample; candidate: PatternCandidate | null } | null {
  const agentId = input.agentId.trim();
  const toolsUsed = namedToolsFromList(input.toolsUsed);
  if (!agentId || toolsUsed.length === 0) {
    return null;
  }
  const toolOutline = `# tools\n${toolsUsed.map((name) => `- ${name}`).join("\n")}`;
  const result = ingestPatternSample({
    agentId,
    tenantId: input.tenantId ?? null,
    runId: input.runId ?? null,
    sessionKey: input.sessionKey ?? null,
    inputStructureHash: structureHashFromIo(toolOutline, "input"),
    outputStructureHash: structureHashFromIo(input.success === false ? "error" : "ok", "output"),
    toolTraceHash: structureHashFromToolTrace(toolsUsed),
    toolsUsed,
    success: input.success ?? null,
  });
  if (input.runId?.trim()) {
    applyToolsUsedByRunId(input.runId, toolsUsed);
  }
  if (result.candidate) {
    try {
      registerNamedPatternCandidateProposal(result.candidate);
    } catch {
      // best-effort; pattern ingest must not depend on control-plane availability
    }
  }
  return result;
}
