/** Prompt when the agent workspace lives on a remote/cloud gateway (not the user's desktop). */
export function buildRemoteGatewayEnvironmentPrompt(workspaceDir: string): string | undefined {
  const normalized = workspaceDir.replace(/\\/g, "/").trim();
  if (!normalized) {
    return undefined;
  }
  const remoteRoots = ["/root/", "/app/", "/var/lib/openbot/"];
  const onRemoteHost =
    process.env.OPENBOT_CLOUD_GATEWAY === "1" ||
    remoteRoots.some((prefix) => normalized.startsWith(prefix));
  if (!onRemoteHost) {
    return undefined;
  }
  return [
    "Runtime environment (authoritative):",
    "- This agent runs on a remote OpenBot gateway host, not the user's local computer.",
    "- Do not assume paths such as `/Users/...`, `~/Downloads`, or other desktop folders are readable.",
    "- Use uploaded attachments, platform-registered tools/MCP, repository URLs, or explicit user-provided links instead.",
  ].join("\n");
}
