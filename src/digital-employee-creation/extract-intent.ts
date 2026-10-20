/**
 * D1 — deterministic Intent extraction. No LLM, no role pick, no skill invention.
 */

import type { EmployeeDesignIntent } from "./types.js";

const SCHEDULE_RE = /(每天|每周一|每周[一二三四五六日天]?|每月)/;
const DELIVERY_RE = /(销售周报|每周报告|市场报告|周报|日报|总结|报告)/;

function splitClauses(raw: string): string[] {
  return raw
    .split(/[，。；;,\n]|以及|并且|还要/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function extractDesignIntent(rawRequest: string): EmployeeDesignIntent {
  const clauses = splitClauses(rawRequest);
  const policyRequirements: string[] = [];
  const constraints: string[] = [];
  const desiredOutcomes: string[] = [];
  const responsibilities: string[] = [];

  for (const clause of clauses) {
    if (clause.startsWith("tag.skill:")) {
      desiredOutcomes.push(`skill:${clause.slice("tag.skill:".length).trim()}`);
      continue;
    }
    if (clause.startsWith("tag.mode:")) {
      responsibilities.push(`mode:${clause.slice("tag.mode:".length).trim()}`);
      continue;
    }
    if (clause.startsWith("tag.policy:")) {
      policyRequirements.push(`policy:${clause.slice("tag.policy:".length).trim()}`);
      continue;
    }
    if (/不能改|只读|不得修改/.test(clause)) {
      policyRequirements.push(clause);
      constraints.push(clause);
      continue;
    }
    if (/发布|公众号|发信/.test(clause)) {
      policyRequirements.push(clause);
    }
    if (/负责|跟进|监控|分析|处理|审查|对账|看销售|看\s*CRM/.test(clause)) {
      responsibilities.push(clause);
    }
    if (/周报|总结|报告|提醒/.test(clause)) {
      desiredOutcomes.push(clause);
    }
  }

  const schedule = rawRequest.match(SCHEDULE_RE)?.[1];
  const delivery = rawRequest.match(DELIVERY_RE)?.[1];

  return {
    rawRequest,
    desiredOutcomes: unique(desiredOutcomes),
    responsibilities: unique(responsibilities),
    constraints: unique(constraints),
    policyRequirements: unique(policyRequirements),
    ...(schedule ? { schedule } : {}),
    ...(delivery ? { delivery } : {}),
  };
}

export function mergeDesignIntent(
  base: EmployeeDesignIntent,
  revision: EmployeeDesignIntent,
): EmployeeDesignIntent {
  return {
    rawRequest: `${base.rawRequest}\n${revision.rawRequest}`.trim(),
    desiredOutcomes: unique([...base.desiredOutcomes, ...revision.desiredOutcomes]),
    responsibilities: unique([...base.responsibilities, ...revision.responsibilities]),
    constraints: unique([...base.constraints, ...revision.constraints]),
    policyRequirements: unique([...base.policyRequirements, ...revision.policyRequirements]),
    ...((revision.schedule ?? base.schedule)
      ? { schedule: revision.schedule ?? base.schedule }
      : {}),
    ...((revision.delivery ?? base.delivery)
      ? { delivery: revision.delivery ?? base.delivery }
      : {}),
  };
}
