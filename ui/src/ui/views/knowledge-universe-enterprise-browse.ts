import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { KnowledgeObject } from "../capability/knowledge-universe/types.ts";

export type EnterpriseKnowledgeBrowseProps = {
  objects: KnowledgeObject[];
  restrictedObjects: KnowledgeObject[];
  requestingProjectionId: string | null;
  accessRequestNotice: string | null;
  onSelectObject: (objectId: string) => void | Promise<void>;
  onRequestAccess: (projectionId: string, title: string) => void | Promise<void>;
};

function groupLabel(object: KnowledgeObject): string {
  return (
    object.scopeLabel?.trim() ||
    object.tags[0]?.trim() ||
    t("frontstage.workbench.knowledgeUniverse.enterprise.defaultSpace")
  );
}

function renderObjectList(
  objects: KnowledgeObject[],
  props: EnterpriseKnowledgeBrowseProps,
  options: { restricted?: boolean },
) {
  if (!objects.length) {
    return nothing;
  }
  const grouped = new Map<string, KnowledgeObject[]>();
  for (const object of objects) {
    const label = groupLabel(object);
    const bucket = grouped.get(label) ?? [];
    bucket.push(object);
    grouped.set(label, bucket);
  }
  return html`
    <div class="knowledge-universe__enterprise-groups">
      ${[...grouped.entries()].map(
        ([label, groupObjects]) => html`
          <div class="knowledge-universe__enterprise-group">
            <div class="knowledge-universe__enterprise-group-title">${label}</div>
            <ul class="knowledge-universe__browse-list">
              ${groupObjects.map((object) => {
                const projectionId =
                  object.projectionId ?? object.id.replace(/^obj:enterprise:/, "");
                const requesting = props.requestingProjectionId === projectionId;
                return html`
                  <li>
                    ${
                      options.restricted
                        ? html`
                            <article
                              class="knowledge-universe__browse-item knowledge-universe__browse-item--restricted"
                            >
                              <span class="knowledge-universe__browse-item-title">${object.title}</span>
                              <span class="knowledge-universe__browse-item-summary">${object.summary}</span>
                              ${
                                object.maskingSummary
                                  ? html`
                                      <span class="knowledge-universe__browse-item-tags">
                                        ${object.maskingSummary}
                                      </span>
                                    `
                                  : nothing
                              }
                              <button
                                type="button"
                                class="btn btn--sm knowledge-universe__enterprise-request"
                                ?disabled=${requesting}
                                @click=${() =>
                                  void props.onRequestAccess(projectionId, object.title)}
                              >
                                ${
                                  requesting
                                    ? t(
                                        "frontstage.workbench.knowledgeUniverse.enterprise.requesting",
                                      )
                                    : t(
                                        "frontstage.workbench.knowledgeUniverse.enterprise.requestAction",
                                      )
                                }
                              </button>
                            </article>
                          `
                        : html`
                            <button
                              type="button"
                              class="knowledge-universe__browse-item"
                              @click=${() => void props.onSelectObject(object.id)}
                            >
                              <span class="knowledge-universe__browse-item-title">${object.title}</span>
                              <span class="knowledge-universe__browse-item-summary">${object.summary}</span>
                              ${
                                object.maskingSummary
                                  ? html`
                                      <span class="knowledge-universe__browse-item-tags">
                                        ${object.maskingSummary}
                                      </span>
                                    `
                                  : nothing
                              }
                            </button>
                          `
                    }
                  </li>
                `;
              })}
            </ul>
          </div>
        `,
      )}
    </div>
  `;
}

export function renderKnowledgeUniverseEnterpriseBrowse(props: EnterpriseKnowledgeBrowseProps) {
  const hasAccessible = props.objects.length > 0;
  const hasRestricted = props.restrictedObjects.length > 0;
  if (!hasAccessible && !hasRestricted) {
    return html`
      <section id="ku-enterprise" class="knowledge-universe__enterprise-browse">
        <div class="knowledge-universe__section-heading">
          ${t("frontstage.workbench.knowledgeUniverse.enterprise.heading")}
        </div>
        <p class="knowledge-universe__empty-copy">
          ${t("frontstage.workbench.knowledgeUniverse.enterprise.empty")}
        </p>
      </section>
    `;
  }

  return html`
    <section id="ku-enterprise" class="knowledge-universe__enterprise-browse">
      <div class="knowledge-universe__section-heading">
        ${t("frontstage.workbench.knowledgeUniverse.enterprise.heading")}
      </div>
      ${
        props.accessRequestNotice
          ? html`<div class="knowledge-universe__notice" role="status">${props.accessRequestNotice}</div>`
          : nothing
      }
      ${
        hasAccessible
          ? html`
              <div class="knowledge-universe__enterprise-section">
                <div class="knowledge-universe__data-space-group-title">
                  ${t("frontstage.workbench.knowledgeUniverse.enterprise.accessibleGroup")}
                </div>
                ${renderObjectList(props.objects, props, {})}
              </div>
            `
          : nothing
      }
      ${
        hasRestricted
          ? html`
              <div class="knowledge-universe__enterprise-section">
                <div class="knowledge-universe__data-space-group-title">
                  ${t("frontstage.workbench.knowledgeUniverse.enterprise.restrictedGroup")}
                </div>
                ${renderObjectList(props.restrictedObjects, props, { restricted: true })}
              </div>
            `
          : nothing
      }
    </section>
  `;
}
