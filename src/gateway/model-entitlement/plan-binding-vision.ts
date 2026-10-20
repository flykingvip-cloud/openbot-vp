/**
 * 套餐模型绑定中的视觉/OCR 能力校验。
 * 知识库解析走 gateway 默认 image 模型；各套餐 allowedModelIds 须至少含 1 个 vision 模型（通常 Tier A 标配）。
 */

import {
  findModelInCatalog,
  loadModelCatalog,
  modelSupportsVision,
} from "../../agents/model-catalog.js";
import { parseModelRef } from "../../agents/model-selection.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { ModelRef } from "./types.js";

export async function listVisionCapableModelRefs(
  cfg: OpenBotConfig | undefined,
  allowedModelIds: readonly ModelRef[],
): Promise<ModelRef[]> {
  const catalog = await loadModelCatalog({ config: cfg, useCache: true });
  const vision: ModelRef[] = [];
  for (const modelRef of allowedModelIds) {
    const parsed = parseModelRef(modelRef, "");
    if (!parsed?.provider || !parsed.model) {
      continue;
    }
    const entry = findModelInCatalog(catalog, parsed.provider, parsed.model);
    if (modelSupportsVision(entry)) {
      vision.push(modelRef);
    }
  }
  return vision;
}

export async function planBindingIncludesVisionModel(
  cfg: OpenBotConfig | undefined,
  allowedModelIds: readonly ModelRef[],
): Promise<boolean> {
  const vision = await listVisionCapableModelRefs(cfg, allowedModelIds);
  return vision.length > 0;
}

export const PLAN_BINDING_VISION_BLOCKER =
  "套餐可用模型中至少需包含 1 个支持图片识别的视觉模型（Tier A 标配），以保障知识库文档解析。";
