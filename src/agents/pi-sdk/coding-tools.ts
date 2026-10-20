import { createCodingTools, createReadTool } from "@earendil-works/pi-coding-agent";

function requireWorkspaceRoot(cwd: string): string {
  const root = cwd.trim();
  if (!root) {
    throw new Error("Pi coding tools require a non-empty workspace root");
  }
  return root;
}

/** cwd-scoped replacement for the removed 0.57 `codingTools` singleton. */
export function createWorkspaceCodingTools(cwd: string): ReturnType<typeof createCodingTools> {
  return createCodingTools(requireWorkspaceRoot(cwd));
}

/** cwd-scoped replacement for the removed 0.57 `readTool` singleton. */
export function createWorkspaceReadTool(cwd: string): ReturnType<typeof createReadTool> {
  return createReadTool(requireWorkspaceRoot(cwd));
}
