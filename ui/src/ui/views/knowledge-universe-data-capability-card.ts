import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  DataCapabilityDescriptor,
  ExternalDataSourceSummary,
  KnowledgeCapabilityInvocationState,
  KnowledgeCapabilityPreviewState,
} from "../capability/knowledge-universe/types.ts";
import { KNOWLEDGE_INDEX_CAPABILITY_ID } from "../capability/knowledge-universe/types.ts";

export type DataCapabilitySpaceProps = {
  capabilities: DataCapabilityDescriptor[];
  externalDataSources: ExternalDataSourceSummary[];
  requestingCapabilityId: string | null;
  accessRequestNotice: string | null;
  onRequestAccess: (capabilityId: string, title: string) => void | Promise<void>;
  capabilityPreview?: KnowledgeCapabilityPreviewState | null;
  onPreviewCapability?: (capabilityId: string) => void | Promise<void>;
  capabilityInvocation?: KnowledgeCapabilityInvocationState | null;
  onInvokeCapability?: (capabilityId: string) => void | Promise<void>;
};

function accessStateLabel(state: DataCapabilityDescriptor["accessState"]) {
  switch (state) {
    case "granted":
      return t("frontstage.workbench.knowledgeUniverse.dataCapabilities.accessGranted");
    case "pending":
      return t("frontstage.workbench.knowledgeUniverse.dataCapabilities.accessPending");
    case "external":
      return t("frontstage.workbench.knowledgeUniverse.dataCapabilities.accessExternal");
    default:
      return t("frontstage.workbench.knowledgeUniverse.dataCapabilities.accessRequestable");
  }
}

