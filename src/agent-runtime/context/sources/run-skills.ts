/** Skill context has two phases; execution applies/restores environment between them. */
export function renderRunSkillContext<TConfig, TSnapshot, TEntry>(
  prepared: {
    input: { workspaceDir: string; config?: TConfig; skillsSnapshot?: TSnapshot };
    selection: {
      shouldLoadSkillEntries: boolean;
      skillEntries: TEntry[];
      preferLiveEntries: boolean;
    };
  },
  identity: { runId: string; sessionKey?: string; accountSandboxLocations: boolean },
  ports: {
    render: (input: {
      workspaceDir: string;
      config?: TConfig;
      skillsSnapshot?: TSnapshot;
      entries?: TEntry[];
      preferLiveEntries: boolean;
      accountSandboxLocations: boolean;
    }) => string;
    observe: (input: {
      runId: string;
      sessionKey?: string;
      skillsPrompt: string;
      preferLiveEntries: boolean;
      snapshot?: TSnapshot;
      liveEntries: TEntry[];
      config?: TConfig;
    }) => void;
  },
) {
  const { input, selection } = prepared;
  const entries = selection.shouldLoadSkillEntries ? selection.skillEntries : undefined;
  const skillsPrompt = ports.render({
    workspaceDir: input.workspaceDir,
    config: input.config,
    skillsSnapshot: input.skillsSnapshot,
    entries,
    preferLiveEntries: selection.preferLiveEntries,
    accountSandboxLocations: identity.accountSandboxLocations,
  });
  ports.observe({
    runId: identity.runId,
    sessionKey: identity.sessionKey,
    skillsPrompt,
    preferLiveEntries: selection.preferLiveEntries,
    snapshot: input.skillsSnapshot,
    liveEntries: entries ?? [],
    config: input.config,
  });
  return skillsPrompt;
}
