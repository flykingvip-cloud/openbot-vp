// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { renderEnterpriseKpiGrid } from "./enterprise-kpi-card.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("renderEnterpriseKpiGrid tone / interactive / trend / active", () => {
  it("maps tone='warn' to the is-warn class on the card root", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(renderEnterpriseKpiGrid([{ label: "告警", value: "3", tone: "warn" }]), container);

    const card = container.querySelector(".enterprise-kpi-card");
    expect(card).not.toBeNull();
    expect(card?.classList.contains("is-warn")).toBe(true);
  });

  it("renders no is-* tone class for tone='neutral' or an omitted tone", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderEnterpriseKpiGrid([
        { label: "中性", value: "1", tone: "neutral" },
        { label: "缺省", value: "2" },
      ]),
      container,
    );

    const cards = container.querySelectorAll(".enterprise-kpi-card");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      const toneClass = [...card.classList].find((cls) => cls.startsWith("is-"));
      expect(toneClass).toBeUndefined();
    }
  });

  it("renders an interactive <a> with a drilldown arrow when href is provided", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(renderEnterpriseKpiGrid([{ label: "下钻", value: "9", href: "/employees" }]), container);

    const anchor = container.querySelector("a.enterprise-kpi-card");
    expect(anchor).not.toBeNull();
    expect(anchor?.tagName).toBe("A");
    expect(anchor?.classList.contains("enterprise-card--interactive")).toBe(true);
    expect(anchor?.querySelector(".enterprise-kpi-card__arrow")).not.toBeNull();
  });

  it("dual-encodes trend with both an svg icon and the trend label text", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderEnterpriseKpiGrid([
        {
          label: "环比",
          value: "12%",
          trend: { direction: "up", label: "+12%", tone: "ok" },
        },
      ]),
      container,
    );

    const trend = container.querySelector(".enterprise-kpi-card__trend");
    expect(trend).not.toBeNull();
    // Direction is conveyed by an <svg> icon (not color-only)...
    const icon = trend?.querySelector(".enterprise-kpi-card__trend-icon svg");
    expect(icon).not.toBeNull();
    // ...alongside the textual trend label.
    expect(trend?.textContent).toContain("+12%");
  });

  it("renders a static <div> without interactive class or arrow when href is absent", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(renderEnterpriseKpiGrid([{ label: "静态", value: "5" }]), container);

    const card = container.querySelector(".enterprise-kpi-card");
    expect(card).not.toBeNull();
    expect(card?.tagName).toBe("DIV");
    expect(container.querySelector("a")).toBeNull();
    expect(card?.classList.contains("enterprise-card--interactive")).toBe(false);
    expect(card?.querySelector(".enterprise-kpi-card__arrow")).toBeNull();
  });

  it("renders compact variant as a two-row card with head + value", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderEnterpriseKpiGrid(
        [{ label: "空岗岗位", value: "2", href: "/org", icon: "user", tone: "danger" }],
        { variant: "compact" },
      ),
      container,
    );

    const card = container.querySelector(".enterprise-kpi-card--compact");
    expect(card).not.toBeNull();
    expect(card?.querySelector(".enterprise-kpi-card__head")).not.toBeNull();
    expect(card?.querySelector(".enterprise-kpi-card__detail")).toBeNull();
    expect(card?.querySelector(".enterprise-kpi-card__arrow")).not.toBeNull();
  });
});
