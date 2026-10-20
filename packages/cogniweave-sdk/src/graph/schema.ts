import type { NodeType, RelationType } from "../models.js";

export const NODE_TYPES: NodeType[] = [
  "MemoryAtom",
  "EventSkeleton",
  "Entity",
  "Scenario",
  "Problem",
  "Evidence",
];

export const RELATION_TYPES: RelationType[] = [
  "APPLIES_TO",
  "TRIGGERED_BY",
  "SOLVES",
  "MITIGATES",
  "CONSTRAINED_BY",
  "CAUSED_BY",
  "SUPPORTED_BY",
  "CONFLICTS_WITH",
  "SUPERSEDES",
  "INSTANTIATED_IN",
  "RELATED_TO",
];

export const DEFAULT_ATOM_TYPES = [
  "problem_pattern",
  "failure_pattern",
  "strategy",
  "success_pattern",
  "constraint",
  "decision_rule",
  "heuristic",
  "anti_pattern",
  "policy",
  "preference",
] as const;
