import type {
  RuleAdaptationHostView,
  ShadowControlSnapshot,
  ShadowRunRequest,
  ShadowRunResult,
} from "../../contracts/rule-adaptation-shadow.js";
import {
  createGovernedShadowModelPort,
  type GovernedShadowModelPortDeps,
} from "../../model/rule-adaptation/index.js";
/**
 * Thin official host binding for the read-only shadow rule-adaptation entry.
 *
 * An existing host calls this owned entry with an injected limited rule view
 * and injected (non-production) model, governance, and completion ports. It
 * shares model governance through `createGovernedShadowModelPort`, runs
 * `runShadowRuleAdaptation`, and feeds any proposal into
 * `validateRuntimeRuleProposal`. The result is advice only: this binding
 * must not activate policy, persist candidates, write configuration, mutate
 * live tasks, or open execution mode.
 *
 * This directory index is the official entry. Do not re-export from unowned
 * command, model, context, or policy barrels.
 */
import { validateRuntimeRuleProposal } from "../../policy/rule-adaptation/index.js";
import type { ControlledCandidateEntry } from "./candidate-entry.js";
import { emptyControlSnapshot } from "./control-snapshot.js";
import { runShadowRuleAdaptation } from "./run.js";

export type OfficialShadowHostBinding = {
  /** Host-limited rule view and host facts. Do not invent a second catalog. */
  view: RuleAdaptationHostView;
  controlBoard?: ShadowControlSnapshot;
  now?: () => number;
  /**
   * Injected non-production governed model-port dependencies. Callers must
   * supply session ports, config, env, and the completion implementation.
   * This binding does not read production credentials or production config.
   */
  model: GovernedShadowModelPortDeps;
  validate?: typeof validateRuntimeRuleProposal;
  candidateEntry?: ControlledCandidateEntry;
};

export async function runOfficialShadowRuleAdaptation(
  request: ShadowRunRequest,
  binding: OfficialShadowHostBinding,
): Promise<ShadowRunResult> {
  const model = createGovernedShadowModelPort(binding.model);
  return runShadowRuleAdaptation(request, {
    host: {
      view: binding.view,
      controlBoard: binding.controlBoard ?? emptyControlSnapshot(),
      now: binding.now,
    },
    model,
    validate: binding.validate,
    candidateEntry: binding.candidateEntry,
  });
}
