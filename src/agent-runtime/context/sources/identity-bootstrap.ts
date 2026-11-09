/** Pure rendering over captured identity facts; no workspace reads. */
export function renderIdentityBootstrapGuard(state: {
  identityInitialized: boolean;
  userInitialized: boolean;
  bootstrapPending: boolean;
}): string[] {
  if (!state.bootstrapPending && state.identityInitialized && state.userInitialized) {
    return [];
  }
  const lines = [
    "## Identity Bootstrap Guard",
    "Workspace identity bootstrap is not complete yet. Treat self-identity as incomplete unless runtime identity explicitly resolves it or IDENTITY.md/USER.md contain real non-template values.",
    "Do not improvise or rename yourself from chat fragments, memory snippets, UI labels, or user guesses alone.",
    "If asked who you are, answer conservatively using only runtime-resolved identity plus any clearly initialized file identity, and say when initialization is still incomplete.",
  ];
  if (state.bootstrapPending) {
    lines.push(
      "BOOTSTRAP.md is still present. This workspace should still be treated as awaiting identity completion.",
    );
  }
  if (!state.identityInitialized) {
    lines.push("IDENTITY.md still looks like a template or placeholder.");
  }
  if (!state.userInitialized) {
    lines.push("USER.md still looks incomplete, so user relationship details may be partial.");
  }
  lines.push("");
  return lines;
}
