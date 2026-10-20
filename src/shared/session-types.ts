export type GatewayAgentIdentity = {
  name?: string;
  theme?: string;
  emoji?: string;
  avatar?: string;
  avatarUrl?: string;
};

/** Runtime bind state for account-roster projection (employee agents.list). */
export type AgentRuntimeStatus = "ready" | "provisioning" | "unavailable";

export type GatewayAgentRow = {
  id: string;
  name?: string;
  identity?: GatewayAgentIdentity;
  ownerId?: string;
  ownerName?: string;
  scope?: string;
  shareStatus?: string;
  /**
   * Present on employee roster projections. `ready` = local gateway hosts runtime;
   * `provisioning` = entitled in control plane but runtime not bound on this host.
   */
  runtimeStatus?: AgentRuntimeStatus;
};

export type SessionsListResultBase<TDefaults, TRow> = {
  ts: number;
  path: string;
  count: number;
  defaults: TDefaults;
  sessions: TRow[];
};

export type SessionsPatchResultBase<TEntry> = {
  ok: true;
  path: string;
  key: string;
  entry: TEntry;
};
