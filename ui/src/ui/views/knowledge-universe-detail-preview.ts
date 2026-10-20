import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { findNeighborNodeIds } from "../capability/knowledge-universe/graph-view-model.ts";
import {
  graphGovernanceStatusLabel,
  relationshipNodeKindLabel,
} from "../capability/knowledge-universe/node-kind-labels.ts";
import type {
  KnowledgeActionSuggestion,
  KnowledgeObject,
  KnowledgeObjectKind,
  KnowledgeRelatedGroups,
  PersonalKnowledgeVersionSummary,
  RelationshipGraph,
} from "../capability/knowledge-universe/types.ts";
import {
  buildKnowledgeDetailInsights,
  renderKnowledgeDetailInsights,
} from "./knowledge-universe-detail-insights.ts";

function renderRelatedGroup(
  title: string,
  items: Array<{ id?: string; title: string; kind?: string }>,
) {
  if (!items.length) {
    return nothing;
  }
  return html`
    <div class="knowledge-universe__detail-group">
      <div class="knowledge-universe__detail-related-title">${title}</div>
      <ul>
        ${items.map(
          (item) =>
            html`<li>${item.title}${item.kind ? html`<span>${item.kind}</span>` : nothing}</li>`,
        )}
      </ul>
    </div>
  `;
}

function formatVersionTime(createdAt: number): string {
  if (!createdAt) {
    return "";
  }
  return new Date(createdAt).toLocaleDateString();
}

/**
 * Phase 3: version evolution timeline for the focused personal knowledge object. Newest version is
 * flagged current, older ones trail below — giving the panel the time/evolution dimension the
 * relations page previously lacked. Data comes from the existing personal version API.
 */
function renderVersionTimeline(versions: PersonalKnowledgeVersionSummary[]) {
  return html`
    <div class="knowledge-universe__detail-evolution" data-testid="ku-detail-evolution">
      <div class="knowledge-universe__detail-related-title">
        ${t("frontstage.workbench.knowledgeUniverse.detail.evolutionHeading")}
      </div>
      <ol class="knowledge-universe__detail-evolution-list">
        ${versions.map(
          (version, index) => html`
            <li class="knowledge-universe__detail-evolution-item ${index === 0 ? "is-current" : ""}">
              <span class="knowledge-universe__detail-evolution-dot" aria-hidden="true"></span>
              <div class="knowledge-universe__detail-evolution-body">
                <span class="knowledge-universe__detail-evolution-head">
                  <span class="knowledge-universe__detail-evolution-version">${version.version}</span>
                  ${
                    index === 0
                      ? html`<span class="knowledge-universe__detail-evolution-current"
                          >${t("frontstage.workbench.knowledgeUniverse.detail.evolutionCurrent")}</span
                        >`
                      : nothing
                  }
                  <span class="knowledge-universe__detail-evolution-time"
                    >${formatVersionTime(version.createdAt)}</span
                  >
                </span>
                <span class="knowledge-universe__detail-evolution-summary">${version.summary}</span>
              </div>
            </li>
          `,
        )}
      </ol>
    </div>
  `;
}

function objectKindLabel(kind: KnowledgeObjectKind): string {
  return t(`frontstage.workbench.knowledgeUniverse.detail.kinds.${kind}`);
}

function formatUpdatedAt(updatedAt: number): string {
  if (!updatedAt) {
    return "";
  }
  return new Date(updatedAt).toLocaleDateString();
}

