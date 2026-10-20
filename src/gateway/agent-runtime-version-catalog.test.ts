import { describe, expect, it } from "vitest";
import {
  assessCapabilityUpgrade,
  listCapabilityVersionCatalog,
  UPGRADE_REASON_ALREADY,
  UPGRADE_REASON_NOT_NEWER,
  UPGRADE_REASON_SEMVER,
  UPGRADE_REASON_UNKNOWN,
} from "./agent-runtime-version-catalog.js";

describe("capability version catalog", () => {
  it("unions binding versions with eligible registry versions", () => {
    const catalog = listCapabilityVersionCatalog({
      bindings: [
        { capabilityId: "cap-1", capabilityVersion: "1.0.0" },
        { capabilityId: "cap-1", capabilityVersion: "1.2.0" },
      ],
      registry: [
        { capabilityId: "cap-1", version: "1.3.0", lifecycleState: "active" },
        { capabilityId: "cap-1", version: "0.9.0", lifecycleState: "retired" },
        { capabilityId: "cap-2", version: "2.0.0", lifecycleState: "approved" },
      ],
    });
    expect(catalog).toEqual([
      {
        capabilityId: "cap-1",
        version: "1.3.0",
        sources: ["registry"],
        registryLifecycle: "active",
        eligible: true,
      },
      {
        capabilityId: "cap-1",
        version: "1.2.0",
        sources: ["binding"],
        registryLifecycle: null,
        eligible: true,
      },
      {
        capabilityId: "cap-1",
        version: "1.0.0",
        sources: ["binding"],
        registryLifecycle: null,
        eligible: true,
      },
      {
        capabilityId: "cap-1",
        version: "0.9.0",
        sources: ["registry"],
        registryLifecycle: "retired",
        eligible: false,
      },
      {
        capabilityId: "cap-2",
        version: "2.0.0",
        sources: ["registry"],
        registryLifecycle: "approved",
        eligible: true,
      },
    ]);
  });

  it("keeps a running binding version eligible when the registry marks it retired", () => {
    const catalog = listCapabilityVersionCatalog({
      bindings: [{ capabilityId: "cap-1", capabilityVersion: "1.4.0" }],
      registry: [{ capabilityId: "cap-1", version: "1.4.0", lifecycleState: "deprecated" }],
    });
    expect(catalog[0]).toMatchObject({
      sources: ["binding", "registry"],
      registryLifecycle: "deprecated",
      eligible: true,
    });
  });

  it("rejects unknown, same, older, non-semver, and inactive registry targets", () => {
    const catalog = listCapabilityVersionCatalog({
      bindings: [
        { capabilityId: "cap-1", capabilityVersion: "1.2.0" },
        { capabilityId: "cap-1", capabilityVersion: "latest" },
      ],
      registry: [
        { capabilityId: "cap-1", version: "1.3.0", lifecycleState: "active" },
        { capabilityId: "cap-1", version: "2.0.0", lifecycleState: "draft" },
      ],
    });
    expect(
      assessCapabilityUpgrade({
        capabilityId: "cap-1",
        currentVersion: "1.2.0",
        targetVersion: "9.9.9",
        catalog,
      }),
    ).toEqual({ ok: false, reason: UPGRADE_REASON_UNKNOWN });
    expect(
      assessCapabilityUpgrade({
        capabilityId: "cap-1",
        currentVersion: "1.2.0",
        targetVersion: "1.3.0",
        catalog,
      }),
    ).toEqual({ ok: true });
    expect(
      assessCapabilityUpgrade({
        capabilityId: "cap-1",
        currentVersion: "1.2.0",
        targetVersion: "1.2.0",
        catalog,
      }),
    ).toEqual({ ok: false, reason: UPGRADE_REASON_ALREADY });
    const older = assessCapabilityUpgrade({
      capabilityId: "cap-1",
      currentVersion: "1.2.0",
      targetVersion: "1.0.0",
      catalog: listCapabilityVersionCatalog({
        bindings: [
          { capabilityId: "cap-1", capabilityVersion: "1.2.0" },
          { capabilityId: "cap-1", capabilityVersion: "1.0.0" },
        ],
        registry: [],
      }),
    });
    expect(older).toEqual({ ok: false, reason: UPGRADE_REASON_NOT_NEWER });
    expect(
      assessCapabilityUpgrade({
        capabilityId: "cap-1",
        currentVersion: "1.2.0",
        targetVersion: "latest",
        catalog,
      }),
    ).toEqual({ ok: false, reason: UPGRADE_REASON_SEMVER });
    expect(
      assessCapabilityUpgrade({
        capabilityId: "cap-1",
        currentVersion: "1.2.0",
        targetVersion: "2.0.0",
        catalog,
      }).reason,
    ).toBe("incompatible: registry lifecycle is draft");
    expect(
      assessCapabilityUpgrade({
        capabilityId: "cap-1",
        currentVersion: "1.2.0-beta.1",
        targetVersion: "1.2.0",
        catalog: listCapabilityVersionCatalog({
          bindings: [{ capabilityId: "cap-1", capabilityVersion: "1.2.0-beta.1" }],
          registry: [{ capabilityId: "cap-1", version: "1.2.0", lifecycleState: "active" }],
        }),
      }),
    ).toEqual({ ok: true });
  });
});