function renderCapabilityPreview(
  capability: DataCapabilityDescriptor,
  props: DataCapabilitySpaceProps,
) {
  const preview =
    props.capabilityPreview && props.capabilityPreview.capabilityId === capability.id
      ? props.capabilityPreview
      : null;
  const busy = preview?.busy ?? false;
  return html`
    <div class="knowledge-universe__data-capability-preview">
      <button
        type="button"
        class="btn btn--sm knowledge-universe__data-capability-preview-btn"
        ?disabled=${busy}
        data-testid="ku-capability-preview-btn"
        @click=${() => void props.onPreviewCapability?.(capability.id)}
      >
        ${
          busy
            ? t("frontstage.workbench.knowledgeUniverse.dataCapabilities.previewing")
            : t("frontstage.workbench.knowledgeUniverse.dataCapabilities.previewAction")
        }
      </button>
      ${
        preview?.error
          ? html`<div class="knowledge-universe__data-capability-preview-error" role="alert">
              ${preview.error}
            </div>`
          : nothing
      }
      ${
        preview && !preview.busy && !preview.error
          ? preview.items.length === 0
            ? html`<div class="knowledge-universe__data-capability-preview-empty">
                ${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.previewEmpty")}
              </div>`
            : html`<ul class="knowledge-universe__data-capability-preview-list">
                ${preview.items.map(
                  (item) => html`
                    <li class="knowledge-universe__data-capability-preview-item">
                      <span class="knowledge-universe__data-capability-preview-doc"
                        >${item.docTitle}</span
                      >
                      <span class="knowledge-universe__data-capability-preview-snippet"
                        >${item.snippet}</span
                      >
                    </li>
                  `,
                )}
              </ul>`
          : nothing
      }
    </div>
  `;
}

function invokeFreshnessLabel(freshness: DataCapabilityDescriptor["freshness"]) {
  switch (freshness) {
    case "fresh":
      return t("frontstage.workbench.knowledgeUniverse.dataCapabilities.invokeFreshnessFresh");
    case "stale":
      return t("frontstage.workbench.knowledgeUniverse.dataCapabilities.invokeFreshnessStale");
    default:
      return t("frontstage.workbench.knowledgeUniverse.dataCapabilities.invokeFreshnessUnknown");
  }
}

function renderFreshnessBadge(freshness: DataCapabilityDescriptor["freshness"]) {
  if (freshness === "fresh") {
    return nothing;
  }
  if (freshness === "stale") {
    return html`<span
      class="knowledge-universe__data-capability-card-badge knowledge-universe__data-capability-card-badge--stale"
      title=${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.staleBadgeHint")}
      >${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.staleBadge")}</span
    >`;
  }
  return html`<span
    class="knowledge-universe__data-capability-card-badge knowledge-universe__data-capability-card-badge--unknown"
    title=${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.unknownBadgeHint")}
    >${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.unknownBadge")}</span
  >`;
}

function renderCapabilityInvocation(
  capability: DataCapabilityDescriptor,
  props: DataCapabilitySpaceProps,
) {
  const invocation =
    props.capabilityInvocation && props.capabilityInvocation.capabilityId === capability.id
      ? props.capabilityInvocation
      : null;
  const busy = invocation?.busy ?? false;
  return html`
    <div class="knowledge-universe__data-capability-invoke">
      <button
        type="button"
        class="btn btn--sm knowledge-universe__data-capability-invoke-btn"
        ?disabled=${busy}
        data-testid="ku-capability-invoke-btn"
        @click=${() => void props.onInvokeCapability?.(capability.id)}
      >
        ${
          busy
            ? t("frontstage.workbench.knowledgeUniverse.dataCapabilities.invoking")
            : t("frontstage.workbench.knowledgeUniverse.dataCapabilities.invokeAction")
        }
      </button>
      ${
        invocation?.error
          ? html`<div class="knowledge-universe__data-capability-invoke-error" role="alert">
              ${invocation.error}
            </div>`
          : nothing
      }
      ${
        invocation && !invocation.busy && !invocation.error
          ? invocation.ok && invocation.data
            ? html`<div class="knowledge-universe__data-capability-invoke-result" role="status">
                <div class="knowledge-universe__data-capability-invoke-summary">
                  ${invocation.data.summary}
                </div>
                <div class="knowledge-universe__data-capability-invoke-note">
                  ${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.invokeResultNote")}
                </div>
                ${
                  invocation.data.sourceSystems.length
                    ? html`<div class="knowledge-universe__data-capability-invoke-meta">
                        ${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.invokeSources")}:
                        ${invocation.data.sourceSystems.join(" · ")}
                      </div>`
                    : nothing
                }
                <div class="knowledge-universe__data-capability-invoke-meta">
                  ${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.invokeFreshness")}:
                  ${invokeFreshnessLabel(invocation.data.freshness)}
                </div>
                ${
                  invocation.auditId
                    ? html`<div class="knowledge-universe__data-capability-invoke-audit">
                        ${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.invokeAudit")}:
                        ${invocation.auditId}
                      </div>`
                    : nothing
                }
              </div>`
            : html`<div class="knowledge-universe__data-capability-invoke-denied" role="status">
                ${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.invokeDenied")}${
                  invocation.reason ? html` (${invocation.reason})` : nothing
                }
              </div>`
          : nothing
      }
    </div>
  `;
}

function renderCapabilityCard(
  capability: DataCapabilityDescriptor,
  props: DataCapabilitySpaceProps,
) {
  const requesting =
    props.requestingCapabilityId === capability.id && Boolean(props.requestingCapabilityId);
  return html`
    <article
      class=${`knowledge-universe__data-capability-card knowledge-universe__data-capability-card--${capability.accessState}`}
    >
      <div class="knowledge-universe__data-capability-card-head">
        <div class="knowledge-universe__data-capability-card-title">${capability.title}</div>
        ${
          capability.isSample
            ? html`<span
                class="knowledge-universe__data-capability-card-badge knowledge-universe__data-capability-card-badge--sample"
                >${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.sampleBadge")}</span
              >`
            : nothing
        }
        ${renderFreshnessBadge(capability.freshness)}
        <span class="knowledge-universe__data-capability-card-badge">
          ${accessStateLabel(capability.accessState)}
        </span>
      </div>
      <p class="knowledge-universe__data-capability-card-summary">${capability.summary}</p>
      ${
        capability.scenarios.length
          ? html`
              <div class="knowledge-universe__data-capability-card-scenarios">
                <span>${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.scenarios")}</span>
                <ul>
                  ${capability.scenarios.map((scenario) => html`<li>${scenario}</li>`)}
                </ul>
              </div>
            `
          : nothing
      }
      ${
        capability.sourceSystems.length
          ? html`
              <div class="knowledge-universe__data-capability-card-sources">
                ${capability.sourceSystems.join(" · ")}
              </div>
            `
          : nothing
      }
      ${
        capability.accessState === "requestable"
          ? html`
              <button
                type="button"
                class="btn btn--sm knowledge-universe__data-capability-request"
                ?disabled=${requesting}
                @click=${() => void props.onRequestAccess(capability.id, capability.title)}
              >
                ${
                  requesting
                    ? t("frontstage.workbench.knowledgeUniverse.dataCapabilities.requesting")
                    : t("frontstage.workbench.knowledgeUniverse.dataCapabilities.requestAction")
                }
              </button>
            `
          : capability.accessState === "pending"
            ? html`
                <div class="knowledge-universe__data-capability-pending" role="status">
                  ${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.pendingNotice")}
                </div>
              `
            : nothing
      }
      ${
        capability.id === KNOWLEDGE_INDEX_CAPABILITY_ID && props.onPreviewCapability
          ? renderCapabilityPreview(capability, props)
          : nothing
      }
      ${
        capability.accessState === "granted" &&
        capability.id !== KNOWLEDGE_INDEX_CAPABILITY_ID &&
        props.onInvokeCapability
          ? renderCapabilityInvocation(capability, props)
          : nothing
      }
    </article>
  `;
}

function renderCapabilityGroup(
  heading: string,
  capabilities: DataCapabilityDescriptor[],
  props: DataCapabilitySpaceProps,
) {
  if (!capabilities.length) {
    return nothing;
  }
  return html`
    <div class="knowledge-universe__data-space-group">
      <div class="knowledge-universe__data-space-group-title">${heading}</div>
      <div class="knowledge-universe__data-capabilities-grid">
        ${capabilities.map((capability) => renderCapabilityCard(capability, props))}
      </div>
    </div>
  `;
}

export function renderKnowledgeUniverseDataCapabilitySpace(props: DataCapabilitySpaceProps) {
  const granted = props.capabilities.filter((item) => item.accessState === "granted");
  const pending = props.capabilities.filter((item) => item.accessState === "pending");
  const requestable = props.capabilities.filter((item) => item.accessState === "requestable");
  const externalCapabilities = props.capabilities.filter((item) => item.accessState === "external");
  const hasContent =
    granted.length > 0 ||
    pending.length > 0 ||
    requestable.length > 0 ||
    externalCapabilities.length > 0 ||
    props.externalDataSources.length > 0;

  return html`
    <section class="knowledge-universe__data-space">
      <div class="knowledge-universe__section-heading">
        ${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.spaceHeading")}
      </div>
      ${
        props.accessRequestNotice
          ? html`<div class="knowledge-universe__notice" role="status">${props.accessRequestNotice}</div>`
          : nothing
      }
      ${
        hasContent
          ? nothing
          : html`
              <div class="knowledge-universe__empty knowledge-universe__data-space-empty" role="status">
                ${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.empty")}
              </div>
            `
      }
      ${renderCapabilityGroup(
        t("frontstage.workbench.knowledgeUniverse.dataCapabilities.grantedGroup"),
        granted,
        props,
      )}
      ${renderCapabilityGroup(
        t("frontstage.workbench.knowledgeUniverse.dataCapabilities.pendingGroup"),
        pending,
        props,
      )}
      ${renderCapabilityGroup(
        t("frontstage.workbench.knowledgeUniverse.dataCapabilities.requestableGroup"),
        requestable,
        props,
      )}
      ${renderCapabilityGroup(
        t("frontstage.workbench.knowledgeUniverse.dataCapabilities.externalCapabilityGroup"),
        externalCapabilities,
        props,
      )}
      ${
        props.externalDataSources.length
          ? html`
              <div class="knowledge-universe__data-space-group">
                <div class="knowledge-universe__data-space-group-title">
                  ${t("frontstage.workbench.knowledgeUniverse.dataCapabilities.externalSourcesGroup")}
                </div>
                <ul class="knowledge-universe__external-source-list">
                  ${props.externalDataSources.map(
                    (source) => html`
                      <li class="knowledge-universe__external-source-item">
                        <span class="knowledge-universe__external-source-title">${source.title}</span>
                        <span class="knowledge-universe__external-source-meta">
                          ${source.connectorId} · ${source.status}
                        </span>
                      </li>
                    `,
                  )}
                </ul>
              </div>
            `
          : nothing
      }
    </section>
  `;
}

/** @deprecated Use renderKnowledgeUniverseDataCapabilitySpace */
export function renderKnowledgeUniverseDataCapabilityCards(
  capabilities: DataCapabilityDescriptor[],
) {
  return renderKnowledgeUniverseDataCapabilitySpace({
    capabilities,
    externalDataSources: [],
    requestingCapabilityId: null,
    accessRequestNotice: null,
    onRequestAccess: () => undefined,
  });
}
