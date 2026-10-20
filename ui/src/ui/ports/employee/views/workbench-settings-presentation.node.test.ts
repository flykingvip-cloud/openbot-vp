/**
 * Presentation assertions for collaboration-groups master-detail.
 */

// @vitest-environment jsdom
import { html, render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { wbSettingsDetailToolbar, wbSettingsSection } from "./workbench-settings-layout.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("workbench settings presentation helpers", () => {
  it("renders compact groups toolbar and four flat sections", () => {
    const container = document.createElement("div");
    render(
      html`
        <div class="wb-groups" data-wb-settings-pilot="groups">
          ${wbSettingsDetailToolbar({
            title: "产品研发小组",
            dirty: true,
            actions: html`
              <button type="button" class="btn btn--primary">保存设置</button>
            `,
          })}
          ${wbSettingsSection({
            title: "基本信息",
            content: html`
              <p>basic</p>
            `,
          })}
          ${wbSettingsSection({
            title: "使命",
            wide: true,
            content: html`
              <p>mission</p>
            `,
          })}
          ${wbSettingsSection({
            title: "成员",
            wide: true,
            content: html`
              <p>members</p>
            `,
          })}
          ${wbSettingsSection({
            title: "群治理",
            content: html`
              <div class="wb-groups__governance-grid" data-wb-groups-governance>
                <div class="wb-groups__governance-panel">决策</div>
                <div class="wb-groups__governance-panel">保密与可见</div>
                <div class="wb-groups__governance-panel">协作规则</div>
              </div>
              <div class="wb-groups__danger">危险操作</div>
            `,
          })}
        </div>
      `,
      container,
    );

    expect(container.querySelector("[data-wb-settings-intro]")).toBeNull();
    expect(container.querySelector("[data-wb-settings-toolbar]")).toBeTruthy();
    expect(container.textContent).not.toContain("未保存修改");
    expect(container.textContent).toContain("保存设置");
    expect(
      Array.from(container.querySelectorAll("[data-wb-settings-section]")).map((node) =>
        node.getAttribute("data-wb-settings-section"),
      ),
    ).toEqual(["基本信息", "使命", "成员", "群治理"]);
    expect(container.querySelector("[data-wb-groups-governance]")).toBeTruthy();
    expect(container.querySelectorAll(".wb-groups__governance-panel")).toHaveLength(3);
    expect(container.querySelectorAll(".wb-groups__danger")).toHaveLength(1);
  });

  it("renders robots master-detail without page intro or stats strip", () => {
    const container = document.createElement("div");
    render(
      html`
        <div class="wb-bots" data-wb-settings-pilot="robots">
          <aside class="wb-bots__anchor" aria-label="机器人列表">
            <button type="button" class="wb-bots__row is-active">
              <span class="wb-groups__row-mark">大</span>
              <div class="wb-bots__row-line">
                <span class="wb-bots__row-title">大白管家</span>
                <span class="wb-bots__row-trail">
                  <span class="wb-bots__row-role">可管理</span>
                </span>
              </div>
            </button>
          </aside>
          <div class="wb-bots__stage">
            ${wbSettingsDetailToolbar({
              title: "大白管家",
              actions: html`
                <button type="button" class="btn btn--primary">进入工作区</button>
              `,
            })}
          </div>
        </div>
      `,
      container,
    );

    expect(container.querySelector("[data-wb-settings-pilot='robots']")).toBeTruthy();
    expect(container.querySelector("[data-wb-settings-intro]")).toBeNull();
    expect(container.querySelector("[data-wb-settings-toolbar]")).toBeTruthy();
    expect(container.querySelector("[data-wb-settings-stats]")).toBeNull();
    expect(container.querySelector(".wb-bots__row-line")).toBeTruthy();
    expect(container.textContent).toContain("进入工作区");
  });
});
