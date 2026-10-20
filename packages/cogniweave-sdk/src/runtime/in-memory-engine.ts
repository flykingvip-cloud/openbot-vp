import { createHash } from "node:crypto";
import { createAdapterBundle } from "../adapters/factory.js";
import type {
  AtomHybridHit,
  AtomQueryHit,
  CogniWeaveEngine,
  CompactJournalsOptions,
  CompactJournalsResult,
  IngestInput,
  IngestResult,
  QueryAtomsHybridOptions,
  QueryAtomsOptions,
  ReasonOptions,
  RecoverFromCanonicalOptions,
  RecoverFromCanonicalResult,
  ResolveEvidenceOptions,
  SearchEvidenceOptions,
  TraceOptions,
} from "../contracts.js";
import { withAtomV2Defaults } from "../domain/atom-v2.js";
import { IdempotencyConflictError, ScopeViolationError } from "../errors.js";
import {
  repairDerivedIndexes as repairJournalDerivedIndexes,
  rebuildFromTruth as rebuildDerivedFromTruth,
} from "../journal/repair.js";
import {
  computeDedupKey,
  computeEventKey,
  computeIngestionChecksum,
  computeWriteOperationKey,
  createMemoryPartitionKeyV1,
  resolveSourceLocatorForOperationKey,
} from "../keys.js";
import type {
  AtomUpsertDecision,
  CognitivePackage,
  DistillationResult,
  DroppedPath,
  EngineConfig,
  EntityRecord,
  EvidenceRecord,
  EvidenceSearchResult,
  EventSkeleton,
  AuthorizeMemoryAccessResult,
  MemoryAtom,
  MemorySubject,
  MemoryTrace,
  NodeType,
  PackageRiskMarker,
  ProblemRecord,
  RelationRecord,
  RelationType,
  ReasonDebugPayload,
  ReasoningPath,
  ScenarioRecord,
  Scope,
  ScopeInput,
  SourceBinding,
  SourceLifecycleInput,
  SourceLifecycleMode,
  SourceLifecycleReceipt,
  SourceLifecycleSelector,
  SourceObjectLink,
  SourceObjectType,
  TaskFrame,
  TracePackageResult,
  TraceReasoningSessionResult,
  WriteBackResult,
  WriteJournal,
} from "../models.js";
import {
  applyRelationBoost,
  mergeHybridScores,
  rerankHybridHits,
  scoreAtomLexical,
} from "../retrieval/hybrid.js";
import { isAtomRetrievable } from "../retrieval/lifecycle-gate.js";
import { matchesScope, resolveScope } from "../scope.js";
import type { GraphStore, MetadataStore, VectorStore } from "../storage/types.js";
import { authorizeMemoryAccess, createMemorySubjectBinding } from "../subject/binding.js";
import { attachDedupKey, normalizeTaskFrame, validateTaskFrame } from "../validation.js";
import { buildPackageAnswer, computeTaskOverlap, createId } from "./helpers.js";
import { createHttpDistillationProvider, createHttpTaskFramingProvider } from "./llm-provider.js";
import {
  createDefaultDistillationStrategy,
  createDefaultTaskFramingStrategy,
  type DistillationStrategy,
  type TaskFramingStrategy,
} from "./strategies.js";
import {
  DEFAULT_TEMPLATE_REGISTRY,
  resolveTemplateRelation,
  type PathTemplate,
  type TemplateRegistry,
} from "./templates.js";

function mergeDistinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function tokenizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 || /[\u4e00-\u9fff]/.test(token));
}

function scoreEvidenceSearchResult(params: {
  evidence: EvidenceRecord;
  query: string;
}): EvidenceSearchResult | null {
  const tokens = mergeDistinct(tokenizeSearchQuery(params.query));
  if (tokens.length === 0) {
    return null;
  }

  const haystack = [params.evidence.uri, params.evidence.type, params.evidence.snippet]
    .join("\n")
    .toLowerCase();
  const matchedTokens = tokens.filter((token) => haystack.includes(token));
  const normalizedQuery = params.query.trim().toLowerCase();
  const exactPhraseMatch = normalizedQuery.length >= 4 && haystack.includes(normalizedQuery);
  const minimumTokenMatches = tokens.length === 1 ? 1 : 2;
  if (!exactPhraseMatch && matchedTokens.length < minimumTokenMatches) {
    return null;
  }

  const coverage = matchedTokens.length / tokens.length;
  if (!exactPhraseMatch && coverage < 0.35) {
    return null;
  }

  return {
    evidence: params.evidence,
    score: Math.min(0.99, 0.58 + coverage * 0.32 + (exactPhraseMatch ? 0.09 : 0)),
    matchedTokens,
    exactPhraseMatch,
  };
}

