import { html, nothing } from "lit";
import type { WorkbenchStageConversationContract } from "./workbench-stage-contracts.ts";

export function renderConversationStageShell(contract: WorkbenchStageConversationContract) {
  if (!contract.chatContent) {
    return null;
  }
  return html`
    <section class="chat">
      ${contract.progressStrip ?? nothing}
      ${contract.chatContent}
      ${contract.chatComposer}
    </section>
  `;
}
