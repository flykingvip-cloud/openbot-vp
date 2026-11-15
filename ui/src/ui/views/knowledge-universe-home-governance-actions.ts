import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { KnowledgeActionSuggestion } from "../capability/knowledge-universe/types.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import type { KnowledgeDetailInsights } from "./knowledge-universe-detail-insights.ts";

export type KnowledgeUniverseHomeGovernanceActionsOptions = {
  onOpenGovernance: () => void;
};

export type HomeGovernanceSignal = {
  action: KnowledgeActionSuggestion;
  traceRefs: string[];
  traceLabels: string[];
};

export type HomeGovernanceTickerItem = {
  id: string;
  title: string;
  executable: boolean;
  onActivate: () => void;
};

const HOME_TICKER_LIMIT = 8;

/**
 * Resolve the relation chain (traceRefs) backing a governance signal. A signal is only allowed
 * into the home main action area when this returns at least one ref, enforcing the rule that
 * every surfaced governance signal must be traceable to a visible relationship chain.
 */
export function resolveHomeSignalTraceRefs(
  surface: WorkbenchKnowledgeSurface,
  action: KnowledgeActionSuggestion,
): { refs: string[]; labels: string[] } {
  const graph = surface.graph;
  const refs: string[] = [];
  const labels: string[] = [];
  const seen = new Set<string>();

  const pushNode = (nodeId: string) => {
    if (seen.has(nodeId)) {
      return;
    }
    seen.add(nodeId);
    refs.push(nodeId);
    const node = graph?.nodes.find((candidate) => candidate.id === nodeId);
    if (node) {
      labels.push(node.title);
    }
  };

  const addObjectChain = (objectId?: string) => {
    if (!objectId || !graph) {
      return;
    }
    const node = graph.nodes.find(
      (candidate) => candidate.objectId === objectId || candidate.id === objectId,
    );
    if (!node) {
      return;
    }
    pushNode(node.id);
    for (const edge of graph.edges) {
      if (edge.sourceId === node.id) {
        pushNode(edge.targetId);
      } else if (edge.targetId === node.id) {
        pushNode(edge.sourceId);
      }
    }
  };

  addObjectChain(action.context.objectId);
  addObjectChain(action.context.targetObjectId);

  if (action.context.governanceTaskId) {
    const task = surface.governanceTasks.find(
      (candidate) => candidate.id === action.context.governanceTaskId,
    );
    for (const chunkId of task?.relatedChunkIds ?? []) {
      if (!seen.has(chunkId)) {
        seen.add(chunkId);
        refs.push(chunkId);
      }
    }
  }

  if (action.context.deliverableId) {
    const deliverable = surface.workspaceDeliverables.find(
      (candidate) => candidate.deliverableId === action.context.deliverableId,
    );
    const relatedKbId = deliverable?.relatedKnowledgeBaseId;
    if (relatedKbId && !seen.has(relatedKbId)) {
      seen.add(relatedKbId);
      refs.push(relatedKbId);
      const kb = surface.knowledgeBases.find((candidate) => candidate.id === relatedKbId);
      if (kb) {
        labels.push(kb.title);
      }
    }
  }

  return { refs, labels };
}

/** Governance signals that pass the traceRefs gate, sorted by score, ready for the home rail. */
export function collectHomeGovernanceSignals(
  surface: WorkbenchKnowledgeSurface,
): HomeGovernanceSignal[] {
  return surface.actionSuggestions
    .map((action) => {
      const { refs, labels } = resolveHomeSignalTraceRefs(surface, action);
      return { action, traceRefs: refs, traceLabels: labels } satisfies HomeGovernanceSignal;
    })
    .filter((signal) => signal.traceRefs.length > 0)
    .toSorted((a, b) => b.action.score - a.action.score);
}

const GENERIC_OPEN_TITLES = new Set(["查看相关知识", "View related knowledge"]);
const GENERIC_RELATION_TITLES = new Set(["建立知识关联", "Establish relation"]);

function resolveObjectTitleFromSurface(
  surface: WorkbenchKnowledgeSurface,
  objectId?: string,
): string | null {
  if (!objectId) {
    return null;
  }
  const node = surface.graph?.nodes.find(
    (candidate) => candidate.objectId === objectId || candidate.id === objectId,
  );
  const title = node?.title?.trim();
  return title || null;
}

/** Prefer concrete knowledge titles over generic action verbs in the home ticker. */
export function resolveHomeTickerActionTitle(
  action: KnowledgeActionSuggestion,
  surface: WorkbenchKnowledgeSurface,
  traceLabels: string[] = [],
): string {
  const raw = action.title.trim();
  if (action.actionType === "open_object") {
    if (!raw || GENERIC_OPEN_TITLES.has(raw)) {
      return (
        resolveObjectTitleFromSurface(surface, action.context.objectId) ??
        traceLabels[0] ??
        (raw || "查看相关知识")
      );
    }
    return raw;
  }
  if (action.actionType === "establish_relation") {
    if (!raw || GENERIC_RELATION_TITLES.has(raw)) {
      const target =
        resolveObjectTitleFromSurface(surface, action.context.targetObjectId) ??
        resolveObjectTitleFromSurface(surface, action.context.objectId) ??
        traceLabels[0];
      return target ? `关联「${target}」` : raw || "建立知识关联";
    }
    return raw;
  }
  return raw || action.title;
}