export function renderKnowledgeUniverseDetailPreview(params: {
  selectedNodeId: string | null;
  selectedObject: KnowledgeObject | null;
  graph: RelationshipGraph | null;
  relatedGroups?: KnowledgeRelatedGroups | null;
  onCreatePublishIntent?: (params: {
    objectId: string;
    objectTitle: string;
    objectSummary?: string;
    provider?: string;
    suggestedAction?: string;
  }) => void;
  actionSuggestions?: KnowledgeActionSuggestion[];
  onExecuteKnowledgeAction?: (action: KnowledgeActionSuggestion) => void;
  personalVersions?: PersonalKnowledgeVersionSummary[];
  /** Display name of the current viewer, used to label the self-owner node ("我" → e.g. "CEO"). */
  viewerOwnerLabel?: string | null;
}) {
  if (!params.selectedNodeId && !params.selectedObject) {
    return html`
      <aside class="knowledge-universe__detail-preview">
        <div class="knowledge-universe__detail-empty">
          ${t("frontstage.workbench.knowledgeUniverse.detail.empty")}
        </div>
      </aside>
    `;
  }

  const groups = params.relatedGroups;
  const neighbors =
    !groups && params.graph && params.selectedNodeId
      ? [...findNeighborNodeIds(params.graph, params.selectedNodeId)]
          .filter((id) => id !== params.selectedNodeId)
          .map((id) => params.graph?.nodes.find((node) => node.id === id))
          .filter((node): node is NonNullable<typeof node> => !!node)
      : [];

  const object = params.selectedObject ?? groups?.object ?? null;
  // Governance suggestions that trace to the focused object; drives the 发现→执行 band below.
  const focusActions =
    object && params.onExecuteKnowledgeAction
      ? (params.actionSuggestions ?? []).filter(
          (action) =>
            action.context.objectId === object.id || action.context.targetObjectId === object.id,
        )
      : [];
  const focusNode =
    params.graph && params.selectedNodeId
      ? (params.graph.nodes.find((node) => node.id === params.selectedNodeId) ?? null)
      : null;
  const governance = focusNode?.governance;
  const nodeTitle = focusNode?.title ?? "";
  const detailInsights =
    params.graph && params.selectedNodeId
      ? buildKnowledgeDetailInsights({
          object,
          objectTitle: object?.title ?? nodeTitle,
          governance,
          graph: params.graph,
          selectedNodeId: params.selectedNodeId,
          relatedGroups: groups,
          focusActions,
        })
      : null;
  return html`
    <aside class="knowledge-universe__detail-preview">
      <div class="knowledge-universe__detail-title">
        <span class="knowledge-universe__detail-title-text">${object?.title ?? nodeTitle}</span>
        ${
          governance
            ? html`<span
                class=${`knowledge-universe__detail-title-status knowledge-universe__detail-title-status--${governance.status}`}
                >${graphGovernanceStatusLabel(governance.status)}</span
              >`
            : nothing
        }
      </div>
      ${
        object
          ? html`
              <p class="knowledge-universe__detail-summary">${object.summary}</p>
              <dl class="knowledge-universe__detail-meta">
                <div>
                  <dt>${t("frontstage.workbench.knowledgeUniverse.detail.type")}</dt>
                  <dd>${objectKindLabel(object.kind)}</dd>
                </div>
                ${
                  object.updatedAt
                    ? html`<div><dt>${t("frontstage.workbench.knowledgeUniverse.detail.updated")}</dt><dd>${formatUpdatedAt(object.updatedAt)}</dd></div>`
                    : nothing
                }
                ${
                  object.sourceSystem
                    ? html`<div><dt>${t("frontstage.workbench.knowledgeUniverse.detail.source")}</dt><dd>${object.sourceSystem}</dd></div>`
                    : nothing
                }
                ${
                  object.scopeLabel
                    ? html`<div><dt>${t("frontstage.workbench.knowledgeUniverse.detail.scope")}</dt><dd>${object.scopeLabel}</dd></div>`
                    : nothing
                }
                ${
                  object.maskingSummary
                    ? html`<div><dt>${t("frontstage.workbench.knowledgeUniverse.detail.masking")}</dt><dd>${object.maskingSummary}</dd></div>`
                    : nothing
                }
                ${
                  object.relationshipSummary
                    ? html`
                        <div>
                          <dt>${t("frontstage.workbench.knowledgeUniverse.detail.relations")}</dt>
                          <dd>
                            ${object.relationshipSummary.relatedCount}
                            ${
                              object.relationshipSummary.conflictCount
                                ? html` · ${t(
                                    "frontstage.workbench.knowledgeUniverse.detail.conflicts",
                                    {
                                      count: object.relationshipSummary.conflictCount,
                                    },
                                  )}`
                                : nothing
                            }
                          </dd>
                        </div>
                      `
                    : nothing
                }
              </dl>
              ${
                params.onCreatePublishIntent && object.id
                  ? html`
                      <div class="knowledge-universe__detail-actions">
                        <details class="knowledge-universe__publish-picker">
                          <summary class="btn btn--sm btn--primary knowledge-universe__publish-picker-trigger">
                            ${t("frontstage.workbench.knowledgeUniverse.detail.publishIntentAction")}
                          </summary>
                          <div class="knowledge-universe__publish-channels" role="menu">
                            ${(
                              [
                                {
                                  provider: "github-personal",
                                  suggestedAction: "create_issue",
                                  label: "创建 GitHub Issue",
                                },
                                {
                                  provider: "personal-email",
                                  suggestedAction: "send_email",
                                  label: "发送到个人邮箱",
                                },
                              ] as const
                            ).map(
                              (channel) => html`
                                <button
                                  type="button"
                                  role="menuitem"
                                  class="btn btn--sm knowledge-universe__publish-channel"
                                  @click=${() =>
                                    params.onCreatePublishIntent?.({
                                      objectId: object.id,
                                      objectTitle: object.title,
                                      objectSummary: object.summary,
                                      provider: channel.provider,
                                      suggestedAction: channel.suggestedAction,
                                    })}
                                >
                                  ${channel.label}
                                </button>
                              `,
                            )}
                          </div>
                        </details>
                        <p class="knowledge-universe__detail-summary">
                          ${t("frontstage.workbench.knowledgeUniverse.detail.publishIntentHint")}
                        </p>
                      </div>
                    `
                  : nothing
              }
            `
          : html`
              <p class="knowledge-universe__detail-summary">
                ${t("frontstage.workbench.knowledgeUniverse.detail.nodeOnly")}
              </p>
            `
      }
      ${
        detailInsights
          ? renderKnowledgeDetailInsights({
              insights: detailInsights,
              onExecuteKnowledgeAction: params.onExecuteKnowledgeAction,
            })
          : nothing
      }
      ${
        groups
          ? html`
              ${renderRelatedGroup(
                t("frontstage.workbench.knowledgeUniverse.detail.groupKnowledge"),
                groups.knowledge.map((item) => ({ id: item.id, title: item.title })),
              )}
              ${renderRelatedGroup(
                t("frontstage.workbench.knowledgeUniverse.detail.groupDataCapabilities"),
                groups.dataCapabilities.map((item) => ({ id: item.id, title: item.title })),
              )}
              ${renderRelatedGroup(
                t("frontstage.workbench.knowledgeUniverse.detail.groupAgents"),
                groups.agents.map((item) => ({
                  id: item.id,
                  title: item.title,
                  kind: relationshipNodeKindLabel(item.kind),
                })),
              )}
              ${renderRelatedGroup(
                t("frontstage.workbench.knowledgeUniverse.detail.groupOwners"),
                // Section is already titled 负责人; do not append the per-item "负责人" kind label
                // (that turned the self-owner node titled "我" into a confusing "我负责人").
                // Label the self-owner node ("node:me", title "我") with the viewer's account name.
                groups.owners.map((item) => ({
                  id: item.id,
                  title:
                    item.id === "node:me" && params.viewerOwnerLabel?.trim()
                      ? params.viewerOwnerLabel.trim()
                      : item.title,
                })),
              )}
              ${renderRelatedGroup(
                t("frontstage.workbench.knowledgeUniverse.detail.groupConflicts"),
                groups.conflicts.map((item) => ({ id: item.id, title: item.title })),
              )}
            `
          : neighbors.length
            ? html`
                <div class="knowledge-universe__detail-related">
                  <div class="knowledge-universe__detail-related-title">
                    ${t("frontstage.workbench.knowledgeUniverse.detail.related")}
                  </div>
                  <ul>
                    ${neighbors.map(
                      (node) =>
                        html`<li>${node.title}<span>${relationshipNodeKindLabel(node.kind)}</span></li>`,
                    )}
                  </ul>
                </div>
              `
            : nothing
      }
      ${
        params.personalVersions && params.personalVersions.length > 0
          ? renderVersionTimeline(params.personalVersions)
          : nothing
      }
    </aside>
  `;
}
