/**
 * Pack registration manifest (metadata only — no handler imports).
 *
 * Imported by `method-scopes.ts` at runtime without pulling handler modules.
 */

import { DIAGNOSIS_REPORT_API_DEPLOYED } from "../../../diagnosis/report-query-deploy.js";
import type { GatewayMethodPack } from "../pack-types.js";

type PackManifest = Pick<GatewayMethodPack, "id" | "methods" | "scopes" | "externalHandlers">;

const SUPERVISOR_READ = [
  "supervisor.task.get",
  "supervisor.task.list",
  "supervisor.task.subscribe",
  "supervisor.task.audit",
  "supervisor.template.list",
  "supervisor.worker.list",
  "supervisor.worker.health",
  "supervisor.worker.policy.list",
  "supervisor.node.list",
  "supervisor.node.bindings.list",
  "supervisor.node.bindingRequest.list",
  "supervisor.runner.status",
  "supervisor.status",
] as const;

const SUPERVISOR_WRITE = [
  "supervisor.task.create",
  "supervisor.task.abort",
  "supervisor.worker.policy.upsert",
  "supervisor.worker.policy.remove",
  "supervisor.node.bind",
  "supervisor.node.unbind",
  "supervisor.node.bindingRequest.create",
  "supervisor.node.bindingRequest.resolve",
  "supervisor.feature.set",
] as const;

