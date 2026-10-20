/**
 * 平台端 CostVersion handler（Package V2 Phase 4）。
 */

import {
  activateCostVersion,
  createCostVersionFromCatalog,
  getActiveCostVersion,
  getCostVersion,
  listCostVersions,
} from "../cost-version/cost-version-store.js";
import { respondInvalid, respondUnavailable, stringValue } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

export const platformCostVersionHandlers: GatewayRequestHandlers = {
  "platform-cost-version.overview": async ({ respond }) => {
    try {
      const [versions, active] = await Promise.all([listCostVersions(), getActiveCostVersion()]);
      respond(true, { versions, activeVersion: active });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-cost-version.list": async ({ respond }) => {
    try {
      respond(true, { versions: await listCostVersions() });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-cost-version.get": async ({ params, respond }) => {
    try {
      const versionId = stringValue(params.versionId);
      if (!versionId) {
        respondInvalid(respond, "versionId 是必填项");
        return;
      }
      const version = await getCostVersion(versionId);
      if (!version) {
        respondInvalid(respond, `未找到成本版本：${versionId}`);
        return;
      }
      respond(true, { version });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-cost-version.create-from-catalog": async ({ respond }) => {
    try {
      const version = await createCostVersionFromCatalog();
      respond(true, { version });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-cost-version.activate": async ({ params, respond }) => {
    try {
      const versionId = stringValue(params.versionId);
      if (!versionId) {
        respondInvalid(respond, "versionId 是必填项");
        return;
      }
      const version = await activateCostVersion(versionId);
      if (!version) {
        respondInvalid(respond, `未找到成本版本：${versionId}`);
        return;
      }
      respond(true, { version });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
