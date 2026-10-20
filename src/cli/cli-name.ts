import path from "node:path";

export const DEFAULT_CLI_NAME = "openbot";

// Display/normalization only: the project is unified under the "openbot" name.
// The legacy `openclaw` binary still works as an invocation alias (command
// dispatch uses the real argv), but all user-facing command text resolves to
// "openbot" — including when invoked via the openclaw alias.
const KNOWN_CLI_NAMES = new Set([DEFAULT_CLI_NAME]);
const CLI_PREFIX_RE = /^(?:((?:pnpm|npm|bunx|npx)\s+))?(?:openbot|openclaw)\b/;

export function resolveCliName(argv: string[] = process.argv): string {
  const argv1 = argv[1];
  if (!argv1) {
    return DEFAULT_CLI_NAME;
  }
  const base = path
    .basename(argv1)
    .trim()
    .replace(/\.(?:mjs|js|cjs)$/i, "");
  if (KNOWN_CLI_NAMES.has(base)) {
    return base;
  }
  return DEFAULT_CLI_NAME;
}

export function replaceCliName(command: string, cliName = resolveCliName()): string {
  if (!command.trim()) {
    return command;
  }
  if (!CLI_PREFIX_RE.test(command)) {
    return command;
  }
  return command.replace(CLI_PREFIX_RE, (_match, runner: string | undefined) => {
    return `${runner ?? ""}${cliName}`;
  });
}