export const GATEWAY_METHOD_PACK_MANIFEST: readonly PackManifest[] = [
  {
    id: "artifact-grant",
    methods: [
      "artifact.grant.redeem",
      "artifact.grant.get",
      "artifact.publish",
      "artifact.grant.create",
      "artifact.grant.revoke",
    ],
    scopes: {
      "operator.read": ["artifact.grant.redeem", "artifact.grant.get"],
      "operator.write": ["artifact.publish", "artifact.grant.create", "artifact.grant.revoke"],
    },
  },
  {
    id: "chat-checkpoints",
    methods: ["chat.checkpoints.list"],
    scopes: { "operator.read": ["chat.checkpoints.list"] },
  },
  {
    id: "collaboration-task-activation",
    methods: [
      "collaboration.task.readTeamDeliverable",
      "collaboration.task.checkDispatchReadiness",
      "collaboration.task.activate",
      "collaboration.task.discussToTask",
      "collaboration.task.confirmPlanFromChat",
      "collaboration.task.submitTeamDeliverable",
      "collaboration.task.ensureMemberSession",
    ],
    scopes: {
      "operator.read": [
        "collaboration.task.readTeamDeliverable",
        "collaboration.task.checkDispatchReadiness",
      ],
      "operator.write": [
        "collaboration.task.activate",
        "collaboration.task.discussToTask",
        "collaboration.task.confirmPlanFromChat",
        "collaboration.task.submitTeamDeliverable",
        "collaboration.task.ensureMemberSession",
      ],
    },
  },
  {
    id: "steward-workspace-file",
    methods: [
      "workbench.steward-file.read",
      "workbench.steward-file.preview",
      "workbench.steward-file.open",
      "workbench.steward-file.write",
      "workbench.steward-file.patch-pptx",
    ],
    scopes: {
      "operator.read": [
        "workbench.steward-file.read",
        "workbench.steward-file.preview",
        "workbench.steward-file.open",
      ],
      "operator.write": ["workbench.steward-file.write", "workbench.steward-file.patch-pptx"],
    },
  },
  {
    id: "group-workspace-file",
    methods: [
      "workbench.group-file.read",
      "workbench.group-file.list",
      "workbench.group-file.preview",
      "workbench.group-file.open",
      "workbench.group-manifest.read",
      "workbench.group-file.write",
      "workbench.group-file.patch-pptx",
    ],
    scopes: {
      "operator.read": [
        "workbench.group-file.read",
        "workbench.group-file.list",
        "workbench.group-file.preview",
        "workbench.group-file.open",
        "workbench.group-manifest.read",
      ],
      "operator.write": ["workbench.group-file.write", "workbench.group-file.patch-pptx"],
    },
  },
  {
    id: "group-shared-doc",
    methods: [
      "group.sharedDoc.open",
      "group.sharedDoc.listReviews",
      "group.sharedDoc.claimSection",
      "group.sharedDoc.writeBody",
      "group.sharedDoc.appendReview",
    ],
    scopes: {
      "operator.read": ["group.sharedDoc.open", "group.sharedDoc.listReviews"],
      "operator.write": [
        "group.sharedDoc.claimSection",
        "group.sharedDoc.writeBody",
        "group.sharedDoc.appendReview",
      ],
    },
  },
  {
    id: "supervisor",
    methods: [...SUPERVISOR_READ, ...SUPERVISOR_WRITE],
    scopes: {
      "operator.read": SUPERVISOR_READ,
      "operator.write": SUPERVISOR_WRITE,
    },
  },

  {
    id: "delivery-lane",
    methods: [
      "lane.get",
      "lane.focus",
      "lane.template.list",
      "lane.status",
      "lane.event.observeShadow",
      "lane.attach",
      "lane.setMode",
      "lane.seal",
      "lane.sealFromHandoff",
      "lane.requestMergeReady",
      "lane.requestMerge",
      "lane.helper.attach",
      "lane.helper.detach",
      "lane.event.apply",
    ],
    scopes: {
      "operator.read": [
        "lane.get",
        "lane.focus",
        "lane.template.list",
        "lane.status",
        "lane.event.observeShadow",
      ],
      "operator.write": [
        "lane.attach",
        "lane.setMode",
        "lane.seal",
        "lane.sealFromHandoff",
        "lane.requestMergeReady",
        "lane.requestMerge",
        "lane.helper.attach",
        "lane.helper.detach",
        "lane.event.apply",
      ],
    },
  },
  {
    id: "fabric",
    methods: [
      "fabric.policy.check",
      "fabric.tool.stream",
      "fabric.audit.query",
      "fabric.status",
      "fabric.tool.execute",
      "fabric.adapter.register",
      "fabric.feature.set",
    ],
    scopes: {
      "operator.read": [
        "fabric.policy.check",
        "fabric.tool.stream",
        "fabric.audit.query",
        "fabric.status",
      ],
      "operator.write": ["fabric.tool.execute", "fabric.adapter.register", "fabric.feature.set"],
    },
  },
  {
    id: "digital-employee",
    methods: [
      "digitalEmployee.design.compile",
      "digitalEmployee.design.revise",
      "digitalEmployee.design.confirm",
      "digitalEmployee.design.abort",
      "digitalEmployee.design.instantiate",
    ],
    scopes: {
      "operator.write": [
        "digitalEmployee.design.compile",
        "digitalEmployee.design.revise",
        "digitalEmployee.design.confirm",
        "digitalEmployee.design.abort",
      ],
      "operator.admin": ["digitalEmployee.design.instantiate"],
    },
  },
  {
    id: "employee-push",
    methods: ["employee.push.register", "employee.push.unregister", "employee.push.test"],
    scopes: {
      "operator.write": [
        "employee.push.register",
        "employee.push.unregister",
        "employee.push.test",
      ],
    },
  },
  {
    id: "daibai",
    methods: ["user.daibai.ask", "user.daibai.execute"],
    scopes: {
      "operator.read": ["user.daibai.ask"],
      "operator.write": ["user.daibai.execute"],
    },
  },
  {
    id: "support-cases",
    methods: [
      "support.cases.list",
      "support.cases.get",
      "support.cases.create",
      "support.cases.resolve",
      "support.cases.close",
    ],
    scopes: {
      "operator.read": ["support.cases.list", "support.cases.get"],
      "operator.write": ["support.cases.create", "support.cases.resolve", "support.cases.close"],
    },
  },
  {
    id: "task-context",
    methods: [
      "tasks.list",
      "tasks.getSummary",
      "tasks.create",
      "tasks.update",
      "tasks.bindSession",
    ],
    scopes: {
      "operator.read": ["tasks.list", "tasks.getSummary"],
      "operator.write": ["tasks.create", "tasks.update", "tasks.bindSession"],
    },
  },
  {
    id: "task-outcome-reject",
    methods: ["task.outcome.rejectResult"],
    scopes: {
      "operator.approvals": ["task.outcome.rejectResult"],
    },
  },
  {
    id: "data-governance",
    methods: [
      "dataGovernance.inventory.list",
      "dataGovernance.inventory.listRecoveryRequired",
      "dataGovernance.inventory.get",
      "dataGovernance.inventory.diagnose",
      "dataGovernance.recovery.listReceipts",
      "dataGovernance.recovery.getReceipt",
      "dataGovernance.laterWave.evaluateEnablement",
    ],
    scopes: {
      "operator.read": [
        "dataGovernance.inventory.list",
        "dataGovernance.inventory.listRecoveryRequired",
        "dataGovernance.inventory.get",
        "dataGovernance.inventory.diagnose",
        "dataGovernance.recovery.listReceipts",
        "dataGovernance.recovery.getReceipt",
      ],
      "operator.write": ["dataGovernance.laterWave.evaluateEnablement"],
    },
  },
  {
    id: "evolution-control",
    methods: [
      "evolution.surfaces.list",
      "evolution.proposals.list",
      "evolution.proposals.get",
      "evolution.experiments.get",
      "evolution.verifications.get",
      "evolution.ledger.query",
      "evolution.diagnosis.status",
      "evolution.proposals.transition",
      "evolution.proposals.authorize",
      "evolution.experiments.create",
      "evolution.experiments.evaluate",
      "evolution.applications.apply",
      "evolution.applications.verify",
      "evolution.applications.rollback",
      "evolution.task-outcomes.record",
      "evolution.working-dna.verify-effect",
      "evolution.working-dna.evaluate-promote",
      "evolution.diagnosis.submit",
      "evolution.diagnosis.recheck",
      "evolution.applications.approve",
    ],
    scopes: {
      "operator.read": [
        "evolution.surfaces.list",
        "evolution.proposals.list",
        "evolution.proposals.get",
        "evolution.experiments.get",
        "evolution.verifications.get",
        "evolution.ledger.query",
        "evolution.diagnosis.status",
      ],
      "operator.approvals": [
        "evolution.proposals.transition",
        "evolution.proposals.authorize",
        "evolution.experiments.create",
        "evolution.experiments.evaluate",
        "evolution.applications.apply",
        "evolution.applications.verify",
        "evolution.applications.rollback",
        "evolution.task-outcomes.record",
        "evolution.working-dna.verify-effect",
        "evolution.working-dna.evaluate-promote",
        "evolution.diagnosis.submit",
        "evolution.diagnosis.recheck",
        "evolution.applications.approve",
      ],
    },
  },
  {
    id: "evolution-delegation",
    methods: [
      "evolution.delegation.get",
      "evolution.delegation.request",
      "evolution.delegation.approve",
    ],
    scopes: {
      "operator.read": ["evolution.delegation.get"],
      "operator.approvals": ["evolution.delegation.request", "evolution.delegation.approve"],
    },
  },
  {
    id: "evolution-perception",
    methods: ["evolution.perception.query", "evolution.perception.project"],
    scopes: {
      "operator.read": ["evolution.perception.query", "evolution.perception.project"],
    },
  },

  ...(DIAGNOSIS_REPORT_API_DEPLOYED
    ? [
        {
          id: "diagnosis-reports",
          methods: [
            "diagnosis.observation.query",
            "diagnosis.reports.query",
            "diagnosis.reports.get",
            "diagnosis.diagnose",
            "diagnosis.action.dispatch",
            "diagnosis.intervention.list",
            "diagnosis.intervention.get",
            "diagnosis.intervention.dispatch",
            "diagnosis.intervention.expand",
            "diagnosis.intervention.materialize",
            "diagnosis.schedule.apply",
            "diagnosis.self-evolution.confirm",
            "diagnosis.job.pause",
            "diagnosis.job.resume",
            "diagnosis.job.run",
            "diagnosis.job.report.get",
            "diagnosis.job.describe",
            "diagnosis.job.cancel",
            "diagnosis.handling.preview",
            "diagnosis.handling.submit",
            "diagnosis.handling.approve",
            "diagnosis.handling.reject",
            "diagnosis.handling.cancel",
            "diagnosis.handling.execute",
            "diagnosis.handling.recheck",
            "diagnosis.handling.get",
            "diagnosis.handling.list",
          ],
          scopes: {
            "operator.read": [
              "diagnosis.observation.query",
              "diagnosis.reports.query",
              "diagnosis.reports.get",
              "diagnosis.diagnose",
              "diagnosis.intervention.list",
              "diagnosis.intervention.get",
              "diagnosis.job.report.get",
              "diagnosis.job.describe",
              "diagnosis.handling.preview",
              "diagnosis.handling.get",
              "diagnosis.handling.list",
            ],
            "operator.write": [
              "diagnosis.schedule.apply",
              "diagnosis.action.dispatch",
              "diagnosis.intervention.dispatch",
              "diagnosis.intervention.expand",
              "diagnosis.intervention.materialize",
              "diagnosis.job.pause",
              "diagnosis.job.resume",
              "diagnosis.job.run",
              "diagnosis.job.cancel",
              "diagnosis.handling.submit",
              "diagnosis.handling.cancel",
              "diagnosis.handling.execute",
              "diagnosis.handling.recheck",
            ],
            "operator.approvals": [
              "diagnosis.self-evolution.confirm",
              "diagnosis.handling.approve",
              "diagnosis.handling.reject",
            ],
          },
        } satisfies PackManifest,
      ]
    : []),
  ...(DIAGNOSIS_REPORT_API_DEPLOYED
    ? [
        {
          id: "diagnosis-issue-queue",
          methods: ["diagnosis.issues.list", "diagnosis.issues.advance"],
          scopes: {
            "operator.read": ["diagnosis.issues.list"],
            "operator.approvals": ["diagnosis.issues.advance"],
          },
        } satisfies PackManifest,
      ]
    : []),
  {
    id: "enterprise-diagnosis-approval",
    methods: ["enterprise.diagnosis.approval.decide"],
    scopes: {
      "operator.approvals": ["enterprise.diagnosis.approval.decide"],
    },
  },
  {
    id: "enterprise-security-controls",
    methods: [
      "enterprise.security.mfa.enroll",
      "enterprise.security.sessions.revoke",
      "enterprise.access.roles.create",
      "enterprise.access.permissions.commit",
      "enterprise.security.session-policy.set",
      "enterprise.security.ip-allowlist.set",
      "enterprise.mesh.asset-budget.set",
      "enterprise.security.sessions.list",
      "enterprise.security.audit.export",
      "enterprise.mesh.asset.pause",
    ],
    scopes: {
      "operator.write": [
        "enterprise.security.mfa.enroll",
        "enterprise.security.sessions.revoke",
        "enterprise.access.roles.create",
        "enterprise.access.permissions.commit",
        "enterprise.security.session-policy.set",
        "enterprise.security.ip-allowlist.set",
        "enterprise.mesh.asset-budget.set",
      ],
      "operator.read": ["enterprise.security.sessions.list", "enterprise.security.audit.export"],
      "operator.approvals": ["enterprise.mesh.asset.pause"],
    },
  },
  {
    id: "diagnosis-approval",
    methods: ["platform.diagnosis.approval.decide"],
    scopes: {
      "operator.approvals": ["platform.diagnosis.approval.decide"],
    },
  },
];

export const PACK_OWNED_METHOD_NAMES = new Set(
  GATEWAY_METHOD_PACK_MANIFEST.flatMap((entry) => entry.methods),
);