function stableRelationId(
  relation: Pick<
    RelationRecord,
    "relationType" | "fromId" | "fromNodeType" | "toId" | "toNodeType" | "scope"
  >,
): string {
  const payload = [
    relation.scope.workspaceId,
    relation.scope.projectId,
    relation.scope.agentId,
    relation.scope.visibility,
    relation.fromNodeType,
    relation.fromId,
    relation.relationType,
    relation.toNodeType,
    relation.toId,
  ].join("|");
  return `rel_${createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;
}

function mergeAtoms(existing: MemoryAtom, incoming: MemoryAtom): MemoryAtom {
  return withAtomV2Defaults({
    ...existing,
    applicability: {
      include: mergeDistinct([
        ...existing.applicability.include,
        ...incoming.applicability.include,
      ]),
      exclude: mergeDistinct([
        ...existing.applicability.exclude,
        ...incoming.applicability.exclude,
      ]),
    },
    provenance: {
      sourceEventIds: mergeDistinct([
        ...existing.provenance.sourceEventIds,
        ...incoming.provenance.sourceEventIds,
      ]),
      evidenceRefs: mergeDistinct([
        ...existing.provenance.evidenceRefs,
        ...incoming.provenance.evidenceRefs,
      ]),
    },
    metrics: {
      confidence: Math.min(
        1,
        Math.max(existing.metrics.confidence, incoming.metrics.confidence) + 0.05,
      ),
      reuseCount: existing.metrics.reuseCount,
    },
    privacy: incoming.privacy ?? existing.privacy,
    lifecycle: {
      ...existing.lifecycle,
      ...incoming.lifecycle,
    },
    governance: {
      ...existing.governance,
      ...incoming.governance,
    },
  });
}

function isMergeCompatible(existing: MemoryAtom, incoming: MemoryAtom): boolean {
  const existingAction = JSON.stringify(existing.action ?? {});
  const incomingAction = JSON.stringify(incoming.action ?? {});
  const includeOverlap =
    incoming.applicability.include.length === 0 ||
    existing.applicability.include.length === 0 ||
    incoming.applicability.include.some((value) => existing.applicability.include.includes(value));
  const excludeConflict = incoming.applicability.exclude.some((value) =>
    existing.applicability.include.includes(value),
  );

  if (existingAction !== incomingAction) {
    return false;
  }
  if (!includeOverlap) {
    return false;
  }
  if (excludeConflict) {
    return false;
  }
  if (
    ["policy", "preference", "constraint"].includes(existing.atomType) &&
    existing.claim.statement !== incoming.claim.statement
  ) {
    return false;
  }
  return true;
}

function remapIds(values: string[], idMap: Map<string, string>): string[] {
  return mergeDistinct(values.map((value) => idMap.get(value) ?? value));
}

function cloneTaskFrame(taskFrame: TaskFrame): TaskFrame {
  return {
    ...taskFrame,
    scope: { ...taskFrame.scope },
    goals: [...taskFrame.goals],
    problems: [...taskFrame.problems],
    scenarioTags: [...taskFrame.scenarioTags],
    constraints: [...taskFrame.constraints],
    entities: [...taskFrame.entities],
    requiredAtomTypes: [...taskFrame.requiredAtomTypes],
    provenance: taskFrame.provenance
      ? {
          ...taskFrame.provenance,
          sourceTurnRange: taskFrame.provenance.sourceTurnRange
            ? ([...taskFrame.provenance.sourceTurnRange] as [number, number])
            : undefined,
          hintsApplied: [...(taskFrame.provenance.hintsApplied ?? [])],
        }
      : undefined,
  };
}

function appendTaskFrameHint(taskFrame: TaskFrame, hint: string): TaskFrame {
  const existing = taskFrame.provenance?.hintsApplied ?? [];
  return {
    ...taskFrame,
    provenance: {
      ...(taskFrame.provenance ?? {}),
      hintsApplied: mergeDistinct([...existing, hint]),
    },
  };
}

function buildTaskFrameCacheKey(
  rawInput: string | Record<string, unknown>,
  scope: Scope,
  hints?: Record<string, string | string[]>,
): string {
  return computeIngestionChecksum({
    rawInput,
    scope,
    hints: hints ?? {},
  });
}

function resolveReadScopeOrThrow(
  scopeInput: ScopeInput | undefined,
  config: EngineConfig,
  subject: string,
): Scope {
  if (!scopeInput) {
    throw new ScopeViolationError(`${subject} requires explicit scope`);
  }
  return resolveScope(scopeInput, config);
}

function assertScopeAccess(target: Scope, requested: Scope, subject: string): void {
  if (!matchesScope(target, requested)) {
    throw new ScopeViolationError(`${subject} scope violation`);
  }
}

interface ScoredAtom {
  atom: MemoryAtom;
  score: number;
}

interface PathExpansionContext {
  taskFrame: TaskFrame;
  template: PathTemplate;
  atomsById: Map<string, MemoryAtom>;
  relationById: Map<string, RelationRecord>;
  relations: RelationRecord[];
}

interface PathExpansionResult {
  path: ReasoningPath;
  droppedReason?: string;
}

interface TemplatePathState {
  nodeIds: string[];
  relationChain: RelationType[];
  relationIds: string[];
  currentNodeId: string;
  currentNodeType: NodeType;
}

const TEMPLATE_BRANCH_LIMIT = 3;

function computePathScore(
  taskFrame: TaskFrame,
  pathAtomNodes: MemoryAtom[],
  pathRelations: RelationRecord[],
): number {
  const semanticMatch =
    pathAtomNodes.length === 0
      ? 0
      : pathAtomNodes.reduce((sum, atom) => sum + computeTaskOverlap(taskFrame, atom), 0) /
        pathAtomNodes.length;
  const relationStrength =
    pathRelations.length === 0
      ? 0.5
      : pathRelations.reduce((sum, relation) => sum + relation.confidence, 0) /
        pathRelations.length;
  const confidence =
    pathAtomNodes.length === 0
      ? 0
      : pathAtomNodes.reduce((sum, atom) => sum + atom.metrics.confidence, 0) /
        pathAtomNodes.length;
  const taskFit = pathAtomNodes.length === 0 ? 0 : computeTaskOverlap(taskFrame, pathAtomNodes[0]!);
  const reuseScore =
    pathAtomNodes.length === 0
      ? 0
      : pathAtomNodes.reduce((sum, atom) => sum + Math.min(1, atom.metrics.reuseCount / 10), 0) /
        pathAtomNodes.length;
  const conflictPenalty = pathAtomNodes.reduce((penalty, atom) => {
    if (atom.state.status === "conflicted") {
      return penalty + 0.25;
    }
    if (atom.state.status === "tentative") {
      return penalty + 0.1;
    }
    return penalty;
  }, 0);

  const score =
    0.3 * semanticMatch +
    0.2 * relationStrength +
    0.2 * confidence +
    0.2 * taskFit +
    0.1 * reuseScore -
    conflictPenalty;
  return Math.max(0, Math.min(1, score));
}

function selectLatestAtoms(atoms: MemoryAtom[]): MemoryAtom[] {
  const supersededIds = new Set(
    atoms
      .map((atom) => atom.versioning.parentVersion)
      .filter((parentVersion): parentVersion is string => Boolean(parentVersion)),
  );
  return atoms.filter((atom) => !supersededIds.has(atom.id));
}

function expandTemplatePaths(
  seed: ScoredAtom,
  context: PathExpansionContext,
): PathExpansionResult[] {
  let states: TemplatePathState[] = [
    {
      nodeIds: [seed.atom.id],
      relationChain: [],
      relationIds: [],
      currentNodeId: seed.atom.id,
      currentNodeType: "MemoryAtom",
    },
  ];
  const dropped: PathExpansionResult[] = [];

  for (const [index, step] of context.template.steps.entries()) {
    const nextStates: TemplatePathState[] = [];

    for (const state of states) {
      const relationConfig = resolveTemplateRelation(step.relation);
      const candidates = context.relations
        .filter((relation) => relation.status === "active")
        .filter((relation) => relation.relationType === relationConfig.relationType)
        .flatMap((relation) => {
          if (!relationConfig.reverse) {
            if (
              relation.fromId !== state.currentNodeId ||
              relation.fromNodeType !== state.currentNodeType
            ) {
              return [];
            }
            return [
              {
                relation,
                nextId: relation.toId,
                nextNodeType: relation.toNodeType,
              },
            ];
          }
          if (
            relation.toId !== state.currentNodeId ||
            relation.toNodeType !== state.currentNodeType
          ) {
            return [];
          }
          return [
            {
              relation,
              nextId: relation.fromId,
              nextNodeType: relation.fromNodeType,
            },
          ];
        })
        .filter((candidate) => step.nextNodeTypes.includes(candidate.nextNodeType))
        .filter((candidate) => {
          if (!step.nextAtomTypes || candidate.nextNodeType !== "MemoryAtom") {
            return true;
          }
          const nextAtom = context.atomsById.get(candidate.nextId);
          return Boolean(nextAtom && step.nextAtomTypes.includes(nextAtom.atomType));
        })
        .filter((candidate) => !state.nodeIds.includes(candidate.nextId));

      if (candidates.length === 0) {
        if (step.optional) {
          nextStates.push(state);
          continue;
        }
        dropped.push({
          path: {
            pathId: `path_${seed.atom.id}_${index + 1}`,
            nodeIds: state.nodeIds,
            relationChain: state.relationChain,
            score: seed.score,
            summary: seed.atom.claim.statement,
          },
          droppedReason: `template_step_${index + 1}_no_match`,
        });
        continue;
      }

      const ranked = candidates
        .map((candidate) => {
          const nextAtom =
            candidate.nextNodeType === "MemoryAtom"
              ? context.atomsById.get(candidate.nextId)
              : undefined;
          const overlap = nextAtom ? computeTaskOverlap(context.taskFrame, nextAtom) : 0.25;
          return {
            ...candidate,
            rank: overlap * 0.7 + candidate.relation.confidence * 0.3,
          };
        })
        .sort((a, b) => b.rank - a.rank)
        .slice(0, TEMPLATE_BRANCH_LIMIT);

      for (const candidate of ranked) {
        nextStates.push({
          nodeIds: [...state.nodeIds, candidate.nextId],
          relationChain: [...state.relationChain, candidate.relation.relationType],
          relationIds: [...state.relationIds, candidate.relation.id],
          currentNodeId: candidate.nextId,
          currentNodeType: candidate.nextNodeType,
        });
      }
    }

    if (nextStates.length === 0) {
      return dropped;
    }
    states = nextStates;
  }

  const expanded: PathExpansionResult[] = states.map((state, index) => {
    const pathAtomNodes = mergeDistinct(state.nodeIds)
      .map((nodeId) => context.atomsById.get(nodeId))
      .filter((atom): atom is MemoryAtom => Boolean(atom));
    const pathRelations = state.relationIds
      .map((relationId) => context.relationById.get(relationId))
      .filter((relation): relation is RelationRecord => Boolean(relation));
    return {
      path: {
        pathId: `path_${seed.atom.id}_${index + 1}`,
        nodeIds: state.nodeIds,
        relationChain: state.relationChain,
        score: computePathScore(context.taskFrame, pathAtomNodes, pathRelations),
        summary: pathAtomNodes[0]?.claim.statement ?? seed.atom.claim.statement,
      },
    };
  });

  return [...expanded, ...dropped];
}

function canonicalizeDistillation(
  distillation: DistillationResult,
  options: { eventId?: string; atomIdMap?: Map<string, string> },
): DistillationResult {
  const eventId = options.eventId ?? distillation.event.id;
  const atomIdMap = options.atomIdMap ?? new Map<string, string>();

  const atoms = distillation.atoms.map((atom) => ({
    ...atom,
    id: atomIdMap.get(atom.id) ?? atom.id,
    provenance: {
      ...atom.provenance,
      sourceEventIds: remapIds(
        atom.provenance.sourceEventIds,
        new Map([[distillation.event.id, eventId]]),
      ),
    },
  }));

  const event: EventSkeleton = {
    ...distillation.event,
    id: eventId,
    linkedAtoms: remapIds(distillation.event.linkedAtoms, atomIdMap),
  };

  const remapNodeId = (nodeType: string, nodeId: string): string => {
    if (nodeType === "EventSkeleton") {
      return eventId;
    }
    if (nodeType === "MemoryAtom") {
      return atomIdMap.get(nodeId) ?? nodeId;
    }
    return nodeId;
  };

  const relations = [
    ...distillation.relations
      .map((relation) => {
        const fromId = remapNodeId(relation.fromNodeType, relation.fromId);
        const toId = remapNodeId(relation.toNodeType, relation.toId);
        const canonicalRelation: RelationRecord = {
          ...relation,
          id: stableRelationId({
            relationType: relation.relationType,
            fromId,
            fromNodeType: relation.fromNodeType,
            toId,
            toNodeType: relation.toNodeType,
            scope: relation.scope,
          }),
          fromId,
          toId,
          provenance: {
            ...relation.provenance,
            sourceEventIds: remapIds(
              relation.provenance.sourceEventIds,
              new Map([[distillation.event.id, eventId]]),
            ),
          },
        };
        return canonicalRelation;
      })
      .reduce((acc, relation) => acc.set(relation.id, relation), new Map<string, RelationRecord>())
      .values(),
  ];

  const entities = distillation.entities.map((entity) => ({
    ...entity,
    provenance: {
      ...entity.provenance,
      sourceEventIds: remapIds(
        entity.provenance.sourceEventIds,
        new Map([[distillation.event.id, eventId]]),
      ),
    },
  }));
  const scenarios = distillation.scenarios.map((scenario) => ({
    ...scenario,
    provenance: {
      ...scenario.provenance,
      sourceEventIds: remapIds(
        scenario.provenance.sourceEventIds,
        new Map([[distillation.event.id, eventId]]),
      ),
    },
  }));
  const problems = distillation.problems.map((problem) => ({
    ...problem,
    provenance: {
      ...problem.provenance,
      sourceEventIds: remapIds(
        problem.provenance.sourceEventIds,
        new Map([[distillation.event.id, eventId]]),
      ),
    },
  }));

  return {
    ...distillation,
    event,
    atoms,
    entities,
    scenarios,
    problems,
    relations,
    writePlan: {
      ...distillation.writePlan,
      relationIds: relations.map((relation) => relation.id),
      graphNodeIds: [
        event.id,
        ...atoms.map((atom) => atom.id),
        ...entities.map((entity) => entity.id),
        ...scenarios.map((scenario) => scenario.id),
        ...problems.map((problem) => problem.id),
        ...distillation.evidence.map((item) => item.id),
      ],
      graphEdgeIds: relations.map((relation) => relation.id),
      vectorDocumentIds: [
        event.id,
        ...atoms.map((atom) => atom.id),
        ...entities.map((entity) => entity.id),
      ],
    },
  };
}

function assertCanonicalScopeHierarchy(distillation: DistillationResult): void {
  const eventScope = distillation.event.scope;
  for (const atom of distillation.atoms) {
    assertScopeAccess(atom.scope, eventScope, "writeBack.atom");
  }
  for (const evidence of distillation.evidence) {
    assertScopeAccess(evidence.scope, eventScope, "writeBack.evidence");
  }
  for (const entity of distillation.entities) {
    assertScopeAccess(entity.scope, eventScope, "writeBack.entity");
  }
  for (const scenario of distillation.scenarios) {
    assertScopeAccess(scenario.scope, eventScope, "writeBack.scenario");
  }
  for (const problem of distillation.problems) {
    assertScopeAccess(problem.scope, eventScope, "writeBack.problem");
  }
  for (const relation of distillation.relations) {
    assertScopeAccess(relation.scope, eventScope, "writeBack.relation");
  }
}

export class InMemoryCogniWeaveEngine implements CogniWeaveEngine {
  readonly config: EngineConfig;

  private readonly metadataStore: MetadataStore;
  private readonly graphStore: GraphStore;
  private readonly vectorStore: VectorStore;
  private readonly packages = new Map<string, CognitivePackage>();
  private readonly packageTraces = new Map<string, TracePackageResult>();
  private readonly reasoningSessions = new Map<string, TraceReasoningSessionResult>();
  private readonly taskFrameCache = new Map<string, TaskFrame>();
  private readonly taskFramingStrategy: TaskFramingStrategy;
  private readonly distillationStrategy: DistillationStrategy;
  private readonly templateRegistry: TemplateRegistry;
  /** In-memory source lifecycle registry (bindings + links + idempotent receipts). */
  private readonly sourceBindings = new Map<string, SourceBinding>();
  private readonly sourceBindingsByIdentity = new Map<string, string>();
  private readonly sourceBindingsByLocator = new Map<string, string>();
  private readonly sourceObjectLinks = new Map<string, SourceObjectLink>();
  private readonly sourceLifecycleReceipts = new Map<string, SourceLifecycleReceipt>();
  private sourceLifecycleHydratePromise: Promise<void> | null = null;

  constructor(
    config: EngineConfig,
    stores?: {
      metadataStore?: MetadataStore;
      graphStore?: GraphStore;
      vectorStore?: VectorStore;
      taskFramingStrategy?: TaskFramingStrategy;
      distillationStrategy?: DistillationStrategy;
      templateRegistry?: TemplateRegistry;
    },
  ) {
    this.config = config;
    const defaults = createAdapterBundle(config);
    const llmTaskFramingProvider = createHttpTaskFramingProvider(config);
    const llmDistillationProvider = createHttpDistillationProvider(config);
    this.metadataStore = stores?.metadataStore ?? defaults.metadataStore;
    this.graphStore = stores?.graphStore ?? defaults.graphStore;
    this.vectorStore = stores?.vectorStore ?? defaults.vectorStore;
    this.taskFramingStrategy =
      stores?.taskFramingStrategy ??
      createDefaultTaskFramingStrategy({
        llmProvider: llmTaskFramingProvider,
      });
    this.distillationStrategy =
      stores?.distillationStrategy ??
      createDefaultDistillationStrategy({
        llmProvider: llmDistillationProvider,
      });
    this.templateRegistry = stores?.templateRegistry ?? DEFAULT_TEMPLATE_REGISTRY;
    // Kick hydrate early so first search/lifecycle sees durable bindings.
    void this.ensureSourceLifecycleHydrated();
  }

  private ensureSourceLifecycleHydrated(): Promise<void> {
    if (!this.sourceLifecycleHydratePromise) {
      this.sourceLifecycleHydratePromise = this.hydrateSourceLifecycleFromStore();
    }
    return this.sourceLifecycleHydratePromise;
  }

  private async hydrateSourceLifecycleFromStore(): Promise<void> {
    const list = this.metadataStore.listSourceBindings;
    if (typeof list === "function") {
      const bindings = await list.call(this.metadataStore);
      for (const binding of bindings) {
        this.sourceBindings.set(binding.id, binding);
        this.sourceBindingsByIdentity.set(binding.sourceIdentityId, binding.id);
        this.sourceBindingsByLocator.set(binding.sourceLocator, binding.id);
      }
    }
    const listLinks = this.metadataStore.listSourceObjectLinks;
    if (typeof listLinks === "function") {
      const links = await listLinks.call(this.metadataStore);
      for (const link of links) {
        this.sourceObjectLinks.set(link.id, link);
      }
    }
  }

  private async persistSourceBinding(binding: SourceBinding): Promise<void> {
    if (typeof this.metadataStore.saveSourceBinding === "function") {
      await this.metadataStore.saveSourceBinding(binding);
    }
  }

  private async persistSourceObjectLink(link: SourceObjectLink): Promise<void> {
    this.sourceObjectLinks.set(link.id, link);
    if (typeof this.metadataStore.saveSourceObjectLink === "function") {
      await this.metadataStore.saveSourceObjectLink(link);
    }
  }

  private makeSourceObjectLinkId(
    sourceBindingId: string,
    objectType: SourceObjectType,
    objectId: string,
  ): string {
    return `sol_${createHash("sha256")
      .update(`${sourceBindingId}\0${objectType}\0${objectId}`)
      .digest("hex")
      .slice(0, 20)}`;
  }

  private liveSourceObjectLinks(filter: {
    sourceBindingId?: string;
    objectType?: SourceObjectType;
    objectId?: string;
  }): SourceObjectLink[] {
    return [...this.sourceObjectLinks.values()].filter((link) => {
      if (link.unlinkedAt) {
        return false;
      }
      if (filter.sourceBindingId && link.sourceBindingId !== filter.sourceBindingId) {
        return false;
      }
      if (filter.objectType && link.objectType !== filter.objectType) {
        return false;
      }
      if (filter.objectId && link.objectId !== filter.objectId) {
        return false;
      }
      return true;
    });
  }

  /** Backfill evidence↔binding links from URI/locator match (lazy, idempotent). */
  private async ensureEvidenceLinksForBinding(binding: SourceBinding): Promise<void> {
    const evidence = await this.metadataStore.listEvidence();
    const now = new Date().toISOString();
    for (const item of evidence) {
      if (!this.evidenceMatchesBinding(item, binding)) {
        continue;
      }
      const id = this.makeSourceObjectLinkId(binding.id, "evidence", item.id);
      if (this.sourceObjectLinks.has(id)) {
        continue;
      }
      await this.persistSourceObjectLink({
        id,
        sourceBindingId: binding.id,
        objectType: "evidence",
        objectId: item.id,
        linkRole: "primary_evidence",
        createdAt: now,
      });
    }
  }

  /**
   * Backfill atom↔binding links when atom provenance references evidence that
   * matches (or is already linked to) this binding.
   */
  private async ensureAtomLinksForBinding(binding: SourceBinding): Promise<void> {
    const atoms = await this.metadataStore.listAtoms();
    const now = new Date().toISOString();
    const linkedEvidenceIds = new Set(
      this.liveSourceObjectLinks({
        sourceBindingId: binding.id,
        objectType: "evidence",
      }).map((link) => link.objectId),
    );
    for (const atom of atoms) {
      let belongs = false;
      for (const evidenceId of atom.provenance.evidenceRefs) {
        if (linkedEvidenceIds.has(evidenceId)) {
          belongs = true;
          break;
        }
        const evidence = await this.metadataStore.getEvidence(evidenceId);
        if (evidence && this.evidenceMatchesBinding(evidence, binding)) {
          belongs = true;
          break;
        }
      }
      if (!belongs) {
        continue;
      }
      const id = this.makeSourceObjectLinkId(binding.id, "atom", atom.id);
      if (this.sourceObjectLinks.has(id)) {
        continue;
      }
      await this.persistSourceObjectLink({
        id,
        sourceBindingId: binding.id,
        objectType: "atom",
        objectId: atom.id,
        linkRole: "derived_from",
        createdAt: now,
      });
    }
  }

  private async evidenceRefsBelongToBinding(
    evidenceRefs: string[],
    binding: SourceBinding,
    linkedEvidenceIds: Set<string>,
  ): Promise<boolean> {
    for (const evidenceId of evidenceRefs) {
      if (linkedEvidenceIds.has(evidenceId)) {
        return true;
      }
      const evidence = await this.metadataStore.getEvidence(evidenceId);
      if (evidence && this.evidenceMatchesBinding(evidence, binding)) {
        return true;
      }
    }
    return false;
  }

  private async ensureDerivedObjectLink(
    sourceBindingId: string,
    objectType: "event" | "relation" | "entity" | "scenario" | "problem",
    objectId: string,
    now: string,
  ): Promise<void> {
    const id = this.makeSourceObjectLinkId(sourceBindingId, objectType, objectId);
    if (this.sourceObjectLinks.has(id)) {
      return;
    }
    await this.persistSourceObjectLink({
      id,
      sourceBindingId,
      objectType,
      objectId,
      linkRole: "derived_from",
      createdAt: now,
    });
  }

  /** Ensure sibling bindings that still own live evidence also get a derived link. */
  private async backfillSiblingDerivedLinks(
    objectType: "event" | "relation" | "entity" | "scenario" | "problem",
    objectId: string,
    evidenceRefs: string[],
    now: string,
  ): Promise<void> {
    const siblingBindingIds = new Set<string>();
    for (const evidenceId of evidenceRefs) {
      for (const link of this.liveSourceObjectLinks({
        objectType: "evidence",
        objectId: evidenceId,
      })) {
        siblingBindingIds.add(link.sourceBindingId);
      }
    }
    for (const siblingBindingId of siblingBindingIds) {
      await this.ensureDerivedObjectLink(siblingBindingId, objectType, objectId, now);
    }
  }

  /** Backfill event↔binding links via evidence membership. */
  private async ensureEventLinksForBinding(binding: SourceBinding): Promise<void> {
    const events = await this.metadataStore.listEvents();
    const now = new Date().toISOString();
    const linkedEvidenceIds = new Set(
      this.liveSourceObjectLinks({
        sourceBindingId: binding.id,
        objectType: "evidence",
      }).map((link) => link.objectId),
    );
    for (const event of events) {
      const belongs = await this.evidenceRefsBelongToBinding(
        event.evidenceRefs,
        binding,
        linkedEvidenceIds,
      );
      if (!belongs) {
        continue;
      }
      await this.ensureDerivedObjectLink(binding.id, "event", event.id, now);
      await this.backfillSiblingDerivedLinks("event", event.id, event.evidenceRefs, now);
    }
  }

  /** Backfill relation↔binding links via evidence / linked atom endpoints. */
  private async ensureRelationLinksForBinding(binding: SourceBinding): Promise<void> {
    const relations = await this.metadataStore.listRelations();
    const now = new Date().toISOString();
    const linkedEvidenceIds = new Set(
      this.liveSourceObjectLinks({
        sourceBindingId: binding.id,
        objectType: "evidence",
      }).map((link) => link.objectId),
    );
    const linkedAtomIds = new Set(
      this.liveSourceObjectLinks({
        sourceBindingId: binding.id,
        objectType: "atom",
      }).map((link) => link.objectId),
    );
    for (const relation of relations) {
      const viaEvidence = await this.evidenceRefsBelongToBinding(
        relation.provenance.evidenceRefs,
        binding,
        linkedEvidenceIds,
      );
      const viaAtomEndpoint =
        (relation.fromNodeType === "MemoryAtom" && linkedAtomIds.has(relation.fromId)) ||
        (relation.toNodeType === "MemoryAtom" && linkedAtomIds.has(relation.toId));
      if (!viaEvidence && !viaAtomEndpoint) {
        continue;
      }
      await this.ensureDerivedObjectLink(binding.id, "relation", relation.id, now);
      await this.backfillSiblingDerivedLinks(
        "relation",
        relation.id,
        relation.provenance.evidenceRefs,
        now,
      );
    }
  }

  /** Backfill entity/scenario/problem↔binding links via evidence membership. */
  private async ensureProvenanceObjectLinksForBinding(
    binding: SourceBinding,
    objectType: "entity" | "scenario" | "problem",
  ): Promise<void> {
    const items =
      objectType === "entity"
        ? await this.metadataStore.listEntities()
        : objectType === "scenario"
          ? await this.metadataStore.listScenarios()
          : await this.metadataStore.listProblems();
    const now = new Date().toISOString();
    const linkedEvidenceIds = new Set(
      this.liveSourceObjectLinks({
        sourceBindingId: binding.id,
        objectType: "evidence",
      }).map((link) => link.objectId),
    );
    for (const item of items) {
      const belongs = await this.evidenceRefsBelongToBinding(
        item.provenance.evidenceRefs,
        binding,
        linkedEvidenceIds,
      );
      if (!belongs) {
        continue;
      }
      await this.ensureDerivedObjectLink(binding.id, objectType, item.id, now);
      await this.backfillSiblingDerivedLinks(
        objectType,
        item.id,
        item.provenance.evidenceRefs,
        now,
      );
    }
  }

  private async recomputeProvenanceObjectAfterSourceChange(
    objectType: "entity" | "scenario" | "problem",
    objectId: string,
    mode: "forget" | "purge",
  ): Promise<void> {
    const item =
      objectType === "entity"
        ? await this.metadataStore.getEntity(objectId)
        : objectType === "scenario"
          ? await this.metadataStore.getScenario(objectId)
          : await this.metadataStore.getProblem(objectId);
    if (!item) {
      return;
    }
    const keptEvidenceRefs: string[] = [];
    for (const evidenceId of item.provenance.evidenceRefs) {
      if (this.liveSourceObjectLinks({ objectType: "evidence", objectId: evidenceId }).length > 0) {
        keptEvidenceRefs.push(evidenceId);
      }
    }
    const liveObjectLinks = this.liveSourceObjectLinks({ objectType, objectId });
    if (keptEvidenceRefs.length === 0 && liveObjectLinks.length === 0) {
      if (mode === "purge") {
        if (objectType === "entity" && typeof this.metadataStore.deleteEntity === "function") {
          await this.metadataStore.deleteEntity(objectId);
        } else if (
          objectType === "scenario" &&
          typeof this.metadataStore.deleteScenario === "function"
        ) {
          await this.metadataStore.deleteScenario(objectId);
        } else if (
          objectType === "problem" &&
          typeof this.metadataStore.deleteProblem === "function"
        ) {
          await this.metadataStore.deleteProblem(objectId);
        }
        await this.removeObjectLinkRows(objectType, objectId);
        return;
      }
      const cleared = {
        ...item,
        provenance: { evidenceRefs: [] as string[], sourceEventIds: [] as string[] },
      };
      if (objectType === "entity") {
        await this.metadataStore.saveEntity(cleared as EntityRecord);
      } else if (objectType === "scenario") {
        await this.metadataStore.saveScenario(cleared as ScenarioRecord);
      } else {
        await this.metadataStore.saveProblem(cleared as ProblemRecord);
      }
      return;
    }

    const keptEventIds: string[] = [];
    for (const eventId of item.provenance.sourceEventIds) {
      if (this.liveSourceObjectLinks({ objectType: "event", objectId: eventId }).length > 0) {
        keptEventIds.push(eventId);
      }
    }
    const next = {
      ...item,
      provenance: { evidenceRefs: keptEvidenceRefs, sourceEventIds: keptEventIds },
    };
    if (objectType === "entity") {
      await this.metadataStore.saveEntity(next as EntityRecord);
    } else if (objectType === "scenario") {
      await this.metadataStore.saveScenario(next as ScenarioRecord);
    } else {
      await this.metadataStore.saveProblem(next as ProblemRecord);
    }
  }

  private async recomputeRelationAfterSourceChange(
    relationId: string,
    mode: "forget" | "purge",
  ): Promise<void> {
    const relation = await this.metadataStore.getRelation(relationId);
    if (!relation) {
      return;
    }
    const keptEvidenceRefs: string[] = [];
    for (const evidenceId of relation.provenance.evidenceRefs) {
      const evidenceLive = this.liveSourceObjectLinks({
        objectType: "evidence",
        objectId: evidenceId,
      });
      if (evidenceLive.length > 0) {
        keptEvidenceRefs.push(evidenceId);
      }
    }
    const liveRelationLinks = this.liveSourceObjectLinks({
      objectType: "relation",
      objectId: relationId,
    });
    const endpointStillLive =
      (relation.fromNodeType === "MemoryAtom" &&
        this.liveSourceObjectLinks({ objectType: "atom", objectId: relation.fromId }).length > 0) ||
      (relation.toNodeType === "MemoryAtom" &&
        this.liveSourceObjectLinks({ objectType: "atom", objectId: relation.toId }).length > 0);

    if (keptEvidenceRefs.length === 0 && liveRelationLinks.length === 0 && !endpointStillLive) {
      if (mode === "purge") {
        if (typeof this.metadataStore.deleteRelation === "function") {
          await this.metadataStore.deleteRelation(relationId);
        }
        await this.removeObjectLinkRows("relation", relationId);
        return;
      }
      if (relation.status !== "deprecated") {
        await this.metadataStore.saveRelation({
          ...relation,
          status: "deprecated",
          provenance: {
            evidenceRefs: [],
            sourceEventIds: [],
          },
        });
      }
      return;
    }

    const keptEventIds: string[] = [];
    for (const eventId of relation.provenance.sourceEventIds) {
      const eventLive = this.liveSourceObjectLinks({
        objectType: "event",
        objectId: eventId,
      });
      if (eventLive.length > 0) {
        keptEventIds.push(eventId);
      }
    }
    await this.metadataStore.saveRelation({
      ...relation,
      status: relation.status === "deprecated" ? "active" : relation.status,
      provenance: {
        evidenceRefs: keptEvidenceRefs,
        sourceEventIds: keptEventIds,
      },
    });
  }

  private async objectStillSupportedByLiveEvidence(evidenceRefs: string[]): Promise<boolean> {
    for (const evidenceId of evidenceRefs) {
      if (this.liveSourceObjectLinks({ objectType: "evidence", objectId: evidenceId }).length > 0) {
        return true;
      }
    }
    return false;
  }

  private async purgeOrphanObjectsForBinding(
    bindingId: string,
    objectType: "evidence" | "event" | "relation" | "entity" | "scenario" | "problem",
  ): Promise<void> {
    const objectIds = [
      ...new Set(
        [...this.sourceObjectLinks.values()]
          .filter((link) => link.sourceBindingId === bindingId && link.objectType === objectType)
          .map((link) => link.objectId),
      ),
    ];
    for (const objectId of objectIds) {
      const remaining = this.liveSourceObjectLinks({ objectType, objectId });
      if (remaining.length > 0) {
        continue;
      }
      // Derived objects may lack sibling link rows; keep them while supporting evidence is live.
      if (objectType === "event") {
        const event = await this.metadataStore.getEvent(objectId);
        if (event && (await this.objectStillSupportedByLiveEvidence(event.evidenceRefs))) {
          continue;
        }
      } else if (objectType === "relation") {
        const relation = await this.metadataStore.getRelation(objectId);
        if (
          relation &&
          (await this.objectStillSupportedByLiveEvidence(relation.provenance.evidenceRefs))
        ) {
          continue;
        }
      } else if (objectType === "entity") {
        const entity = await this.metadataStore.getEntity(objectId);
        if (
          entity &&
          (await this.objectStillSupportedByLiveEvidence(entity.provenance.evidenceRefs))
        ) {
          continue;
        }
      } else if (objectType === "scenario") {
        const scenario = await this.metadataStore.getScenario(objectId);
        if (
          scenario &&
          (await this.objectStillSupportedByLiveEvidence(scenario.provenance.evidenceRefs))
        ) {
          continue;
        }
      } else if (objectType === "problem") {
        const problem = await this.metadataStore.getProblem(objectId);
        if (
          problem &&
          (await this.objectStillSupportedByLiveEvidence(problem.provenance.evidenceRefs))
        ) {
          continue;
        }
      }
      if (objectType === "evidence" && typeof this.metadataStore.deleteEvidence === "function") {
        await this.metadataStore.deleteEvidence(objectId);
      } else if (objectType === "event" && typeof this.metadataStore.deleteEvent === "function") {
        await this.metadataStore.deleteEvent(objectId);
      } else if (
        objectType === "relation" &&
        typeof this.metadataStore.deleteRelation === "function"
      ) {
        await this.metadataStore.deleteRelation(objectId);
      } else if (objectType === "entity" && typeof this.metadataStore.deleteEntity === "function") {
        await this.metadataStore.deleteEntity(objectId);
      } else if (
        objectType === "scenario" &&
        typeof this.metadataStore.deleteScenario === "function"
      ) {
        await this.metadataStore.deleteScenario(objectId);
      } else if (
        objectType === "problem" &&
        typeof this.metadataStore.deleteProblem === "function"
      ) {
        await this.metadataStore.deleteProblem(objectId);
      }
      await this.removeObjectLinkRows(objectType, objectId);
    }
  }

  private async removeObjectLinkRows(
    objectType: SourceObjectType,
    objectId: string,
  ): Promise<void> {
    for (const stale of [...this.sourceObjectLinks.values()].filter(
      (link) => link.objectType === objectType && link.objectId === objectId,
    )) {
      this.sourceObjectLinks.delete(stale.id);
      if (typeof this.metadataStore.deleteSourceObjectLink === "function") {
        await this.metadataStore.deleteSourceObjectLink(stale.id);
      }
    }
  }

  /**
   * After forget/purge unlinks: refresh atom provenance from remaining live
   * evidence/source links, or tombstone / hard-delete when none remain.
   *
   * Membership is evidence-centric so a missing atom-link on a still-live
   * sibling source cannot incorrectly tombstone a multi-source atom.
   */
  private async recomputeAtomAfterSourceChange(
    atomId: string,
    mode: "forget" | "purge",
  ): Promise<void> {
    const atom = await this.metadataStore.getAtom(atomId);
    if (!atom) {
      return;
    }
    const originalEvidenceCount = atom.provenance.evidenceRefs.length;
    const keptEvidenceRefs: string[] = [];
    for (const evidenceId of atom.provenance.evidenceRefs) {
      const evidenceLive = this.liveSourceObjectLinks({
        objectType: "evidence",
        objectId: evidenceId,
      });
      if (evidenceLive.length > 0) {
        keptEvidenceRefs.push(evidenceId);
      }
    }
    const liveAtomLinks = this.liveSourceObjectLinks({
      objectType: "atom",
      objectId: atomId,
    });
    if (keptEvidenceRefs.length === 0 && liveAtomLinks.length === 0) {
      if (mode === "purge") {
        await this.metadataStore.deleteAtom(atomId);
        await this.removeObjectLinkRows("atom", atomId);
        return;
      }
      if (atom.state.status !== "deprecated") {
        await this.metadataStore.saveAtom({
          ...atom,
          provenance: { evidenceRefs: [], sourceEventIds: [] },
          state: { ...atom.state, status: "deprecated" },
          versioning: {
            ...atom.versioning,
            version: atom.versioning.version + 1,
          },
        });
      }
      return;
    }

    const keptEventIds: string[] = [];
    for (const eventId of atom.provenance.sourceEventIds) {
      const eventLive = this.liveSourceObjectLinks({
        objectType: "event",
        objectId: eventId,
      });
      if (eventLive.length > 0) {
        keptEventIds.push(eventId);
        continue;
      }
      const event = await this.metadataStore.getEvent(eventId);
      if (event && event.evidenceRefs.some((evidenceId) => keptEvidenceRefs.includes(evidenceId))) {
        keptEventIds.push(eventId);
      }
    }

    const ratio = originalEvidenceCount === 0 ? 1 : keptEvidenceRefs.length / originalEvidenceCount;
    const nextConfidence = Math.max(
      0,
      Math.min(atom.metrics.confidence, atom.metrics.confidence * ratio),
    );
    await this.metadataStore.saveAtom({
      ...atom,
      provenance: {
        evidenceRefs: keptEvidenceRefs,
        sourceEventIds: keptEventIds,
      },
      metrics: {
        ...atom.metrics,
        confidence: nextConfidence,
      },
      state: {
        ...atom.state,
        // Clear accidental tombstone when live sources remain.
        status: atom.state.status === "deprecated" ? "active" : atom.state.status,
      },
      versioning: {
        ...atom.versioning,
        version: atom.versioning.version + 1,
      },
    });
  }

  private async persistSourceLifecycleReceipt(
    receipt: SourceLifecycleReceipt,
    reasonCode?: string,
  ): Promise<void> {
    this.sourceLifecycleReceipts.set(receipt.operationId, receipt);
    if (typeof this.metadataStore.putSourceLifecycleReceipt === "function") {
      await this.metadataStore.putSourceLifecycleReceipt({
        ...receipt,
        ...(reasonCode ? { reasonCode } : {}),
      });
    }
  }

  private async loadSourceLifecycleReceipt(
    operationId: string,
  ): Promise<SourceLifecycleReceipt | undefined> {
    const cached = this.sourceLifecycleReceipts.get(operationId);
    if (cached) {
      return cached;
    }
    if (typeof this.metadataStore.getSourceLifecycleReceipt !== "function") {
      return undefined;
    }
    const persisted = await this.metadataStore.getSourceLifecycleReceipt(operationId);
    if (persisted) {
      const { reasonCode: _reasonCode, ...receipt } = persisted;
      this.sourceLifecycleReceipts.set(operationId, receipt);
      return receipt;
    }
    return undefined;
  }

  private async runMetadataTransaction<T>(runner: () => Promise<T>): Promise<T> {
    if (this.metadataStore.withTransaction) {
      return this.metadataStore.withTransaction(runner);
    }
    return runner();
  }

  async frameTask(
    rawInput: string | Record<string, unknown>,
    options?: { scope?: ScopeInput; hints?: Record<string, string | string[]>; forceLlm?: boolean },
  ): Promise<TaskFrame> {
    await this.ensureSourceLifecycleHydrated();
    const scope = resolveScope(options?.scope, this.config);
    const cacheKey = buildTaskFrameCacheKey(rawInput, scope, options?.hints);
    const forceLlm = options?.forceLlm === true;
    if (!forceLlm) {
      const cached = this.taskFrameCache.get(cacheKey);
      if (cached) {
        return appendTaskFrameHint(cloneTaskFrame(cached), "cache_hit");
      }
    }

    const ruleFraming = await this.taskFramingStrategy.frame({
      rawInput,
      config: this.config,
      scope,
      hints: options?.hints,
      forceLlm,
    });
    const ruleTaskFrame = ruleFraming.taskFrame;
    const ruleConfidence = ruleFraming.confidence;
    if (ruleFraming.source === "llm") {
      const llmHint = forceLlm ? "llm_fallback_forced" : "llm_fallback";
      const result = appendTaskFrameHint(ruleTaskFrame, llmHint);
      this.taskFrameCache.set(cacheKey, cloneTaskFrame(result));
      return result;
    }
    if (!forceLlm && ruleConfidence >= 0.5) {
      const result = appendTaskFrameHint(ruleTaskFrame, "rule_based");
      this.taskFrameCache.set(cacheKey, cloneTaskFrame(result));
      return result;
    }

    const fallbackHint =
      this.config.enableLlmTaskFraming === false
        ? "rule_based_low_confidence"
        : forceLlm
          ? "llm_fallback_forced"
          : "llm_fallback";
    const fallbackTaskFrame = appendTaskFrameHint(ruleTaskFrame, fallbackHint);
    this.taskFrameCache.set(cacheKey, cloneTaskFrame(fallbackTaskFrame));
    return fallbackTaskFrame;
  }

  validateTaskFrame(taskFrame: TaskFrame): void {
    validateTaskFrame(taskFrame);
  }

  normalizeTaskFrame(taskFrame: TaskFrame): TaskFrame {
    return normalizeTaskFrame(taskFrame);
  }

  async reason(taskFrame: TaskFrame, options?: ReasonOptions): Promise<CognitivePackage> {
    const [pkg] = await this.reasonWithDebug(taskFrame, { maxPaths: options?.maxPaths });
    return pkg;
  }

  async reasonWithDebug(
    taskFrame: TaskFrame,
    options?: Pick<ReasonOptions, "maxPaths">,
  ): Promise<[CognitivePackage, ReasonDebugPayload]> {
    const normalizedTaskFrame = normalizeTaskFrame(taskFrame);
    const sessionId = createId("rsn");
    const template = this.templateRegistry.select(normalizedTaskFrame.taskType);
    const selectedTemplate = template.id;

    const allScopedAtoms = selectLatestAtoms(
      (await this.metadataStore.listAtoms())
        .filter((atom) => matchesScope(atom.scope, normalizedTaskFrame.scope))
        .filter((atom) => atom.state.status !== "deprecated"),
    );

    const candidateAtoms = allScopedAtoms
      .map((atom) => {
        let score = computeTaskOverlap(normalizedTaskFrame, atom);
        if (atom.state.status === "tentative") {
          score *= 0.6;
        }
        if (atom.state.status === "conflicted") {
          score *= 0.45;
        }
        return { atom, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    const atomsById = new Map(allScopedAtoms.map((atom) => [atom.id, atom]));
    const relations = (await this.metadataStore.listRelations())
      .filter((relation) => matchesScope(relation.scope, normalizedTaskFrame.scope))
      .filter((relation) => relation.status === "active");
    const relationById = new Map(relations.map((relation) => [relation.id, relation]));

    const seedCandidates = candidateAtoms.filter((entry) => {
      if (!template.startNodeTypes.includes("MemoryAtom")) {
        return false;
      }
      if (!template.startAtomTypes || template.startAtomTypes.length === 0) {
        return true;
      }
      return template.startAtomTypes.includes(entry.atom.atomType);
    });

    const expandedPaths = seedCandidates.flatMap((seed) =>
      expandTemplatePaths(seed, {
        taskFrame: normalizedTaskFrame,
        template,
        atomsById,
        relationById,
        relations,
      }),
    );

    const dropped: DroppedPath[] = expandedPaths
      .filter((entry) => entry.droppedReason)
      .map((entry) => ({
        pathId: entry.path.pathId,
        reason: entry.droppedReason!,
      }));

    const viablePaths = expandedPaths
      .filter((entry) => !entry.droppedReason)
      .map((entry) => entry.path);
    const fallbackSourceCandidates = seedCandidates.length > 0 ? seedCandidates : candidateAtoms;
    const fallbackSeedPaths: ReasoningPath[] =
      viablePaths.length > 0
        ? []
        : fallbackSourceCandidates.map(({ atom, score }) => ({
            pathId: `path_${atom.id}`,
            nodeIds: [atom.id],
            relationChain: [],
            score,
            summary: atom.claim.statement,
          }));

    const allCandidatePaths = [...viablePaths, ...fallbackSeedPaths].sort(
      (a, b) => b.score - a.score,
    );
    const maxPaths = options?.maxPaths ?? 5;
    const selectedPaths = allCandidatePaths.slice(0, maxPaths);
    dropped.push(
      ...allCandidatePaths.slice(maxPaths).map((path) => ({
        pathId: path.pathId,
        reason: "dropped_by_max_paths",
      })),
    );

    const selectedAtoms = mergeDistinct(selectedPaths.flatMap((path) => path.nodeIds))
      .map((nodeId) => atomsById.get(nodeId))
      .filter((atom): atom is MemoryAtom => Boolean(atom));

    const riskMarkers: PackageRiskMarker[] = selectedAtoms
      .filter(
        (atom): atom is MemoryAtom & { state: { status: "tentative" | "conflicted" } } =>
          atom.state.status === "tentative" || atom.state.status === "conflicted",
      )
      .map((atom) => ({
        atomId: atom.id,
        status: atom.state.status,
        explanation: `Selected path includes a ${atom.state.status} atom and should be reviewed.`,
      }));

    const answer = buildPackageAnswer(selectedAtoms);
    const pkg: CognitivePackage = {
      packageId: createId("pkg"),
      taskFrameId: normalizedTaskFrame.id,
      answer,
      why: {
        summary:
          selectedAtoms[0]?.claim.statement ??
          "No strong reusable cognition matched the current task frame.",
        matchedPatterns: mergeDistinct(selectedAtoms.map((atom) => atom.atomType)),
      },
      supportingAtoms: selectedAtoms.map((atom) => atom.id),
      reasoningPath: selectedPaths,
      confidence: selectedPaths[0]?.score ?? 0,
      risks: selectedPaths.length === 0 ? ["no_template_path_found"] : [],
      constraints: normalizedTaskFrame.constraints,
      conflicts: riskMarkers,
      evidenceRefs: mergeDistinct(selectedAtoms.flatMap((atom) => atom.provenance.evidenceRefs)),
      sessionId,
    };

    const debug: ReasonDebugPayload = {
      seedCandidates: seedCandidates.map(({ atom, score }) => ({
        nodeId: atom.id,
        nodeType: "MemoryAtom",
        score,
        reason: "template_seed",
      })),
      selectedTemplate,
      candidatePaths: allCandidatePaths,
      droppedPaths: dropped,
      scoringDetails: Object.fromEntries(
        allCandidatePaths.map((path) => [path.pathId, path.score]),
      ),
    };

    const trace: TracePackageResult = {
      package: pkg,
      taskFrame: normalizedTaskFrame,
      selectedTemplate,
      candidatePaths: allCandidatePaths,
      selectedPathIds: selectedPaths.map((path) => path.pathId),
      droppedPaths: dropped,
      supportingAtoms: selectedAtoms,
      conflicts: riskMarkers,
      evidenceRefs: pkg.evidenceRefs,
    };

    this.packages.set(pkg.packageId, pkg);
    this.packageTraces.set(pkg.packageId, trace);
    this.reasoningSessions.set(sessionId, {
      sessionId,
      taskFrame: normalizedTaskFrame,
      package: pkg,
      selectedTemplate,
      candidatePaths: allCandidatePaths,
      droppedPaths: dropped,
      debug,
    });

    return [pkg, debug];
  }

  async ingest(input: IngestInput): Promise<IngestResult> {
    const resolvedScope = resolveScope(input.scope, this.config);
    const ingestionId = createId("ing");
    const result: IngestResult = {
      ingestionId,
      ingestionChecksum: computeIngestionChecksum(input.rawInput, input.metadata),
      status: "RECEIVED",
    };
    await this.metadataStore.saveIngestion(result);
    return result;
  }

  async distill(input: IngestInput & { forceRebuild?: boolean }): Promise<DistillationResult> {
    return this.distillationStrategy.distill({
      rawInput: input.rawInput,
      config: this.config,
      scope: input.scope,
      sourceType: input.sourceType,
      sourceSessionId: input.sourceSessionId,
      sourceTurnRange: input.sourceTurnRange,
      metadata: input.metadata,
      forceRebuild: input.forceRebuild,
    });
  }

  async writeBack(
    input: IngestInput & { package?: CognitivePackage | null },
  ): Promise<WriteBackResult> {
    const writeOperationKey = await this.resolveWriteOperationKey(input);
    if (writeOperationKey && typeof this.metadataStore.getWriteOperation === "function") {
      const existing = await this.metadataStore.getWriteOperation(writeOperationKey);
      if (existing?.result) {
        return existing.result;
      }
    }

    await this.ingest(input);
    const distillation = await this.distill(input);
    const journalId = createId("jnl");

    const journal: WriteJournal = {
      id: journalId,
      eventKey: distillation.keys.eventKey,
      objectIds: {
        eventIds: [distillation.event.id],
        atomIds: distillation.atoms.map((atom) => atom.id),
        entityIds: distillation.entities.map((entity) => entity.id),
        scenarioIds: distillation.scenarios.map((scenario) => scenario.id),
        problemIds: distillation.problems.map((problem) => problem.id),
        evidenceIds: distillation.evidence.map((item) => item.id),
        relationIds: distillation.relations.map((relation) => relation.id),
      },
      derivedPlan: {
        graphNodeIds: distillation.writePlan.graphNodeIds,
        graphEdgeIds: distillation.writePlan.graphEdgeIds,
        vectorDocIds: distillation.writePlan.vectorDocumentIds,
      },
      status: "RECEIVED",
      phase: "RECEIVED",
      retryCount: 0,
      updatedAt: new Date().toISOString(),
    };
    await this.metadataStore.putJournal(journal);

    try {
      const canonicalCommit = await this.runMetadataTransaction(async () => {
        const existingEvent = await this.metadataStore.findEventByKey(distillation.keys.eventKey);
        const withCanonicalEvent = canonicalizeDistillation(distillation, {
          eventId: existingEvent?.id ?? distillation.event.id,
        });
        const atomDecisions = await this.upsertAtoms(withCanonicalEvent.atoms);
        const atomIdMap = new Map(
          atomDecisions.map((decision) => [
            decision.atomId,
            decision.targetAtomId ?? decision.atomId,
          ]),
        );
        const canonicalDistillation = canonicalizeDistillation(withCanonicalEvent, { atomIdMap });
        assertCanonicalScopeHierarchy(canonicalDistillation);
        const upsertedEvent = await this.upsertEvent(canonicalDistillation.event);

        for (const entity of canonicalDistillation.entities) {
          await this.metadataStore.saveEntity(entity);
        }
        for (const scenario of canonicalDistillation.scenarios) {
          await this.metadataStore.saveScenario(scenario);
        }
        for (const problem of canonicalDistillation.problems) {
          await this.metadataStore.saveProblem(problem);
        }
        for (const evidenceRecord of canonicalDistillation.evidence) {
          await this.metadataStore.saveEvidence(evidenceRecord);
        }
        for (const relation of canonicalDistillation.relations) {
          await this.metadataStore.saveRelation(relation);
        }

        const committedAtomIds = atomDecisions.map(
          (decision) => decision.targetAtomId ?? decision.atomId,
        );
        await this.metadataStore.updateJournal(journalId, {
          status: "METADATA_COMMITTED",
          phase: "METADATA_COMMITTED",
          objectIds: {
            ...journal.objectIds,
            eventIds: [upsertedEvent.id],
            atomIds: committedAtomIds,
          },
          derivedPlan: {
            graphNodeIds: canonicalDistillation.writePlan.graphNodeIds,
            graphEdgeIds: canonicalDistillation.writePlan.graphEdgeIds,
            vectorDocIds: canonicalDistillation.writePlan.vectorDocumentIds,
          },
          updatedAt: new Date().toISOString(),
        });

        return {
          canonicalDistillation,
          upsertedEvent,
          atomIds: committedAtomIds,
        };
      });

      try {
        await this.graphStore.syncFromDistillation(canonicalCommit.canonicalDistillation);
        await this.metadataStore.updateJournal(journalId, {
          phase: "GRAPH_SYNCED",
          updatedAt: new Date().toISOString(),
        });

        await this.vectorStore.syncFromDistillation(canonicalCommit.canonicalDistillation);
        await this.metadataStore.updateJournal(journalId, {
          status: "COMPLETED",
          phase: "COMPLETED",
          updatedAt: new Date().toISOString(),
        });

        const completed: WriteBackResult = {
          eventId: canonicalCommit.upsertedEvent.id,
          atomIds: canonicalCommit.atomIds,
          journalId,
          canonicalStatus: "METADATA_COMMITTED",
          derivedStatus: "SYNCED",
          status: "COMPLETED",
        };
        await this.persistWriteOperation(writeOperationKey, completed);
        return completed;
      } catch (error) {
        await this.metadataStore.updateJournal(journalId, {
          status: "DERIVED_OUT_OF_SYNC",
          lastError: error instanceof Error ? error.message : String(error),
          updatedAt: new Date().toISOString(),
        });
        return {
          eventId: canonicalCommit.upsertedEvent.id,
          atomIds: canonicalCommit.atomIds,
          journalId,
          canonicalStatus: "METADATA_COMMITTED",
          derivedStatus: "DERIVED_OUT_OF_SYNC",
          status: "PARTIAL_SUCCESS",
        };
      }
    } catch (error) {
      await this.metadataStore.updateJournal(journalId, {
        status: "FAILED",
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      });
      return {
        eventId: distillation.event.id,
        atomIds: [],
        journalId,
        canonicalStatus: "FAILED",
        derivedStatus: "NOT_APPLICABLE",
        status: "FAILED",
      };
    }
  }

  private async resolveWriteOperationKey(input: IngestInput): Promise<string | null> {
    if (typeof this.metadataStore.ensureDataPlaneId !== "function") {
      return null;
    }
    const dataPlaneId = await this.metadataStore.ensureDataPlaneId();
    const partition = createMemoryPartitionKeyV1(dataPlaneId, input.scope);
    return computeWriteOperationKey({
      partition,
      sourceType: input.sourceType,
      sourceLocator: resolveSourceLocatorForOperationKey(input),
      contentChecksum: computeIngestionChecksum(input.rawInput, input.metadata),
    });
  }

  private async persistWriteOperation(
    writeOperationKey: string | null,
    result: WriteBackResult,
  ): Promise<void> {
    if (!writeOperationKey || typeof this.metadataStore.putWriteOperation !== "function") {
      return;
    }
    await this.metadataStore.putWriteOperation({
      writeOperationKey,
      kind: "WRITE",
      result,
      completedAt: new Date().toISOString(),
    });
  }

  computeEventKey(input: IngestInput): string {
    return computeEventKey({
      ...input,
      scope: resolveScope(input.scope, this.config),
    });
  }

  computeDedupKey(atom: MemoryAtom): string {
    return computeDedupKey(atom);
  }

  computeIngestionChecksum(
    rawInput: string | Record<string, unknown>,
    metadata?: Record<string, string>,
  ): string {
    return computeIngestionChecksum(rawInput, metadata);
  }

  async upsertEvent(event: EventSkeleton): Promise<EventSkeleton> {
    const eventKey =
      event.eventKey ??
      computeEventKey({
        rawInput: event.context,
        scope: event.scope,
        sourceType: event.provenance.sourceType ?? "external",
        sourceSessionId: event.provenance.sourceSessionId,
        sourceTurnRange: event.provenance.sourceTurnRange,
        metadata: {},
      });
    const existingEvent = await this.metadataStore.findEventByKey(eventKey);
    if (existingEvent) {
      return this.metadataStore.upsertEvent({ ...event, id: existingEvent.id, eventKey });
    }
    return this.metadataStore.upsertEvent({ ...event, eventKey });
  }

  async upsertAtoms(atoms: MemoryAtom[]): Promise<AtomUpsertDecision[]> {
    const decisions: AtomUpsertDecision[] = [];

    for (const incomingAtom of atoms.map((atom) => attachDedupKey(withAtomV2Defaults(atom)))) {
      const dedupKey = incomingAtom.dedupKey!;
      const candidates = await this.metadataStore.findAtomsByDedupKey(dedupKey);
      const mergeTarget = candidates.find((existing) => isMergeCompatible(existing, incomingAtom));

      if (mergeTarget) {
        const merged = mergeAtoms(mergeTarget, incomingAtom);
        await this.metadataStore.saveAtom(merged);
        decisions.push({
          atomId: incomingAtom.id,
          dedupKey,
          action: "merged",
          targetAtomId: mergeTarget.id,
          reason: "compatible existing atom found",
        });
        continue;
      }

      const hasCandidates = candidates.length > 0;
      await this.metadataStore.saveAtom(incomingAtom);
      await this.metadataStore.bindDedupKey(dedupKey, incomingAtom.id);

      decisions.push({
        atomId: incomingAtom.id,
        dedupKey,
        action: hasCandidates ? "candidate_review" : "kept_separate",
        reason: hasCandidates ? "dedup candidate exists but merge was unsafe" : "new atom inserted",
      });
    }

    return decisions;
  }

  async trace(atomId: string, options?: TraceOptions): Promise<MemoryTrace> {
    const requestedScope = resolveReadScopeOrThrow(options?.scope, this.config, "trace");
    const atom = await this.metadataStore.getAtom(atomId);
    if (!atom) {
      return {
        atom: {
          id: atomId,
          atomType: "unknown",
          scope: resolveScope(undefined, this.config),
          claim: { type: "causal", statement: "Atom not found." },
          trigger: { conditions: [], contextTags: [] },
          applicability: { include: [], exclude: [] },
          provenance: { sourceEventIds: [], evidenceRefs: [] },
          versioning: { version: 1 },
          state: { status: "deprecated", conflictsWith: [] },
          metrics: { confidence: 0, reuseCount: 0 },
        },
        eventIds: [],
        evidenceRefs: [],
      };
    }
    assertScopeAccess(atom.scope, requestedScope, "trace");
    return {
      atom,
      eventIds: atom.provenance.sourceEventIds,
      evidenceRefs: atom.provenance.evidenceRefs,
    };
  }

  async tracePackage(packageId: string, _options?: TraceOptions): Promise<TracePackageResult> {
    const requestedScope = resolveReadScopeOrThrow(_options?.scope, this.config, "tracePackage");
    const trace = this.packageTraces.get(packageId);
    if (!trace) {
      throw new Error(`Unknown package trace: ${packageId}`);
    }
    assertScopeAccess(trace.taskFrame.scope, requestedScope, "tracePackage");
    return trace;
  }

  async traceReasoningSession(
    sessionId: string,
    options?: TraceOptions,
  ): Promise<TraceReasoningSessionResult> {
    const requestedScope = resolveReadScopeOrThrow(
      options?.scope,
      this.config,
      "traceReasoningSession",
    );
    const trace = this.reasoningSessions.get(sessionId);
    if (!trace) {
      throw new Error(`Unknown reasoning session: ${sessionId}`);
    }
    assertScopeAccess(trace.taskFrame.scope, requestedScope, "traceReasoningSession");
    return trace;
  }

  async getProvenance(atomId: string) {
    const atom = await this.metadataStore.getAtom(atomId);
    return atom?.provenance ?? { sourceEventIds: [], evidenceRefs: [] };
  }

  async getConflicts(atomId: string): Promise<string[]> {
    return (await this.metadataStore.getAtom(atomId))?.state.conflictsWith ?? [];
  }

  async getVersionHistory(atomId: string): Promise<MemoryAtom[]> {
    const atom = await this.metadataStore.getAtom(atomId);
    if (!atom) {
      return [];
    }
    return (await this.metadataStore.listAtoms()).filter(
      (candidate) =>
        candidate.id === atom.id ||
        candidate.versioning.parentVersion === atom.id ||
        candidate.id === atom.versioning.parentVersion,
    );
  }

  async resolveEvidence(options: ResolveEvidenceOptions) {
    const requestedScope = resolveReadScopeOrThrow(options.scope, this.config, "resolveEvidence");
    if (options.evidenceId) {
      const item = await this.metadataStore.getEvidence(options.evidenceId);
      if (!item) {
        throw new Error(`Unknown evidence: ${options.evidenceId}`);
      }
      assertScopeAccess(item.scope, requestedScope, "resolveEvidence");
      return item;
    }
    if (options.atomId) {
      const atom = await this.metadataStore.getAtom(options.atomId);
      if (!atom) {
        throw new Error(`Unknown atom: ${options.atomId}`);
      }
      assertScopeAccess(atom.scope, requestedScope, "resolveEvidence");
      const evidence = await Promise.all(
        atom.provenance.evidenceRefs.map((evidenceId) =>
          this.metadataStore.getEvidence(evidenceId),
        ),
      );
      return evidence
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .filter((item) => {
          assertScopeAccess(item.scope, requestedScope, "resolveEvidence");
          return true;
        });
    }
    return [];
  }

  async getEvidenceRefs(atomId: string, scope?: ScopeInput): Promise<string[]> {
    const requestedScope = resolveReadScopeOrThrow(scope, this.config, "getEvidenceRefs");
    const atom = await this.metadataStore.getAtom(atomId);
    if (!atom) {
      return [];
    }
    assertScopeAccess(atom.scope, requestedScope, "getEvidenceRefs");
    return atom.provenance.evidenceRefs;
  }

  async searchEvidence(
    query: string,
    options?: SearchEvidenceOptions,
  ): Promise<EvidenceSearchResult[]> {
    await this.ensureSourceLifecycleHydrated();
    const requestedScope = resolveReadScopeOrThrow(options?.scope, this.config, "searchEvidence");
    if (options?.caller) {
      const auth = await this.authorizeQueryAccess(requestedScope, options.caller);
      if (!auth.allowed) {
        return [];
      }
    }
    const threshold = options?.minScore ?? 0;
    const maxResults = options?.maxResults ?? 5;
    const scoped = this.metadataStore.queryEvidence
      ? await this.metadataStore.queryEvidence({ scope: requestedScope })
      : (await this.metadataStore.listEvidence()).filter((evidence) =>
          matchesScope(evidence.scope, requestedScope),
        );
    return scoped
      .filter((evidence) => this.isEvidenceRetrievable(evidence))
      .map((evidence) => scoreEvidenceSearchResult({ evidence, query }))
      .filter((result): result is EvidenceSearchResult => Boolean(result))
      .filter((result) => result.score >= threshold)
      .toSorted((left, right) => {
        const scoreDelta = right.score - left.score;
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        return left.evidence.id.localeCompare(right.evidence.id);
      })
      .slice(0, maxResults);
  }

  /**
   * CW2-P4-01: scope-aware atom query with ACL + lifecycle gates.
   * Fail-closed on authorize deny (empty list — no enumeration).
   */
  async queryAtoms(options: QueryAtomsOptions): Promise<AtomQueryHit[]> {
    await this.ensureSourceLifecycleHydrated();
    const requestedScope = resolveReadScopeOrThrow(options.scope, this.config, "queryAtoms");
    const auth = await this.authorizeQueryAccess(requestedScope, options.caller);
    if (!auth.allowed) {
      return [];
    }
    if (!this.metadataStore.queryAtoms) {
      throw new Error("metadataStore.queryAtoms is required for CW2-P4-01 retrieval");
    }
    const rows = await this.metadataStore.queryAtoms({
      scope: requestedScope,
      atomTypes: options.filter?.atomTypes,
      limit: options.filter?.limit,
    });
    const hits: AtomQueryHit[] = [];
    for (const atom of rows) {
      const lifecycle = isAtomRetrievable(atom, {
        includeTentative: options.filter?.includeTentative,
        includeConflicted: options.filter?.includeConflicted,
      });
      if (!lifecycle.retrievable) {
        continue;
      }
      hits.push({
        atom: withAtomV2Defaults(atom),
        explain: {
          bindingId: auth.bindingId,
          acl: "allowed",
          lifecycle: "retrievable",
          evidenceRefCount: atom.provenance.evidenceRefs.length,
        },
      });
    }
    return hits;
  }

  /**
   * CW2-P4-02: ACL/lifecycle first, then lexical FTS + optional vector + relation boost.
   */
  async queryAtomsHybrid(options: QueryAtomsHybridOptions): Promise<AtomHybridHit[]> {
    const baseHits = await this.queryAtoms(options);
    if (baseHits.length === 0 || !options.query.trim()) {
      return [];
    }
    const byId = new Map(baseHits.map((hit) => [hit.atom.id, hit]));
    const fts = baseHits.map((hit) => {
      const lexical = scoreAtomLexical(options.query, hit.atom);
      return {
        atomId: hit.atom.id,
        score: lexical.score,
        matchedTokens: lexical.matchedTokens,
      };
    });
    const seedIds = fts
      .filter((row) => row.score > 0)
      .toSorted((left, right) => right.score - left.score)
      .slice(0, 5)
      .map((row) => row.atomId);

    let vector: Array<{ atomId: string; score: number }> | undefined;
    if (options.enableVector !== false && typeof this.vectorStore.search === "function") {
      const requestedScope = resolveReadScopeOrThrow(
        options.scope,
        this.config,
        "queryAtomsHybrid",
      );
      const vectorHits = await this.vectorStore.search({
        query: options.query,
        scope: requestedScope,
        limit: options.maxResults ?? 20,
      });
      vector = vectorHits
        .filter((hit) => byId.has(hit.id))
        .map((hit) => ({ atomId: hit.id, score: hit.score }));
    }

    let graphBoost: Map<string, number> | undefined;
    if (options.enableGraphBoost !== false && seedIds.length > 0) {
      const requestedScope = resolveReadScopeOrThrow(
        options.scope,
        this.config,
        "queryAtomsHybrid",
      );
      const relations = this.metadataStore.listRelationsByNode
        ? (
            await Promise.all(
              seedIds.map((nodeId) =>
                this.metadataStore.listRelationsByNode!({
                  nodeId,
                  scope: requestedScope,
                  status: "active",
                }),
              ),
            )
          ).flat()
        : (await this.metadataStore.listRelations()).filter(
            (relation) =>
              matchesScope(relation.scope, requestedScope) && relation.status === "active",
          );
      graphBoost = applyRelationBoost({
        seedAtomIds: seedIds,
        relations,
        candidateAtomIds: new Set(byId.keys()),
      });
    }

    const merged = rerankHybridHits(mergeHybridScores({ fts, vector, graphBoost }), {
      maxResults: options.maxResults,
      minScore: options.minScore,
    });

    return merged.flatMap((row) => {
      const base = byId.get(row.atomId);
      if (!base) {
        return [];
      }
      return [
        {
          ...base,
          score: row.score,
          explain: {
            ...base.explain,
            channels: row.channels,
            matchedTokens: row.matchedTokens,
          },
        },
      ];
    });
  }

  /**
   * Ensure a live MemorySubjectBinding for local/owner callers before ACL-gated reads.
   * Idempotent — OpenBot Memory Center / manager paths call this before queryAtoms.
   */
  async ensureMemorySubjectBinding(input: {
    scope: ScopeInput;
    caller: MemorySubject;
    scopeType?: "personal" | "agent" | "seat";
  }): Promise<{ bindingId: string; created: boolean }> {
    if (
      !this.metadataStore.ensureDataPlaneId ||
      !this.metadataStore.saveMemorySubjectBinding ||
      !this.metadataStore.listMemorySubjectBindings
    ) {
      throw new Error("metadataStore MemorySubjectBinding APIs required");
    }
    const scope = resolveReadScopeOrThrow(input.scope, this.config, "ensureMemorySubjectBinding");
    const dataPlaneId = await this.metadataStore.ensureDataPlaneId();
    const partition = createMemoryPartitionKeyV1(dataPlaneId, scope);
    const existing = await this.metadataStore.listMemorySubjectBindings({
      scope,
      liveOnly: true,
    });
    const auth = authorizeMemoryAccess(existing, { partition, caller: input.caller });
    if (auth.allowed) {
      return { bindingId: auth.bindingId, created: false };
    }
    const binding = createMemorySubjectBinding({
      partition,
      scope,
      subject: input.caller,
      scopeType: input.scopeType ?? "personal",
    });
    await this.metadataStore.saveMemorySubjectBinding(binding);
    return { bindingId: binding.id, created: true };
  }

  private async authorizeQueryAccess(
    scope: Scope,
    caller: MemorySubject,
  ): Promise<AuthorizeMemoryAccessResult> {
    if (!this.metadataStore.ensureDataPlaneId || !this.metadataStore.listMemorySubjectBindings) {
      return { allowed: false, reason: "UNBOUND" };
    }
    const dataPlaneId = await this.metadataStore.ensureDataPlaneId();
    const partition = createMemoryPartitionKeyV1(dataPlaneId, scope);
    const bindings = await this.metadataStore.listMemorySubjectBindings({
      scope,
      liveOnly: true,
    });
    return authorizeMemoryAccess(bindings, { partition, caller });
  }

  async detectConflicts(params: {
    atomIds?: string[];
    scope?: Scope;
  }): Promise<Record<string, unknown>> {
    const targetIds =
      params.atomIds ?? (await this.metadataStore.listAtoms()).map((atom) => atom.id);
    const conflicts = (
      await Promise.all(targetIds.map((atomId) => this.metadataStore.getAtom(atomId)))
    )
      .filter((atom): atom is MemoryAtom => Boolean(atom))
      .filter((atom) => (params.scope ? matchesScope(atom.scope, params.scope) : true))
      .map((atom) => ({ atomId: atom.id, conflictsWith: atom.state.conflictsWith }));
    return { conflicts };
  }

  async recomputeConfidence(
    atomId: string,
    signal?: Record<string, string | number | boolean>,
  ): Promise<number> {
    const atom = await this.metadataStore.getAtom(atomId);
    if (!atom) {
      return 0;
    }
    const boost = typeof signal?.positiveEvidence === "number" ? signal.positiveEvidence : 0;
    atom.metrics.confidence = Math.min(1, Math.max(0, atom.metrics.confidence + boost));
    await this.metadataStore.saveAtom(atom);
    return atom.metrics.confidence;
  }

  async deprecateAtom(atomId: string, _reason: string): Promise<void> {
    const atom = await this.metadataStore.getAtom(atomId);
    if (!atom) {
      return;
    }
    atom.state.status = "deprecated";
    await this.metadataStore.saveAtom(atom);
  }

  async supersedeAtom(oldAtomId: string, newAtomId: string): Promise<void> {
    const oldAtom = await this.metadataStore.getAtom(oldAtomId);
    const newAtom = await this.metadataStore.getAtom(newAtomId);
    if (!oldAtom || !newAtom) {
      return;
    }
    newAtom.versioning.parentVersion = oldAtomId;
    oldAtom.state.status = "deprecated";
    await this.metadataStore.saveAtom(oldAtom);
    await this.metadataStore.saveAtom(newAtom);
  }

  async mergeAtoms(atomIds: string[], targetAtomId?: string): Promise<string> {
    const target = await this.metadataStore.getAtom(targetAtomId ?? atomIds[0]);
    if (!target) {
      throw new Error("merge target not found");
    }
    for (const atomId of atomIds) {
      if (atomId === target.id) {
        continue;
      }
      const atom = await this.metadataStore.getAtom(atomId);
      if (!atom) {
        continue;
      }
      await this.metadataStore.saveAtom(
        mergeAtoms((await this.metadataStore.getAtom(target.id))!, atom),
      );
      await this.metadataStore.deleteAtom(atomId);
    }
    return target.id;
  }

  async repairIndexes(options?: {
    journalId?: string;
    scope?: Scope;
  }): Promise<Record<string, unknown>> {
    let journals = options?.journalId
      ? [await this.metadataStore.getJournal(options.journalId)].filter((v): v is WriteJournal =>
          Boolean(v),
        )
      : (await this.metadataStore.listJournals()).filter(
          (journal) => journal.status === "DERIVED_OUT_OF_SYNC",
        );

    if (options?.scope) {
      const scopedJournals: WriteJournal[] = [];
      for (const journal of journals) {
        const event = journal.objectIds.eventIds[0]
          ? await this.metadataStore.getEvent(journal.objectIds.eventIds[0])
          : undefined;
        if (!event || matchesScope(event.scope, options.scope)) {
          scopedJournals.push(journal);
        }
      }
      journals = scopedJournals;
    }

    const repaired = [];
    for (const journal of journals) {
      repaired.push(
        await repairJournalDerivedIndexes({
          metadataStore: this.metadataStore,
          graphStore: this.graphStore,
          vectorStore: this.vectorStore,
          journal,
        }),
      );
    }
    return { status: "SYNCED", repairedCount: repaired.length };
  }

  async rebuildFromTruth(_options: {
    objectType: string;
    objectId: string;
  }): Promise<Record<string, unknown>> {
    const journals = await this.metadataStore.listJournals();
    const journal = journals.find((candidate) =>
      [
        ...candidate.objectIds.eventIds,
        ...candidate.objectIds.atomIds,
        ...candidate.objectIds.entityIds,
        ...candidate.objectIds.scenarioIds,
        ...candidate.objectIds.problemIds,
        ...candidate.objectIds.evidenceIds,
        ...candidate.objectIds.relationIds,
      ].includes(_options.objectId),
    );
    if (!journal) {
      return { status: "NOT_FOUND" };
    }
    const result = await rebuildDerivedFromTruth({
      metadataStore: this.metadataStore,
      graphStore: this.graphStore,
      vectorStore: this.vectorStore,
      journal,
    });
    return { status: "REBUILT", ...result };
  }

  /**
   * Restart recovery: rebuild derived indexes from canonical rows only.
   * Forbidden: replaying writeBack / creating new WRITE ops.
   */
  async recoverFromCanonical(
    options?: RecoverFromCanonicalOptions,
  ): Promise<RecoverFromCanonicalResult> {
    await this.ensureSourceLifecycleHydrated();

    let journals = (await this.metadataStore.listJournals()).filter((journal) =>
      ["COMPLETED", "DERIVED_OUT_OF_SYNC", "METADATA_COMMITTED"].includes(journal.status),
    );
    if (options?.scope) {
      const scoped: WriteJournal[] = [];
      for (const journal of journals) {
        const event = journal.objectIds.eventIds[0]
          ? await this.metadataStore.getEvent(journal.objectIds.eventIds[0])
          : undefined;
        if (!event || matchesScope(event.scope, options.scope)) {
          scoped.push(journal);
        }
      }
      journals = scoped;
    }

    let journalsRebuilt = 0;
    for (const journal of journals) {
      await rebuildDerivedFromTruth({
        metadataStore: this.metadataStore,
        graphStore: this.graphStore,
        vectorStore: this.vectorStore,
        journal,
      });
      journalsRebuilt += 1;
    }

    const writeOperations =
      typeof this.metadataStore.listWriteOperations === "function"
        ? await this.metadataStore.listWriteOperations()
        : [];
    const orphanSourceBindingIds: string[] = [];
    for (const binding of this.sourceBindings.values()) {
      const live = this.liveSourceObjectLinks({ sourceBindingId: binding.id });
      if (live.length === 0) {
        orphanSourceBindingIds.push(binding.id);
      }
    }

    return {
      status: "RECOVERED",
      journalsRebuilt,
      writeOperationCount: writeOperations.length,
      journalCount: (await this.metadataStore.listJournals()).length,
      orphanSourceBindingIds,
    };
  }

  async compactJournals(options?: CompactJournalsOptions): Promise<CompactJournalsResult> {
    const keepCompleted = Math.max(0, options?.keepCompleted ?? 20);
    const dryRun = options?.dryRun === true;
    const journals = await this.metadataStore.listJournals();
    const pinnedJournalIds = new Set<string>();
    if (typeof this.metadataStore.listWriteOperations === "function") {
      for (const op of await this.metadataStore.listWriteOperations()) {
        if (op.result?.journalId) {
          pinnedJournalIds.add(op.result.journalId);
        }
      }
    }

    const retained = new Set<string>();
    const deletableCompleted: WriteJournal[] = [];
    for (const journal of journals) {
      if (journal.status === "FAILED" || journal.status === "DERIVED_OUT_OF_SYNC") {
        retained.add(journal.id);
        continue;
      }
      if (journal.status !== "COMPLETED") {
        retained.add(journal.id);
        continue;
      }
      if (pinnedJournalIds.has(journal.id)) {
        retained.add(journal.id);
        continue;
      }
      deletableCompleted.push(journal);
    }

    deletableCompleted.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const keepFromTail = deletableCompleted.slice(-keepCompleted);
    for (const journal of keepFromTail) {
      retained.add(journal.id);
    }
    const deletedJournalIds = deletableCompleted
      .filter((journal) => !retained.has(journal.id))
      .map((journal) => journal.id);

    if (!dryRun && typeof this.metadataStore.deleteJournal === "function") {
      for (const journalId of deletedJournalIds) {
        await this.metadataStore.deleteJournal(journalId);
      }
    }

    return {
      status: dryRun ? "DRY_RUN" : "COMPACTED",
      deletedJournalIds,
      retainedJournalIds: [...retained],
    };
  }

  async getWriteJournal(journalId: string, scope?: ScopeInput): Promise<WriteJournal> {
    const requestedScope = resolveReadScopeOrThrow(scope, this.config, "getWriteJournal");
    const journal = await this.metadataStore.getJournal(journalId);
    if (!journal) {
      throw new Error(`Unknown journal: ${journalId}`);
    }
    const firstEventId = journal.objectIds.eventIds[0];
    if (!firstEventId) {
      throw new ScopeViolationError(
        "getWriteJournal cannot validate scope without event reference",
      );
    }
    const event = await this.metadataStore.getEvent(firstEventId);
    if (!event) {
      throw new ScopeViolationError(
        "getWriteJournal cannot validate scope because event was not found",
      );
    }
    assertScopeAccess(event.scope, requestedScope, "getWriteJournal");
    return journal;
  }

  async archiveSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt> {
    return this.applySourceLifecycle(input, "archived");
  }

  async restoreSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt> {
    return this.applySourceLifecycle(input, "active", { from: ["archived"] });
  }

  async forgetSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt> {
    return this.applySourceLifecycle(input, "forgotten", { from: ["active", "archived"] });
  }

  async purgeSource(input: SourceLifecycleInput): Promise<SourceLifecycleReceipt> {
    return this.applySourceLifecycle(input, "purged");
  }

  /** True when evidence is still eligible for retrieval given lifecycle bindings/links. */
  isEvidenceRetrievable(evidence: EvidenceRecord): boolean {
    const liveLinks = this.liveSourceObjectLinks({
      objectType: "evidence",
      objectId: evidence.id,
    });
    if (liveLinks.length > 0) {
      return liveLinks.some((link) => {
        const binding = this.sourceBindings.get(link.sourceBindingId);
        return binding?.status === "active";
      });
    }
    // Legacy path: no normalized links yet — hide when any non-active binding matches.
    for (const binding of this.sourceBindings.values()) {
      if (binding.status === "active") {
        continue;
      }
      if (this.evidenceMatchesBinding(evidence, binding)) {
        return false;
      }
    }
    return true;
  }

  getSourceBindingStatus(selector: SourceLifecycleSelector): SourceLifecycleMode | null {
    const binding = this.findSourceBinding(selector);
    return binding?.status ?? null;
  }

  /** Path / URI still eligible for OpenBot manager search after lifecycle ops. */
  isSourcePathRetrievable(pathOrUri: string): boolean {
    const p = pathOrUri.split("\\").join("/");
    for (const binding of this.sourceBindings.values()) {
      if (binding.status === "active") {
        continue;
      }
      if (
        (binding.sourceIdentityId && p.includes(binding.sourceIdentityId)) ||
        (binding.sourceLocator && p.includes(binding.sourceLocator.split("\\").join("/")))
      ) {
        return false;
      }
    }
    return true;
  }

  private evidenceMatchesBinding(evidence: EvidenceRecord, binding: SourceBinding): boolean {
    const uri = (evidence.uri ?? "").split("\\").join("/");
    const identity = binding.sourceIdentityId;
    const locator = binding.sourceLocator.split("\\").join("/");
    if (identity && (uri === `msrc://${identity}` || uri.includes(identity))) {
      return true;
    }
    if (locator && (uri === locator || uri.endsWith(`/${locator}`) || uri.includes(locator))) {
      return true;
    }
    return false;
  }

  private findSourceBinding(selector: SourceLifecycleSelector): SourceBinding | undefined {
    if (selector.mode === "binding") {
      return this.sourceBindings.get(selector.sourceBindingId);
    }
    if (selector.mode === "identity") {
      const id = this.sourceBindingsByIdentity.get(selector.sourceIdentityId);
      return id ? this.sourceBindings.get(id) : undefined;
    }
    const id = this.sourceBindingsByLocator.get(selector.sourceLocator);
    return id ? this.sourceBindings.get(id) : undefined;
  }

  private ensureSourceBinding(selector: SourceLifecycleSelector, scope: Scope): SourceBinding {
    const existing = this.findSourceBinding(selector);
    if (existing) {
      return existing;
    }
    const now = new Date().toISOString();
    const sourceIdentityId =
      selector.mode === "identity"
        ? selector.sourceIdentityId
        : selector.mode === "binding"
          ? selector.sourceBindingId
          : `loc_${createHash("sha256").update(selector.sourceLocator).digest("hex").slice(0, 16)}`;
    const sourceLocator =
      selector.mode === "legacyLocator"
        ? selector.sourceLocator
        : selector.mode === "identity"
          ? `msrc://${selector.sourceIdentityId}`
          : `binding://${selector.sourceBindingId}`;
    const binding: SourceBinding = {
      id: `sb_${createHash("sha256").update(`${sourceIdentityId}\0${sourceLocator}`).digest("hex").slice(0, 20)}`,
      sourceIdentityId,
      sourceLocator,
      status: "active",
      scope: { ...scope },
      createdAt: now,
      updatedAt: now,
    };
    this.sourceBindings.set(binding.id, binding);
    this.sourceBindingsByIdentity.set(binding.sourceIdentityId, binding.id);
    this.sourceBindingsByLocator.set(binding.sourceLocator, binding.id);
    return binding;
  }

  private async applySourceLifecycle(
    input: SourceLifecycleInput,
    target: SourceLifecycleMode,
    opts?: { from?: SourceLifecycleMode[] },
  ): Promise<SourceLifecycleReceipt> {
    await this.ensureSourceLifecycleHydrated();
    const existingReceipt = await this.loadSourceLifecycleReceipt(input.operationId);
    if (existingReceipt) {
      if (existingReceipt.currentStatus !== target) {
        throw new IdempotencyConflictError(
          `operationId ${input.operationId} already completed with status=${existingReceipt.currentStatus}`,
        );
      }
      return existingReceipt;
    }

    const binding = this.ensureSourceBinding(input.selector, input.subject.scope);
    await this.persistSourceBinding(binding);
    const previousStatus = binding.status;
    if (input.expectedStatus && previousStatus !== input.expectedStatus) {
      throw new Error(
        `source status mismatch: expected ${input.expectedStatus}, got ${previousStatus}`,
      );
    }
    if (previousStatus === target) {
      const receipt: SourceLifecycleReceipt = {
        operationId: input.operationId,
        sourceIdentityId: binding.sourceIdentityId,
        sourceBindingId: binding.id,
        previousStatus,
        currentStatus: target,
        affectedObjectCount: 0,
        completedAt: new Date().toISOString(),
      };
      await this.persistSourceLifecycleReceipt(receipt, input.reasonCode);
      return receipt;
    }
    if (opts?.from && !opts.from.includes(previousStatus)) {
      throw new Error(
        `invalid source lifecycle transition ${previousStatus} -> ${target} (allowed from: ${opts.from.join(",")})`,
      );
    }
    // Terminal states cannot move except purge (any -> purged already allowed without from).
    if (
      (previousStatus === "forgotten" || previousStatus === "purged") &&
      target !== "purged" &&
      previousStatus !== target
    ) {
      throw new Error(
        `cannot transition source from terminal status ${previousStatus} to ${target}`,
      );
    }

    binding.status = target;
    binding.updatedAt = new Date().toISOString();
    this.sourceBindings.set(binding.id, binding);
    await this.persistSourceBinding(binding);

    // Archive keeps links; forget/purge soft-unlink. Always ensure membership rows first.
    await this.ensureEvidenceLinksForBinding(binding);
    await this.ensureAtomLinksForBinding(binding);
    await this.ensureEventLinksForBinding(binding);
    await this.ensureRelationLinksForBinding(binding);
    await this.ensureProvenanceObjectLinksForBinding(binding, "entity");
    await this.ensureProvenanceObjectLinksForBinding(binding, "scenario");
    await this.ensureProvenanceObjectLinksForBinding(binding, "problem");

    let affectedObjectCount = 0;
    if (target === "forgotten" || target === "purged") {
      const now = new Date().toISOString();
      const liveLinks = this.liveSourceObjectLinks({ sourceBindingId: binding.id });
      const unlinkingEvidenceIds = new Set(
        liveLinks.filter((link) => link.objectType === "evidence").map((link) => link.objectId),
      );
      const affectedAtomIds = new Set(
        liveLinks.filter((link) => link.objectType === "atom").map((link) => link.objectId),
      );
      const affectedRelationIds = new Set(
        liveLinks.filter((link) => link.objectType === "relation").map((link) => link.objectId),
      );
      const affectedEntityIds = new Set(
        liveLinks.filter((link) => link.objectType === "entity").map((link) => link.objectId),
      );
      const affectedScenarioIds = new Set(
        liveLinks.filter((link) => link.objectType === "scenario").map((link) => link.objectId),
      );
      const affectedProblemIds = new Set(
        liveLinks.filter((link) => link.objectType === "problem").map((link) => link.objectId),
      );
      // Objects that cite evidence being unlinked must recompute even without a link row.
      if (unlinkingEvidenceIds.size > 0) {
        for (const atom of await this.metadataStore.listAtoms()) {
          if (atom.provenance.evidenceRefs.some((id) => unlinkingEvidenceIds.has(id))) {
            affectedAtomIds.add(atom.id);
          }
        }
        for (const relation of await this.metadataStore.listRelations()) {
          if (relation.provenance.evidenceRefs.some((id) => unlinkingEvidenceIds.has(id))) {
            affectedRelationIds.add(relation.id);
          }
        }
        for (const entity of await this.metadataStore.listEntities()) {
          if (entity.provenance.evidenceRefs.some((id) => unlinkingEvidenceIds.has(id))) {
            affectedEntityIds.add(entity.id);
          }
        }
        for (const scenario of await this.metadataStore.listScenarios()) {
          if (scenario.provenance.evidenceRefs.some((id) => unlinkingEvidenceIds.has(id))) {
            affectedScenarioIds.add(scenario.id);
          }
        }
        for (const problem of await this.metadataStore.listProblems()) {
          if (problem.provenance.evidenceRefs.some((id) => unlinkingEvidenceIds.has(id))) {
            affectedProblemIds.add(problem.id);
          }
        }
      }
      for (const link of liveLinks) {
        await this.persistSourceObjectLink({ ...link, unlinkedAt: now });
      }
      affectedObjectCount = liveLinks.length;

      const mode = target === "purged" ? "purge" : "forget";
      // Include objects already unlinked on a prior forget when purging.
      if (target === "purged") {
        for (const link of this.sourceObjectLinks.values()) {
          if (link.sourceBindingId !== binding.id) {
            continue;
          }
          if (link.objectType === "atom") {
            affectedAtomIds.add(link.objectId);
          }
          if (link.objectType === "relation") {
            affectedRelationIds.add(link.objectId);
          }
          if (link.objectType === "entity") {
            affectedEntityIds.add(link.objectId);
          }
          if (link.objectType === "scenario") {
            affectedScenarioIds.add(link.objectId);
          }
          if (link.objectType === "problem") {
            affectedProblemIds.add(link.objectId);
          }
        }
      }
      for (const atomId of affectedAtomIds) {
        await this.recomputeAtomAfterSourceChange(atomId, mode);
      }
      for (const relationId of affectedRelationIds) {
        await this.recomputeRelationAfterSourceChange(relationId, mode);
      }
      for (const entityId of affectedEntityIds) {
        await this.recomputeProvenanceObjectAfterSourceChange("entity", entityId, mode);
      }
      for (const scenarioId of affectedScenarioIds) {
        await this.recomputeProvenanceObjectAfterSourceChange("scenario", scenarioId, mode);
      }
      for (const problemId of affectedProblemIds) {
        await this.recomputeProvenanceObjectAfterSourceChange("problem", problemId, mode);
      }

      if (target === "purged") {
        await this.purgeOrphanObjectsForBinding(binding.id, "evidence");
        await this.purgeOrphanObjectsForBinding(binding.id, "event");
        await this.purgeOrphanObjectsForBinding(binding.id, "relation");
        await this.purgeOrphanObjectsForBinding(binding.id, "entity");
        await this.purgeOrphanObjectsForBinding(binding.id, "scenario");
        await this.purgeOrphanObjectsForBinding(binding.id, "problem");
      }
    }

    const receipt: SourceLifecycleReceipt = {
      operationId: input.operationId,
      sourceIdentityId: binding.sourceIdentityId,
      sourceBindingId: binding.id,
      previousStatus,
      currentStatus: target,
      affectedObjectCount,
      completedAt: new Date().toISOString(),
    };
    await this.persistSourceLifecycleReceipt(receipt, input.reasonCode);
    return receipt;
  }
}
