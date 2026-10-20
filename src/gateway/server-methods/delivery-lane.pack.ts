/**
 * DeliveryLane — gateway method pack (Tip A–F).
 */

import { deliveryLaneHandlers } from "./delivery-lane.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const READ_METHODS = [
  "lane.get",
  "lane.focus",
  "lane.template.list",
  "lane.status",
  "lane.event.observeShadow",
] as const;

const WRITE_METHODS = [
  "lane.attach",
  "lane.setMode",
  "lane.seal",
  "lane.sealFromHandoff",
  "lane.requestMergeReady",
  "lane.requestMerge",
  "lane.helper.attach",
  "lane.helper.detach",
  "lane.event.apply",
] as const;

const METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;

export const deliveryLanePack = defineGatewayMethodPack({
  id: "delivery-lane",
  methods: METHODS,
  scopes: {
    "operator.read": READ_METHODS,
    "operator.write": WRITE_METHODS,
  },
  handlers: deliveryLaneHandlers,
});
