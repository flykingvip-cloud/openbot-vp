import { describe, expect, it, vi } from "vitest";
import { createEnterprisePortActions } from "./render-actions.ts";

describe("enterprise organization refresh actions", () => {
  it("routes organization refresh buttons to refreshEnterpriseOrganization", () => {
    const refreshEnterpriseOrganization = vi.fn(async () => undefined);
    const loadOverview = vi.fn(async () => undefined);
    const actionState = {
      refreshEnterpriseOrganization,
      loadOverview,
    } as never;
    const actions = createEnterprisePortActions({
      actionState,
      capabilityState: {} as never,
    });
    void actions.organization.onRefresh();
    void actions.organization.onRefreshUsers();
    void actions.organization.onRefreshTeams();
    void actions.organization.onRefreshRoles();
    expect(refreshEnterpriseOrganization).toHaveBeenCalledTimes(4);
    expect(loadOverview).not.toHaveBeenCalled();
  });
});