function mapActionToTickerItem(
  action: KnowledgeActionSuggestion,
  onOpenGovernance: () => void,
  surface: WorkbenchKnowledgeSurface,
  traceLabels: string[] = [],
): HomeGovernanceTickerItem {
  return {
    id: action.actionId,
    title: resolveHomeTickerActionTitle(action, surface, traceLabels),
    executable: action.executable,
    onActivate: () => {
      if (action.executable) {
        void surface.onExecuteKnowledgeAction(action);
        return;
      }
      onOpenGovernance();
    },
  };
}

function collectTickerItems(
  surface: WorkbenchKnowledgeSurface,
  insights: KnowledgeDetailInsights | null,
  onOpenGovernance: () => void,
): HomeGovernanceTickerItem[] {
  const signals = collectHomeGovernanceSignals(surface).slice(0, HOME_TICKER_LIMIT);
  if (signals.length > 0) {
    return signals.map((signal) =>
      mapActionToTickerItem(signal.action, onOpenGovernance, surface, signal.traceLabels),
    );
  }

  // Document ego subgraphs often omit the KB-level object ids that action
  // suggestions reference, so the traceRefs gate yields an empty rail. Fall
  // back to top-scoring suggestions so the compact ticker still surfaces work.
  const untraced = [...surface.actionSuggestions]
    .toSorted((a, b) => b.score - a.score)
    .slice(0, HOME_TICKER_LIMIT);
  if (untraced.length > 0) {
    return untraced.map((action) => mapActionToTickerItem(action, onOpenGovernance, surface));
  }

  const discoveries = insights?.discoveries.slice(0, HOME_TICKER_LIMIT) ?? [];
  return discoveries.map((discovery) => ({
    id: discovery.id,
    title: discovery.headline,
    executable: Boolean(discovery.action?.executable),
    onActivate: () => {
      if (discovery.action?.executable) {
        void surface.onExecuteKnowledgeAction(discovery.action.suggestion);
        return;
      }
      onOpenGovernance();
    },
  }));
}

function renderTickerSequence(items: HomeGovernanceTickerItem[], keyPrefix: string) {
  return items.map(
    (item, index) => html`
      ${
        index > 0
          ? html`
              <span class="ku-home-gov-ticker__sep" aria-hidden="true">·</span>
            `
          : nothing
      }
      <button
        type="button"
        class="ku-home-gov-ticker__item"
        data-testid="ku-home-gov-signal"
        data-ticker-key=${`${keyPrefix}-${item.id}`}
        title=${item.title}
        @click=${() => item.onActivate()}
      >
        ${item.title}
      </button>
    `,
  );
}

/**
 * Compact scrolling ticker of pending governance items. Header / CTA / per-row action buttons
 * are intentionally omitted so the relation topology above can claim most of the cockpit height.
 */
export function renderKnowledgeUniverseHomeGovernanceActions(
  surface: WorkbenchKnowledgeSurface,
  options: KnowledgeUniverseHomeGovernanceActionsOptions,
  insights: KnowledgeDetailInsights | null = null,
) {
  const items = collectTickerItems(surface, insights, options.onOpenGovernance);
  const shouldAnimate = items.length > 1;

  return html`
    <section
      class="ku-home-cockpit__governance ku-home-cockpit__governance--ticker"
      data-testid="ku-home-governance-actions"
      aria-label=${t("frontstage.workbench.knowledgeUniverse.home.governanceActions.heading")}
    >
      ${
        surface.insightsLoading && items.length === 0
          ? html`<p class="ku-home-gov-ticker__empty" data-testid="ku-home-gov-loading">
              ${t("frontstage.workbench.knowledgeUniverse.home.governanceActions.loading")}
            </p>`
          : items.length === 0
            ? html`<p class="ku-home-gov-ticker__empty" data-testid="ku-home-gov-empty">
              ${t("frontstage.workbench.knowledgeUniverse.home.governanceActions.noTrace")}
            </p>`
            : html`
              <div
                class="ku-home-gov-ticker${shouldAnimate ? " ku-home-gov-ticker--scroll" : ""}"
                data-testid="ku-home-gov-ticker"
              >
                <div class="ku-home-gov-ticker__viewport">
                  <div class="ku-home-gov-ticker__track">
                    <div class="ku-home-gov-ticker__group">${renderTickerSequence(items, "a")}</div>
                    ${
                      shouldAnimate
                        ? html`<div class="ku-home-gov-ticker__group" aria-hidden="true">
                            ${renderTickerSequence(items, "b")}
                          </div>`
                        : nothing
                    }
                  </div>
                </div>
              </div>
            `
      }
    </section>
  `;
}

/** @deprecated Prefer the ticker; kept for tests that import the row helper. */
export function renderHomeGovernanceSignalRow(
  surface: WorkbenchKnowledgeSurface,
  signal: HomeGovernanceSignal,
) {
  return html`
    <button
      type="button"
      class="ku-home-gov-ticker__item"
      role="listitem"
      data-testid="ku-home-gov-signal"
      data-action-type=${signal.action.actionType}
      @click=${() => void surface.onExecuteKnowledgeAction(signal.action)}
    >
      ${signal.action.title}
    </button>
  `;
}
