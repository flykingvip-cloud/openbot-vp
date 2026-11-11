import { html, nothing } from "lit";
import type { ActionIntent } from "../../../../src/observation/action-intent.js";
import { projectVerificationReceipt } from "./access-state.ts";
import { actionIntentModel } from "./action-intent-model.ts";
export function renderActionIntent(intent: ActionIntent | null, now: number) {
  const model = actionIntentModel(intent, now);
  const record = model.state ? model.intent : null;
  const verification = projectVerificationReceipt(intent?.verification);
  return html`<section aria-label="改善动作关联记录"><h3>改善动作 · ${model.label}</h3><p>只读关联；已受理、执行中、已生效、已验证分别核实。</p>
  ${record ? html`<p>记录：${record.actionIntentId} · ${model.state}</p><p>来源：${record.findingRef.source} · ${record.evidence.environment}/${record.evidence.provenance}${record.evidence.environment === "test" ? " · 测试证据，非生产验证" : ""}</p><p>目标：${record.target.controlPlane}/${record.target.targetId} · 期望版本：${record.target.expectedConfigVersion} · diff：${record.target.diffDigest}</p><p>控制面回执：${record.receipts.at(-1)?.status ?? "未知"} · 实际版本：${record.readback?.actualVersion ?? "未知"}</p><p>验证回执：${verification.label}${record.verification?.verificationId ? ` · ${record.verification.verificationId}` : ""} · 回滚点：${record.target.rollbackPointRef}</p>` : html`<p>${model.reason}</p>${intent?.verification ? html`<p>验证回执：${verification.label}</p>` : nothing}`}
  <p>回滚回执：${record?.rollback?.receipt.receiptId ?? "未知"} · 回滚实际版本：${record?.rollback?.readback.actualVersion ?? "未知"}</p>
  <p>授权状态：${model.authorization}</p><p>受理回执不等于实际生效；配置回读不等于改善已验证。合格验证回执也不得作为晋升或成功改善依据。所有动作仍由既有控制面负责。</p></section>`;
}
