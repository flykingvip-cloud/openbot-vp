/** Runtime-owned command routing data; no execution or host implementation dependencies. */
export type AgentRunContext = {
  messageChannel?: string;
  accountId?: string;
  groupId?: string | null;
  groupChannel?: string | null;
  groupSpace?: string | null;
  currentChannelId?: string;
  currentThreadTs?: string;
  replyToMode?: "off" | "first" | "all";
  hasRepliedRef?: { value: boolean };
};

export type AgentCommandGovernanceEntry = "E2" | "E3";
