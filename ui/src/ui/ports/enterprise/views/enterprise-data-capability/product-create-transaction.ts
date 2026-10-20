/**
 * 新建数据产品 Saga（可补偿）：
 * 1) 以 enabled=false 创建产品（不可被运行时消费）
 * 2) 可选：投影规格 + 供给绑定
 * 3) 席位授权（全成或全回滚）
 * 4) 最后再启用产品
 *
 * 任一步失败：撤销本轮授权 → 停用绑定 → 废弃规格 → 归档产品。
 * projectionKey 绑定 capabilityId 短后缀，避免重试撞键。
 */

export type ProductCreateActionRef = {
  connectorId: string;
  actionKey: string;
  version: string;
};

export type ProductCreateSagaInput = {
  capabilityKey: string;
  displayName: string;
  description: string;
  sourceIds: string[];
  actionRefs: ProductCreateActionRef[];
  enabled: boolean;
  outputMode: "direct" | "projection";
  projectionTemplateKey: string;
  seatIds: string[];
};

export type ProductCreateSagaGateway = {
  upsertCapability: (
    tenantId: string,
    payload: {
      capabilityId?: string;
      capabilityKey: string;
      displayName: string;
      description: string;
      sourceIds: string[];
      actionRefs: ProductCreateActionRef[];
      enabled: boolean;
    },
  ) => Promise<
    | { ok: true; data: { capabilityId: string; capabilityKey: string; displayName: string } }
    | { ok: false; error: string }
  >;
  archiveCapability: (
    tenantId: string,
    capabilityId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  upsertProjectionSpec: (
    tenantId: string,
    payload: {
      projectionId?: string;
      projectionKey: string;
      displayName: string;
      category: string;
      objectKind: string;
      templateKey: string;
      lifecycle: string;
      sourceActions: ProductCreateActionRef[];
      capabilityId?: string;
      description?: string;
    },
  ) => Promise<{ ok: true; data: { projectionId: string } } | { ok: false; error: string }>;
  upsertProjectionBinding: (
    tenantId: string,
    payload: {
      bindingId?: string;
      projectionId: string;
      materializationMode: string;
      materializationTeamLabel: string;
      generatorVersion: string;
      capabilityId?: string;
      enabled: boolean;
    },
  ) => Promise<{ ok: true; data: { bindingId: string } } | { ok: false; error: string }>;
  grantCapabilityToSeat: (
    tenantId: string,
    payload: { seatId: string; capabilityId: string },
  ) => Promise<{ ok: true; data: { grantCount: number } } | { ok: false; error: string }>;
  getCapabilityGovernanceView: (
    tenantId: string,
    capabilityId: string,
  ) => Promise<
    | {
        ok: true;
        data: {
          accessScope: {
            activeGrants: Array<{ grantId: string; seatId: string; revokedAt?: string }>;
          };
        };
      }
    | { ok: false; error: string }
  >;
  revokeSeatActionGrant: (
    tenantId: string,
    grantId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export type ProductCreateSagaSuccess = {
  ok: true;
  capabilityId: string;
  notices: string[];
};

export type ProductCreateSagaFailure = {
  ok: false;
  error: string;
  compensated: boolean;
  capabilityId: string | null;
};

type CreatedArtifacts = {
  capabilityId: string | null;
  projectionId: string | null;
  projectionKey: string | null;
  bindingId: string | null;
  primaryAction: ProductCreateActionRef | null;
  templateKey: string | null;
  displayName: string | null;
  description: string;
  grantedSeatIds: string[];
};

async function revokeSagaSeatGrants(
  gateway: ProductCreateSagaGateway,
  tenantId: string,
  capabilityId: string,
  seatIds: readonly string[],
): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  if (seatIds.length === 0) {
    return { ok: true, notes };
  }
  const view = await gateway.getCapabilityGovernanceView(tenantId, capabilityId);
  if (!view.ok) {
    return { ok: false, notes: [`读取授权失败：${view.error}`] };
  }
  const seatSet = new Set(seatIds);
  let failed = false;
  for (const grant of view.data.accessScope.activeGrants) {
    if (!seatSet.has(grant.seatId) || grant.revokedAt) {
      continue;
    }
    const revoked = await gateway.revokeSeatActionGrant(tenantId, grant.grantId);
    if (revoked.ok) {
      notes.push("已撤销岗位授权");
    } else {
      failed = true;
      notes.push(`撤销岗位授权失败：${revoked.error}`);
    }
  }
  return { ok: !failed, notes };
}

async function compensateCreatedProduct(
  gateway: ProductCreateSagaGateway,
  tenantId: string,
  artifacts: CreatedArtifacts,
): Promise<{ compensated: boolean; notes: string[] }> {
  const notes: string[] = [];
  let compensated = true;

  if (artifacts.capabilityId && artifacts.grantedSeatIds.length > 0) {
    const revoked = await revokeSagaSeatGrants(
      gateway,
      tenantId,
      artifacts.capabilityId,
      artifacts.grantedSeatIds,
    );
    notes.push(...revoked.notes);
    if (!revoked.ok) {
      compensated = false;
    }
  }

  if (artifacts.bindingId && artifacts.projectionId) {
    const disabled = await gateway.upsertProjectionBinding(tenantId, {
      bindingId: artifacts.bindingId,
      projectionId: artifacts.projectionId,
      materializationMode: "on_demand",
      materializationTeamLabel: "default",
      generatorVersion: "v1",
      capabilityId: artifacts.capabilityId ?? undefined,
      enabled: false,
    });
    if (disabled.ok) {
      notes.push("已停用供给绑定");
    } else {
      compensated = false;
      notes.push(`停用绑定失败：${disabled.error}`);
    }
  }

  if (artifacts.projectionId && artifacts.projectionKey && artifacts.primaryAction) {
    const deprecated = await gateway.upsertProjectionSpec(tenantId, {
      projectionId: artifacts.projectionId,
      projectionKey: artifacts.projectionKey,
      displayName: `${artifacts.displayName ?? "产品"} 输出`,
      category: "customer",
      objectKind: "data",
      templateKey: artifacts.templateKey ?? "NormalizeTemplate",
      lifecycle: "deprecated",
      sourceActions: [artifacts.primaryAction],
      capabilityId: artifacts.capabilityId ?? undefined,
      description: artifacts.description || undefined,
    });
    if (deprecated.ok) {
      notes.push("已废弃输出规格");
    } else {
      compensated = false;
      notes.push(`废弃规格失败：${deprecated.error}`);
    }
  }

  if (artifacts.capabilityId) {
    const archived = await gateway.archiveCapability(tenantId, artifacts.capabilityId);
    if (archived.ok) {
      notes.push("已归档未启用的数据产品");
    } else {
      compensated = false;
      notes.push(`归档产品失败：${archived.error}`);
    }
  }

  return { compensated, notes };
}

async function failAndCompensate(
  gateway: ProductCreateSagaGateway,
  tenantId: string,
  artifacts: CreatedArtifacts,
  reason: string,
): Promise<ProductCreateSagaFailure> {
  const rolled = await compensateCreatedProduct(gateway, tenantId, artifacts);
  return {
    ok: false,
    error: `${reason}。已回滚：${rolled.notes.join("；") || "无"}`,
    compensated: rolled.compensated,
    capabilityId: artifacts.capabilityId,
  };
}

export async function runProductCreateSaga(
  gateway: ProductCreateSagaGateway,
  tenantId: string,
  input: ProductCreateSagaInput,
): Promise<ProductCreateSagaSuccess | ProductCreateSagaFailure> {
  const artifacts: CreatedArtifacts = {
    capabilityId: null,
    projectionId: null,
    projectionKey: null,
    bindingId: null,
    primaryAction: null,
    templateKey: null,
    displayName: input.displayName,
    description: input.description,
    grantedSeatIds: [],
  };

  // 关键以禁用态创建，避免半成品被运行时消费。
  const capabilityResult = await gateway.upsertCapability(tenantId, {
    capabilityKey: input.capabilityKey,
    displayName: input.displayName,
    description: input.description,
    sourceIds: input.sourceIds,
    actionRefs: input.actionRefs,
    enabled: false,
  });
  if (!capabilityResult.ok) {
    return {
      ok: false,
      error: capabilityResult.error,
      compensated: true,
      capabilityId: null,
    };
  }
  artifacts.capabilityId = capabilityResult.data.capabilityId;
  const notices: string[] = [];

  if (input.outputMode === "projection") {
    if (input.actionRefs.length === 0 || !input.projectionTemplateKey.trim()) {
      return failAndCompensate(gateway, tenantId, artifacts, "输出定义不完整");
    }
    const primary = input.actionRefs[0];
    artifacts.primaryAction = primary;
    artifacts.templateKey = input.projectionTemplateKey.trim();
    const projectionKey = `${input.capabilityKey}_output_${artifacts.capabilityId.slice(0, 8)}`;
    artifacts.projectionKey = projectionKey;

    const specResult = await gateway.upsertProjectionSpec(tenantId, {
      projectionKey,
      displayName: `${input.displayName} 输出`,
      category: "customer",
      objectKind: "data",
      templateKey: artifacts.templateKey,
      lifecycle: "active",
      sourceActions: [primary],
      capabilityId: artifacts.capabilityId,
      description: input.description || undefined,
    });
    if (!specResult.ok) {
      return failAndCompensate(
        gateway,
        tenantId,
        artifacts,
        `输出规格创建失败：${specResult.error}`,
      );
    }
    artifacts.projectionId = specResult.data.projectionId;

    const bindingResult = await gateway.upsertProjectionBinding(tenantId, {
      projectionId: artifacts.projectionId,
      materializationMode: "on_demand",
      materializationTeamLabel: "default",
      generatorVersion: "v1",
      capabilityId: artifacts.capabilityId,
      enabled: true,
    });
    if (!bindingResult.ok) {
      return failAndCompensate(
        gateway,
        tenantId,
        artifacts,
        `供给绑定失败：${bindingResult.error}`,
      );
    }
    artifacts.bindingId = bindingResult.data.bindingId;
    notices.push(
      "已创建输出规格并完成供给绑定。请到「输出与物化」点击「立即物化」，知识宇宙才会出现供给记录。",
    );
  } else if (input.outputMode === "direct") {
    notices.push("未创建供给记录。知识宇宙不会出现可消费内容。");
  }

  if (input.seatIds.length > 0) {
    let granted = 0;
    let totalActions = 0;
    const failures: string[] = [];
    for (const seatId of input.seatIds) {
      const grant = await gateway.grantCapabilityToSeat(tenantId, {
        seatId,
        capabilityId: artifacts.capabilityId,
      });
      if (grant.ok) {
        granted += 1;
        totalActions += grant.data.grantCount;
        artifacts.grantedSeatIds.push(seatId);
      } else {
        failures.push(grant.error);
        break;
      }
    }
    if (failures.length > 0) {
      return failAndCompensate(
        gateway,
        tenantId,
        artifacts,
        `开放授权未全部成功（${failures.join("；")}）`,
      );
    }
    notices.push(`已为 ${granted} 个席位授权（共 ${totalActions} 个运行时动作）。`);
  }

  // 全部步骤成功后再启用（若调用方要求启用）。
  if (input.enabled) {
    const enableResult = await gateway.upsertCapability(tenantId, {
      capabilityId: artifacts.capabilityId,
      capabilityKey: input.capabilityKey,
      displayName: input.displayName,
      description: input.description,
      sourceIds: input.sourceIds,
      actionRefs: input.actionRefs,
      enabled: true,
    });
    if (!enableResult.ok) {
      return failAndCompensate(gateway, tenantId, artifacts, `产品启用失败：${enableResult.error}`);
    }
  }

  notices.unshift(input.enabled ? "数据产品已创建并启用。" : "数据产品已创建（未启用）。");
  return {
    ok: true,
    capabilityId: artifacts.capabilityId,
    notices,
  };
}
