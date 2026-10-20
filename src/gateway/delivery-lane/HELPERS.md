# DeliveryLane helpers (Tip E)

## Quota

`maxLaneHelpers` default **2** (`DEFAULT_LANE_MAX_HELPERS` in `helpers.ts`).

- Config: `gateway.deliveryLane.maxLaneHelpers`
- API: `lane.helper.attach` — 3rd concurrent helper → **REFUSED**
- Depth still follows existing subagent spawn depth (default 1); this tip does **not** claim helpers are independent accept authorities.

## personal_subagent cannot acceptSeal

`acceptSeal.issuer.kind === "personal_subagent"` → **REFUSED** (write + merge re-check via `canPublishLaneAcceptSeal` / `assertPath1DualSealAuthority`).

分身 ≠ 独立验收；本 tip **不**宣布分身满足禁自审自合。

## Flags

Delivery-lane feature flag remains **default OFF**. Tip E does not open orch live / specialty bots / P2 events.
