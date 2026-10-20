// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import "./model-authorization-section.ts";
import type { ModelAuthorizationSection } from "./model-authorization-section.ts";

type FakeClient = {
  request: ReturnType<typeof vi.fn>;
};

function fakeClient(handlers: Record<string, (params: unknown) => unknown>): FakeClient {
  return {
    request: vi.fn((method: string, params: unknown) => {
      const h = handlers[method];
      if (!h) {
        throw new Error(`unexpected method ${method}`);
      }
      return Promise.resolve(h(params));
    }),
  };
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("<model-authorization-section> (browser)", () => {
  it("loads grants and renders the panel with subjects", async () => {
    const client = fakeClient({
      "enterprise-model-grant.list": () => ({
        entitlement: { tenantId: "t", allowedModelIds: ["p/a", "p/b"], updatedAt: "x" },
        allowedModelIds: ["p/a", "p/b"],
        grants: [
          {
            tenantId: "t",
            subjectType: "seat",
            subjectId: "seat-1",
            grantedModelIds: ["p/a"],
            status: "active",
            updatedAt: "x",
          },
        ],
      }),
    });
    const el = document.createElement("model-authorization-section") as ModelAuthorizationSection;
    el.client = client as never;
    el.enterpriseId = "t";
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;
    const text = el.textContent ?? "";
    expect(text).toContain("模型授权");
    expect(text).toContain("seat-1");
    expect(client.request).toHaveBeenCalledWith("enterprise-model-grant.list", {
      enterpriseId: "t",
    });
  });

  it("toggling a model issues a grant with the updated set and reloads", async () => {
    let grantCall: unknown = null;
    const client = fakeClient({
      "enterprise-model-grant.list": () => ({
        entitlement: { tenantId: "t", allowedModelIds: ["p/a", "p/b"], updatedAt: "x" },
        allowedModelIds: ["p/a", "p/b"],
        grants: [
          {
            tenantId: "t",
            subjectType: "seat",
            subjectId: "seat-1",
            grantedModelIds: ["p/a"],
            status: "active",
            updatedAt: "x",
          },
        ],
      }),
      "enterprise-model-grant.grant": (params) => {
        grantCall = params;
        return { grant: {} };
      },
    });
    const el = document.createElement("model-authorization-section") as ModelAuthorizationSection;
    el.client = client as never;
    el.enterpriseId = "t";
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;
    const checkboxes = el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    // p/b currently ungranted -> toggle on
    const pb = [...checkboxes].find((c) => !c.checked)!;
    pb.checked = true;
    pb.dispatchEvent(new Event("change"));
    await flush();
    expect(grantCall).toMatchObject({
      enterpriseId: "t",
      subjectType: "seat",
      subjectId: "seat-1",
    });
    expect((grantCall as { grantedModelIds: string[] }).grantedModelIds.toSorted()).toEqual([
      "p/a",
      "p/b",
    ]);
  });

  it("uses the org roster as the directory and previews the selected seat", async () => {
    const client = fakeClient({
      "enterprise-model-grant.list": () => ({
        entitlement: { tenantId: "t-org", allowedModelIds: ["p/a"], updatedAt: "x" },
        allowedModelIds: ["p/a"],
        ceilingModelIds: ["p/a"],
        grants: [
          {
            tenantId: "t-org",
            subjectType: "seat",
            subjectId: "seat-1",
            grantedModelIds: ["p/a"],
            status: "active",
            updatedAt: "x",
          },
        ],
      }),
      "enterprise-model-grant.grant": () => ({ grant: {} }),
    });
    const el = document.createElement("model-authorization-section") as ModelAuthorizationSection;
    el.client = client as never;
    el.enterpriseId = "t-org";
    el.embedded = true;
    el.orgRoster = {
      departmentPaths: [],
      seats: [
        {
          seatId: "seat-1",
          title: "Sales Lead",
          teamLabel: "销售一组",
          status: "occupied",
          roleCode: "OPS-L2-001",
          occupantLabel: "Owner",
          occupantUser: "owner@example.com",
        },
        {
          seatId: "seat-2",
          title: "空岗助理",
          teamLabel: "销售一组",
          status: "vacant",
          roleCode: null,
          occupantLabel: null,
          occupantUser: null,
        },
      ],
      members: [
        {
          user: "owner@example.com",
          displayLabel: "Owner",
          membershipRole: "enterprise-admin",
          status: "active",
          seatTitle: "Sales Lead",
          seatTeamLabel: "销售一组",
        },
      ],
    };
    document.body.appendChild(el);
    await flush();
    await el.updateComplete;
    expect(el.textContent ?? "").not.toContain("新增授权主体");
    expect(el.querySelector(".model-auth-directory__hint")).toBeNull();
    const department = el.querySelector("details.enterprise-org-tree__team");
    expect(department).not.toBeNull();
    expect(el.querySelector("[data-org-seat-id='seat-1']")?.textContent).toContain("Owner");
    expect(el.querySelector("[data-org-seat-id='seat-1']")?.textContent).toContain("Sales Lead");
    const vacant = el.querySelector(
      "[data-org-seat-id='seat-2'] .enterprise-org-tree__label--button",
    ) as HTMLButtonElement;
    vacant.click();
    await el.updateComplete;
    const preview = el.querySelector("[data-testid='model-auth-preview']");
    const title = preview?.querySelector(".model-auth-preview__title");
    expect(title?.textContent).toContain("空岗助理");
    expect(title?.textContent).not.toContain("seat-2");
    expect(title?.getAttribute("title")).toContain("seat-2");
    expect(preview?.textContent).toContain("尚未授权");
    expect(preview?.querySelector("details.model-auth-preview__meta")?.hasAttribute("open")).toBe(
      false,
    );
    const checkbox = preview?.querySelector("input[type='checkbox']") as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    await flush();
    expect(client.request).toHaveBeenCalledWith(
      "enterprise-model-grant.grant",
      expect.objectContaining({
        subjectType: "seat",
        subjectId: "seat-2",
        grantedModelIds: ["p/a"],
      }),
    );
  });
});
