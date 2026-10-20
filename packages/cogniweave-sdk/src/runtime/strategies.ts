import type {
  DistillationQuality,
  DistillationResult,
  EngineConfig,
  EventSkeleton,
  MemoryAtom,
  Scope,
  ScopeInput,
  SourceType,
  TaskFrame,
  WritePlan,
} from "../models.js";
import { normalizeTaskFrame } from "../validation.js";
import { buildDistillationResult, buildTaskFrame } from "./helpers.js";
import { nonEmptyString } from "./json-values.js";

type Awaitable<T> = T | Promise<T>;

export interface TaskFramingStrategyInput {
  rawInput: string | Record<string, unknown>;
  config: EngineConfig;
  scope: Scope;
  hints?: Record<string, string | string[]>;
  forceLlm?: boolean;
}

export interface TaskFramingStrategyResult {
  taskFrame: TaskFrame;
  confidence: number;
  source: "rule" | "llm";
}

export interface TaskFramingStrategy {
  frame(input: TaskFramingStrategyInput): Awaitable<TaskFramingStrategyResult>;
}

export interface DistillationStrategyInput {
  rawInput: string | Record<string, unknown>;
  config: EngineConfig;
  scope?: ScopeInput;
  sourceType: SourceType;
  sourceSessionId?: string;
  sourceTurnRange?: [number, number];
  metadata?: Record<string, string>;
  forceRebuild?: boolean;
}

export interface DistillationStrategy {
  distill(input: DistillationStrategyInput): Awaitable<DistillationResult>;
}

export interface LlmTaskFramingProviderInput {
  rawInput: string | Record<string, unknown>;
  scope: Scope;
  hints?: Record<string, string | string[]>;
}

export interface LlmTaskFramingProvider {
  frame(input: LlmTaskFramingProviderInput): Awaitable<TaskFrame | null>;
}

export interface LlmDistillationProviderInput {
  rawInput: string | Record<string, unknown>;
  config: EngineConfig;
  scope?: ScopeInput;
  sourceType: SourceType;
  sourceSessionId?: string;
  sourceTurnRange?: [number, number];
  metadata?: Record<string, string>;
  forceRebuild?: boolean;
}

export interface LlmDistillationProvider {
  distill(input: LlmDistillationProviderInput): Awaitable<DistillationResult | null>;
}

function estimateTaskFrameConfidence(taskFrame: TaskFrame): number {
  const signals = [
    taskFrame.goals,
    taskFrame.problems,
    taskFrame.scenarioTags,
    taskFrame.constraints,
    taskFrame.entities,
    taskFrame.requiredAtomTypes,
  ];
  const populatedSignals = signals.filter((entry) => entry.length > 0).length;
  return populatedSignals / signals.length;
}

export class RuleBasedTaskFramingStrategy implements TaskFramingStrategy {
  frame(input: TaskFramingStrategyInput): TaskFramingStrategyResult {
    const taskFrame = normalizeTaskFrame(
      buildTaskFrame(input.rawInput, input.config, input.scope, input.hints),
    );
    return {
      taskFrame,
      confidence: estimateTaskFrameConfidence(taskFrame),
      source: "rule",
    };
  }
}

export class RuleBasedDistillationStrategy implements DistillationStrategy {
  distill(input: DistillationStrategyInput): DistillationResult {
    return buildDistillationResult({
      rawInput: input.rawInput,
      config: input.config,
      scopeInput: input.scope,
      sourceType: input.sourceType,
      sourceSessionId: input.sourceSessionId,
      sourceTurnRange: input.sourceTurnRange,
      metadata: input.metadata,
    });
  }
}

export interface LlmFallbackTaskFramingStrategyOptions {
  llmProvider?: LlmTaskFramingProvider;
  minRuleConfidence?: number;
}

export class LlmFallbackTaskFramingStrategy implements TaskFramingStrategy {
  private readonly minRuleConfidence: number;
  private readonly ruleStrategy: RuleBasedTaskFramingStrategy;
  private readonly llmProvider?: LlmTaskFramingProvider;

  constructor(options?: LlmFallbackTaskFramingStrategyOptions) {
    this.minRuleConfidence = options?.minRuleConfidence ?? 0.5;
    this.llmProvider = options?.llmProvider;
    this.ruleStrategy = new RuleBasedTaskFramingStrategy();
  }

