import { readFileSync } from "node:fs";
import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv2020Pkg from "ajv/dist/2020.js";
import { executionReceiptSchemaPath, toolDefinitionSchemaPath } from "./paths.js";

type AjvConstructor = new (opts?: object) => {
  compile: (schema: object) => ValidateFunction;
};

function createAjv() {
  const Ajv2020 = Ajv2020Pkg as unknown as AjvConstructor;
  return new Ajv2020({
    allErrors: true,
    strict: false,
  });
}

function loadJson(path: string): object {
  return JSON.parse(readFileSync(path, "utf8")) as object;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) {
    return "unknown validation error";
  }
  return errors.map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`.trim()).join("; ");
}

let toolDefinitionValidator: ValidateFunction | undefined;
let receiptValidator: ValidateFunction | undefined;

export function getToolDefinitionValidator(): ValidateFunction {
  if (!toolDefinitionValidator) {
    const compiled = createAjv().compile(loadJson(toolDefinitionSchemaPath()));
    toolDefinitionValidator = compiled;
  }
  return toolDefinitionValidator;
}

export function getExecutionReceiptValidator(): ValidateFunction {
  if (!receiptValidator) {
    const compiled = createAjv().compile(loadJson(executionReceiptSchemaPath()));
    receiptValidator = compiled;
  }
  return receiptValidator;
}

export function assertValidToolDefinition(tool: unknown): void {
  const validate = getToolDefinitionValidator();
  if (!validate(tool)) {
    throw new Error(`Invalid tool definition: ${formatErrors(validate.errors)}`);
  }
}

export function assertValidExecutionReceipt(receipt: unknown): void {
  const validate = getExecutionReceiptValidator();
  if (!validate(receipt)) {
    throw new Error(`Invalid execution receipt: ${formatErrors(validate.errors)}`);
  }
}

export function validateToolDefinition(tool: unknown): {
  ok: boolean;
  errors: string | null;
} {
  const validate = getToolDefinitionValidator();
  if (validate(tool)) {
    return { ok: true, errors: null };
  }
  return { ok: false, errors: formatErrors(validate.errors) };
}
