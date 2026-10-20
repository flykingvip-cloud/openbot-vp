import { describe, expect, it } from "vitest";
import {
  validateCronAddParams,
  validateCronListParams,
  validateCronRemoveParams,
  validateCronRunParams,
  validateCronRunsParams,
  validateCronTaskTemplatesDeleteParams,
  validateCronTaskTemplatesListParams,
  validateCronTaskTemplatesSaveParams,
  validateCronUpdateParams,
} from "./index.js";

const minimalAddParams = {
  name: "daily-summary",
  schedule: { kind: "every", everyMs: 60_000 },
  sessionTarget: "main",
  wakeMode: "next-heartbeat",
  payload: { kind: "systemEvent", text: "tick" },
} as const;

describe("cron protocol validators", () => {
  it("accepts minimal add params", () => {
    expect(validateCronAddParams(minimalAddParams)).toBe(true);
  });

  it("rejects add params when required scheduling fields are missing", () => {
    const { wakeMode: _wakeMode, ...withoutWakeMode } = minimalAddParams;
    expect(validateCronAddParams(withoutWakeMode)).toBe(false);
  });

  it("accepts conversationTaskId as an optional wake reference", () => {
    expect(
      validateCronAddParams({
        ...minimalAddParams,
        conversationTaskId: "ct-market-1",
      }),
    ).toBe(true);
    expect(
      validateCronUpdateParams({
        id: "job-1",
        patch: { conversationTaskId: "ct-market-1" },
      }),
    ).toBe(true);
  });

  it("accepts update params for id and jobId selectors", () => {
    expect(validateCronUpdateParams({ id: "job-1", patch: { enabled: false } })).toBe(true);
    expect(validateCronUpdateParams({ jobId: "job-2", patch: { enabled: true } })).toBe(true);
  });

  it("accepts remove params for id and jobId selectors", () => {
    expect(validateCronRemoveParams({ id: "job-1" })).toBe(true);
    expect(validateCronRemoveParams({ jobId: "job-2" })).toBe(true);
  });

  it("accepts run params mode for id and jobId selectors", () => {
    expect(validateCronRunParams({ id: "job-1", mode: "force" })).toBe(true);
    expect(validateCronRunParams({ jobId: "job-2", mode: "due" })).toBe(true);
  });

  it("accepts list paging/filter/sort params", () => {
    expect(
      validateCronListParams({
        includeDisabled: true,
        limit: 50,
        offset: 0,
        query: "daily",
        enabled: "all",
        sortBy: "nextRunAtMs",
        sortDir: "asc",
      }),
    ).toBe(true);
    expect(validateCronListParams({ offset: -1 })).toBe(false);
  });

  it("enforces runs limit minimum for id and jobId selectors", () => {
    expect(validateCronRunsParams({ id: "job-1", limit: 1 })).toBe(true);
    expect(validateCronRunsParams({ jobId: "job-2", limit: 1 })).toBe(true);
    expect(validateCronRunsParams({ id: "job-1", limit: 0 })).toBe(false);
    expect(validateCronRunsParams({ jobId: "job-2", limit: 0 })).toBe(false);
  });

  it("rejects cron.runs path traversal ids", () => {
    expect(validateCronRunsParams({ id: "../job-1" })).toBe(false);
    expect(validateCronRunsParams({ id: "nested/job-1" })).toBe(false);
    expect(validateCronRunsParams({ jobId: "..\\job-2" })).toBe(false);
    expect(validateCronRunsParams({ jobId: "nested\\job-2" })).toBe(false);
  });

  it("accepts runs paging/filter/sort params", () => {
    expect(
      validateCronRunsParams({
        id: "job-1",
        limit: 50,
        offset: 0,
        status: "error",
        query: "timeout",
        sortDir: "desc",
      }),
    ).toBe(true);
    expect(validateCronRunsParams({ id: "job-1", offset: -1 })).toBe(false);
  });

  it("accepts all-scope runs with multi-select filters", () => {
    expect(
      validateCronRunsParams({
        scope: "all",
        limit: 25,
        statuses: ["ok", "error"],
        deliveryStatuses: ["delivered", "not-requested"],
        query: "fail",
        sortDir: "desc",
      }),
    ).toBe(true);
    expect(
      validateCronRunsParams({
        scope: "job",
        statuses: [],
      }),
    ).toBe(false);
  });

  it("accepts cron.taskTemplates params", () => {
    expect(validateCronTaskTemplatesListParams({})).toBe(true);
    expect(
      validateCronTaskTemplatesSaveParams({
        template: {
          id: "tpl-1",
          name: "Daily report",
          intentText: "Generate report",
        },
      }),
    ).toBe(true);
    expect(
      validateCronTaskTemplatesSaveParams({ template: { id: "", name: "x", intentText: "" } }),
    ).toBe(false);
    expect(validateCronTaskTemplatesDeleteParams({ id: "tpl-1" })).toBe(true);
    expect(validateCronTaskTemplatesDeleteParams({ id: "" })).toBe(false);
    expect(
      validateCronTaskTemplatesSaveParams({
        template: {
          id: "tpl-2",
          name: "With bindings",
          intentText: "Use {{bind:runtime-today}}",
          dataBindings: [
            {
              bindingId: "runtime-today",
              kind: "runtime_date",
              resourceId: "today",
              label: "今天日期",
            },
          ],
        },
      }),
    ).toBe(true);
  });
});