  async frame(input: TaskFramingStrategyInput): Promise<TaskFramingStrategyResult> {
    const ruleResult = this.ruleStrategy.frame(input);
    const shouldTryLlm =
      Boolean(this.llmProvider) &&
      (input.forceLlm === true || ruleResult.confidence < this.minRuleConfidence);
    if (!shouldTryLlm) {
      return ruleResult;
    }

    const llmTaskFrame = await this.llmProvider!.frame({
      rawInput: input.rawInput,
      scope: input.scope,
      hints: input.hints,
    });
    if (!llmTaskFrame) {
      return ruleResult;
    }

    const normalizedLlmTaskFrame = normalizeTaskFrame(llmTaskFrame);
    return {
      taskFrame: normalizedLlmTaskFrame,
      confidence: Math.max(
        ruleResult.confidence,
        estimateTaskFrameConfidence(normalizedLlmTaskFrame),
      ),
      source: "llm",
    };
  }
}

export interface LlmFallbackDistillationStrategyOptions {
  llmProvider?: LlmDistillationProvider;
}

function hasFilledKeys(result: DistillationResult): boolean {
  return (
    nonEmptyString(result.keys.ingestionChecksum) &&
    nonEmptyString(result.keys.eventKey) &&
    result.keys.atomDedupKeys.every((entry) => nonEmptyString(entry)) &&
    result.keys.entityKeys.every((entry) => nonEmptyString(entry)) &&
    result.keys.scenarioKeys.every((entry) => nonEmptyString(entry)) &&
    result.keys.problemKeys.every((entry) => nonEmptyString(entry))
  );
}

function hasStructuredAtoms(atoms: MemoryAtom[]): boolean {
  if (atoms.length === 0) {
    return false;
  }
  return atoms.every(
    (atom) =>
      nonEmptyString(atom.claim.statement) &&
      (atom.trigger.conditions.length > 0 || atom.trigger.contextTags.length > 0) &&
      nonEmptyString(atom.dedupKey),
  );
}

function normalizeWritePlan(result: DistillationResult): WritePlan {
  return {
    canonicalObjectTypes: result.writePlan.canonicalObjectTypes.length
      ? result.writePlan.canonicalObjectTypes
      : ["EventSkeleton", "MemoryAtom", "Entity", "Scenario", "Problem", "Evidence"],
    relationIds: result.relations.map((relation) => relation.id),
    graphNodeIds: [
      result.event.id,
      ...result.atoms.map((atom) => atom.id),
      ...result.entities.map((entity) => entity.id),
      ...result.scenarios.map((scenario) => scenario.id),
      ...result.problems.map((problem) => problem.id),
      ...result.evidence.map((record) => record.id),
    ],
    graphEdgeIds: result.relations.map((relation) => relation.id),
    vectorDocumentIds: [
      result.event.id,
      ...result.atoms.map((atom) => atom.id),
      ...result.entities.map((entity) => entity.id),
    ],
  };
}

function remapToEventId(sourceEventIds: string[], eventId: string): string[] {
  return sourceEventIds.length === 0 ? [eventId] : sourceEventIds.map(() => eventId);
}

function blendEvent(base: EventSkeleton, llm: EventSkeleton): EventSkeleton {
  return {
    ...base,
    ...llm,
    goal: nonEmptyString(llm.goal) ? llm.goal : base.goal,
    context: nonEmptyString(llm.context) ? llm.context : base.context,
    constraints: llm.constraints.length > 0 ? llm.constraints : base.constraints,
    decisions: llm.decisions.length > 0 ? llm.decisions : base.decisions,
    turningPoints: llm.turningPoints.length > 0 ? llm.turningPoints : base.turningPoints,
    outcome: nonEmptyString(llm.outcome) ? llm.outcome : base.outcome,
    evidenceRefs: llm.evidenceRefs.length > 0 ? llm.evidenceRefs : base.evidenceRefs,
  };
}

