export const POLICY_ENGINE_ENDPOINTS = {
  overview: "platform-policy.overview",
  list: "platform-policy.list",
  get: "platform-policy.get",
} as const;

export type RoutingPolicy = {
  id: string;
  name: string;
  description: string;
  selectorStrategy: "cheapest" | "best_quality" | "balanced" | "bandit";
  status: "active" | "archived";
  builtin: boolean;
  updatedAt: string;
};