describe("cron ownerScope param", () => {
  it("accepts the personal marker on list/update/remove/run/runs", () => {
    expect(validateCronListParams({ ownerScope: "personal" })).toBe(true);
    expect(validateCronRunParams({ id: "job-1", ownerScope: "personal" })).toBe(true);
    expect(validateCronRemoveParams({ jobId: "job-1", ownerScope: "personal" })).toBe(true);
    expect(
      validateCronUpdateParams({ id: "job-1", patch: { enabled: false }, ownerScope: "personal" }),
    ).toBe(true);
    expect(validateCronRunsParams({ scope: "all", ownerScope: "personal" })).toBe(true);
  });

  it("rejects any attempt to name a broader scope", () => {
    // The protocol only expresses narrowing; widening must not be requestable.
    expect(validateCronListParams({ ownerScope: "platform" })).toBe(false);
    expect(validateCronListParams({ ownerScope: "tenant" })).toBe(false);
    expect(validateCronRunParams({ id: "job-1", ownerScope: "all" })).toBe(false);
    expect(validateCronRunsParams({ scope: "all", ownerScope: "tenant" })).toBe(false);
  });

  it("rejects client-supplied owner identity", () => {
    expect(validateCronListParams({ ownerId: "user-other" })).toBe(false);
    expect(validateCronRunParams({ id: "job-1", ownerId: "user-other" })).toBe(false);
  });
});

describe("employee personal cron payloads accepted by the gateway", () => {
  // Contract regression for the FE/BE skew that broke production: the UI shipped
  // `ownerScope: "personal"` while the schema still rejected unknown properties
  // (`additionalProperties: false`), so every cron request from the personal page
  // failed validation. These use the exact payloads the UI sends.
  it("accepts the cron.list payload the UI sends", () => {
    expect(
      validateCronListParams({
        includeDisabled: true,
        limit: 50,
        offset: 0,
        enabled: "all",
        sortBy: "nextRunAtMs",
        sortDir: "asc",
        ownerScope: "personal",
      }),
    ).toBe(true);
  });

  it("accepts the cron.update payload the UI sends", () => {
    expect(
      validateCronUpdateParams({ id: "job-1", patch: { enabled: false }, ownerScope: "personal" }),
    ).toBe(true);
  });

  it("accepts the cron.remove payload the UI sends", () => {
    expect(validateCronRemoveParams({ id: "job-1", ownerScope: "personal" })).toBe(true);
  });

  it("accepts the cron.run payload the UI sends", () => {
    expect(validateCronRunParams({ id: "job-1", mode: "force", ownerScope: "personal" })).toBe(
      true,
    );
  });

  it("accepts both cron.runs payloads the UI sends", () => {
    expect(
      validateCronRunsParams({
        scope: "all",
        limit: 50,
        offset: 0,
        status: "all",
        sortDir: "desc",
        ownerScope: "personal",
      }),
    ).toBe(true);
    expect(validateCronRunsParams({ scope: "job", id: "job-1", ownerScope: "personal" })).toBe(
      true,
    );
  });
});