function buildStagedDistillation(
  base: DistillationResult,
  llm: DistillationResult,
): DistillationResult {
  const eventFromLlm =
    nonEmptyString(llm.event.goal) ||
    nonEmptyString(llm.event.context) ||
    llm.event.constraints.length > 0 ||
    llm.event.decisions.length > 0 ||
    llm.event.turningPoints.length > 0 ||
    nonEmptyString(llm.event.outcome);
  const contextFromLlm =
    llm.entities.length > 0 || llm.scenarios.length > 0 || llm.problems.length > 0;
  const atomsFromLlm = hasStructuredAtoms(llm.atoms);
  const relationsFromLlm = llm.relations.length > 0;

  const event = blendEvent(base.event, llm.event);
  const selectedAtoms = atomsFromLlm ? llm.atoms : base.atoms;
  const selectedEntities = llm.entities.length > 0 ? llm.entities : base.entities;
  const selectedScenarios = llm.scenarios.length > 0 ? llm.scenarios : base.scenarios;
  const selectedProblems = llm.problems.length > 0 ? llm.problems : base.problems;
  const selectedRelations = llm.relations.length > 0 ? llm.relations : base.relations;
  const selectedEvidence = llm.evidence.length > 0 ? llm.evidence : base.evidence;

  const atoms = selectedAtoms.map((atom) => ({
    ...atom,
    provenance: {
      ...atom.provenance,
      sourceEventIds: remapToEventId(atom.provenance.sourceEventIds, event.id),
      evidenceRefs: selectedEvidence.map((record) => record.id),
    },
  }));
  const entities = selectedEntities.map((entity) => ({
    ...entity,
    provenance: {
      ...entity.provenance,
      sourceEventIds: remapToEventId(entity.provenance.sourceEventIds, event.id),
      evidenceRefs: selectedEvidence.map((record) => record.id),
    },
  }));
  const scenarios = selectedScenarios.map((scenario) => ({
    ...scenario,
    provenance: {
      ...scenario.provenance,
      sourceEventIds: remapToEventId(scenario.provenance.sourceEventIds, event.id),
      evidenceRefs: selectedEvidence.map((record) => record.id),
    },
  }));
  const problems = selectedProblems.map((problem) => ({
    ...problem,
    provenance: {
      ...problem.provenance,
      sourceEventIds: remapToEventId(problem.provenance.sourceEventIds, event.id),
      evidenceRefs: selectedEvidence.map((record) => record.id),
    },
  }));
  const relations = selectedRelations.map((relation) => ({
    ...relation,
    provenance: {
      ...relation.provenance,
      sourceEventIds: remapToEventId(relation.provenance.sourceEventIds, event.id),
      evidenceRefs: selectedEvidence.map((record) => record.id),
    },
  }));

  const blended: DistillationResult = {
    ...base,
    ...llm,
    event: {
      ...event,
      linkedAtoms: atoms.map((atom) => atom.id),
      evidenceRefs: selectedEvidence.map((record) => record.id),
    },
    atoms,
    entities,
    scenarios,
    problems,
    relations,
    evidence: selectedEvidence,
    keys: hasFilledKeys(llm) ? llm.keys : base.keys,
    writePlan: llm.writePlan.graphNodeIds.length > 0 ? llm.writePlan : base.writePlan,
    quality: buildLlmBlendQuality(base.quality, llm.quality, {
      eventFromLlm,
      contextFromLlm,
      atomsFromLlm,
      relationsFromLlm,
    }),
  };
  return {
    ...blended,
    writePlan: normalizeWritePlan(blended),
  };
}

function coverageFromDecisions(decisions: DistillationQuality["stageDecisions"]): number {
  if (decisions.length === 0) {
    return 0;
  }
  const respondedCount = decisions.filter((decision) => decision.llmResponded).length;
  return respondedCount / decisions.length;
}

function fallbackFromDecisions(decisions: DistillationQuality["stageDecisions"]): number {
  if (decisions.length === 0) {
    return 0;
  }
  const fallbackCount = decisions.filter((decision) => decision.fallbackToRule).length;
  return fallbackCount / decisions.length;
}

