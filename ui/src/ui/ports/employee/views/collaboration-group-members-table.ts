/**
 * Phase 3 — 协作小组成员表：身份 / 职责 / 贡献度 / 最近活跃
 */

import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../../../format.ts";
import type { CollaborationGroupMemberProjection } from "../semantic/collaboration-group-read-model.ts";

function kindLabel(kind: CollaborationGroupMemberProjection["kind"]): string {
  return kind === "bot" ? "机器人" : "人类";
}

function formatContribution(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  // v2 is an independent 0–100 score (not raw session %).
  return String(value);
}

function formatLastActive(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "—";
  }
  return formatRelativeTimestamp(value);
}

export function renderCollaborationGroupMembersTable(
  members: CollaborationGroupMemberProjection[],
) {
  if (members.length === 0) {
    return html`
      <p class="employee-workbench__settings-section-subtitle">暂无活跃成员。</p>
    `;
  }
  return html`
    <div class="employee-workbench__group-members-table-wrap">
      <table class="employee-workbench__group-members-table">
        <colgroup>
          <col class="employee-workbench__group-members-col--member" />
          <col class="employee-workbench__group-members-col--identity" />
          <col class="employee-workbench__group-members-col--duty" />
          <col class="employee-workbench__group-members-col--score" />
          <col class="employee-workbench__group-members-col--active" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">成员</th>
            <th scope="col">身份</th>
            <th scope="col">职责</th>
            <th scope="col">贡献度</th>
            <th scope="col">最近活跃</th>
          </tr>
        </thead>
        <tbody>
          ${members.map(
            (member) => html`
              <tr data-member-id=${member.memberId} data-kind=${member.kind}>
                <td>
                  <div class="employee-workbench__group-members-name">
                    <strong>${member.name}</strong>
                    <span class="employee-workbench__group-members-kind"
                      >${kindLabel(member.kind)}</span
                    >
                  </div>
                </td>
                <td>
                  <span class="employee-workbench__group-members-pill"
                    >${member.identity || "—"}</span
                  >
                </td>
                <td>${member.duty || "—"}</td>
                <td class="employee-workbench__group-members-num">
                  ${formatContribution(member.contribution)}
                </td>
                <td class="employee-workbench__group-members-muted">
                  ${formatLastActive(member.lastActiveAt)}
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

export function renderCollaborationGroupMembersEmptyHint() {
  return nothing;
}
