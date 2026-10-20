/**
 * API-key CLI backends exposed in Development Supervisor setup + credential panels.
 * Local-IDE OAuth workers (cursor-cli, devin-cli, grok-cli, …) are excluded — they
 * authenticate via the employee workstation, not platform API keys.
 */

export type SupervisorApiKeyCliBackend = {
  backendId: string;
  defaultEnv: string;
  label: string;
};

export const SUPERVISOR_API_KEY_CLI_BACKENDS: ReadonlyArray<SupervisorApiKeyCliBackend> = [
  { backendId: "codex-cli", defaultEnv: "OPENAI_API_KEY", label: "Codex CLI" },
  { backendId: "claude-cli", defaultEnv: "ANTHROPIC_API_KEY", label: "Claude CLI" },
];

export const SUPERVISOR_API_KEY_CLI_BACKEND_IDS = SUPERVISOR_API_KEY_CLI_BACKENDS.map(
  (entry) => entry.backendId,
) as readonly string[];

export function defaultEnvForApiKeyCliBackend(backendId: string): string {
  return (
    SUPERVISOR_API_KEY_CLI_BACKENDS.find((entry) => entry.backendId === backendId)?.defaultEnv ??
    "OPENAI_API_KEY"
  );
}

export function labelForApiKeyCliBackend(backendId: string): string {
  return (
    SUPERVISOR_API_KEY_CLI_BACKENDS.find((entry) => entry.backendId === backendId)?.label ??
    backendId
  );
}

export function formatApiKeyCliBackendOption(entry: SupervisorApiKeyCliBackend): string {
  return `${entry.label} · ${entry.defaultEnv}`;
}