function buildLlmBlendQuality(
  baseQuality: DistillationQuality,
  llmQuality: DistillationQuality,
  stagesFromLlm: {
    eventFromLlm: boolean;
    contextFromLlm: boolean;
    atomsFromLlm: boolean;
    relationsFromLlm: boolean;
  },
): DistillationQuality {
  const incomingStageDecisions =
    llmQuality.stageDecisions.length > 0
      ? llmQuality.stageDecisions
      : [
          {
            stage: "event",
            llmResponded: true,
            usedLlmOutput: false,
            fallbackToRule: false,
          },
          {
            stage: "context",
            llmResponded: true,
            usedLlmOutput: false,
            fallbackToRule: false,
          },
          {
            stage: "atoms",
            llmResponded: true,
            usedLlmOutput: false,
            fallbackToRule: false,
          },
          {
            stage: "relations",
            llmResponded: true,
            usedLlmOutput: false,
            fallbackToRule: false,
          },
        ];

  const stageDecisions = incomingStageDecisions.map((decision) => {
    let usedLlmOutput = decision.usedLlmOutput;
    if (!decision.llmResponded) {
      usedLlmOutput = false;
    } else if (decision.stage === "event") {
      usedLlmOutput = decision.usedLlmOutput || stagesFromLlm.eventFromLlm;
    } else if (decision.stage === "context") {
      usedLlmOutput = decision.usedLlmOutput || stagesFromLlm.contextFromLlm;
    } else if (decision.stage === "atoms") {
      // Atom stage remains strict because malformed atom output can pollute long-term memory.
      usedLlmOutput = decision.usedLlmOutput && stagesFromLlm.atomsFromLlm;
    } else if (decision.stage === "relations") {
      usedLlmOutput = decision.usedLlmOutput || stagesFromLlm.relationsFromLlm;
    }
    return {
      stage: decision.stage,
      llmResponded: decision.llmResponded,
      usedLlmOutput,
      fallbackToRule: !usedLlmOutput,
    };
  });

  return {
    profile:
      llmQuality.profile === "llm_multi_call" || llmQuality.profile === "llm_single_call"
        ? llmQuality.profile
        : baseQuality.profile,
    stageCoverage: coverageFromDecisions(stageDecisions),
    stageFallbackRate: fallbackFromDecisions(stageDecisions),
    stageDecisions,
  };
}

export class LlmFallbackDistillationStrategy implements DistillationStrategy {
  private readonly ruleStrategy: RuleBasedDistillationStrategy;
  private readonly llmProvider?: LlmDistillationProvider;

  constructor(options?: LlmFallbackDistillationStrategyOptions) {
    this.llmProvider = options?.llmProvider;
    this.ruleStrategy = new RuleBasedDistillationStrategy();
  }

  async distill(input: DistillationStrategyInput): Promise<DistillationResult> {
    const ruleResult = this.ruleStrategy.distill(input);
    if (!this.llmProvider) {
      return ruleResult;
    }

    const llmResult = await this.llmProvider.distill({
      rawInput: input.rawInput,
      config: input.config,
      scope: input.scope,
      sourceType: input.sourceType,
      sourceSessionId: input.sourceSessionId,
      sourceTurnRange: input.sourceTurnRange,
      metadata: input.metadata,
      forceRebuild: input.forceRebuild,
    });
    if (!llmResult) {
      return ruleResult;
    }

    return buildStagedDistillation(ruleResult, llmResult);
  }
}

export interface DefaultTaskFramingStrategyOptions {
  llmProvider?: LlmTaskFramingProvider;
  minRuleConfidence?: number;
}

export function createDefaultTaskFramingStrategy(
  options?: DefaultTaskFramingStrategyOptions,
): TaskFramingStrategy {
  if (options?.llmProvider) {
    return new LlmFallbackTaskFramingStrategy({
      llmProvider: options.llmProvider,
      minRuleConfidence: options.minRuleConfidence,
    });
  }
  return new RuleBasedTaskFramingStrategy();
}

export interface DefaultDistillationStrategyOptions {
  llmProvider?: LlmDistillationProvider;
}

export function createDefaultDistillationStrategy(
  options?: DefaultDistillationStrategyOptions,
): DistillationStrategy {
  if (options?.llmProvider) {
    return new LlmFallbackDistillationStrategy({
      llmProvider: options.llmProvider,
    });
  }
  return new RuleBasedDistillationStrategy();
}
