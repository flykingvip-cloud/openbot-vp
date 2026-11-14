import type { RuntimeRuleAdaptationReadBinding } from "../../contracts/rule-adaptation-activation.js";
/**
 * Independent fixture resolution port for P4 personal-scenario test wiring.
 *
 * The host supplies a trusted test identity and session binding; this port
 * checks that binding against the on-disk TaskBoardScope, then calls the
 * official read entry `readActivatedRuntimeRulePolicy`.
 *
 * Not a production reader. Do not use this from the default embedded run.
 * Do not reverse-prove caller identity from the on-disk scope.
 * A personal task may still belong to an enterprise (tenantId may be present).
 */
import {
  createFixturePersonalContextCapPort,
  type ContextCapSelectionMode,
  type PersonalContextCapSelectionPort,
} from "../../model/rule-adaptation/index.js";
import { readRuntimeRuleAdaptationBoard } from "../../state/mutations/runtime-rule-adaptation.js";
import { readActivatedRuntimeRulePolicy, type ActivationHostDependencies } from "./activate.js";

export function createOfficialFixtureContextCapPort(params: {
  mode: ContextCapSelectionMode;
  readBinding: RuntimeRuleAdaptationReadBinding;
  deps: ActivationHostDependencies;
}): PersonalContextCapSelectionPort {
  const boardIo = params.deps.boardIo;
  const onDiskBoardScope = readRuntimeRuleAdaptationBoard(params.deps.sessionFile, boardIo).scope;
  return createFixturePersonalContextCapPort({
    mode: params.mode,
    readBinding: params.readBinding,
    onDiskBoardScope,
    read: (binding) => readActivatedRuntimeRulePolicy(binding, params.deps),
  });
}
