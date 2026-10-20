import { renderWorkspacePanel } from "../../shared/surface.ts";
import type { PlatformPortRenderModel } from "../../view-types.ts";
import type { LegacyPlatformModelsVM as PlatformModelsVM } from "../view-model.ts";

export function renderModelIssueSection(
  vm: PlatformModelsVM,
  actions: PlatformPortRenderModel["surfaceActions"],
) {
  return renderWorkspacePanel({
    title: "模型治理关注项",
    subtitle: "集中查看缺失成本归因、运行版本和模型治理冲突。",
    actionLabel: "刷新治理",
    onAction: () => actions.models.onRefreshPolicies(),
    items: vm.issueItems,
    empty: "当前没有排队中的模型治理关注项。",
  });
}
