// @vitest-environment node
// Feature: enterprise-capability-asset-library, Property 1: EnterpriseCapabilityProjection 投影正确性
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isProjectionClean, projectToEnterpriseView, RUNTIME_FIELDS } from "../projection.ts";

/**
 * Validates: Requirements 12.1, 12.6, 12.7, 21.1, 21.2
 *
 * For any raw API response object containing any subset of runtime fields
 * (prompt, workflowJson, toolchain, modelRouting, provider, memoryStrategy,
 * executionPolicy, routingHints, modelPreferences) — including nested
 * occurrences — the output of `projectToEnterpriseView()` SHALL have an
 * empty intersection between its field set and the runtime field set.
 */

/** Arbitrary that generates a key which is either a runtime field or a random string. */
const arbMixedKey = fc.oneof(
  fc.constantFrom(...RUNTIME_FIELDS),
  fc.string({ minLength: 1, maxLength: 20 }),
);

/** Arbitrary for a non-runtime field key (guaranteed not in RUNTIME_FIELDS). */
const runtimeFieldSet = new Set<string>(RUNTIME_FIELDS);
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const arbNonRuntimeKey = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((k) => !runtimeFieldSet.has(k) && !DANGEROUS_KEYS.has(k));

describe("Property 1: EnterpriseCapabilityProjection 投影正确性", () => {
  it("strips all runtime fields from flat objects", () => {
    fc.assert(
      fc.property(fc.dictionary(arbMixedKey, fc.anything()), (obj) => {
        const result = projectToEnterpriseView(obj);
        expect(isProjectionClean(result)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("strips runtime fields from nested objects at any depth", () => {
    // Generate objects with runtime fields injected at arbitrary nesting depth
    const arbNestedObj: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
      tree: fc.oneof(
        { depthSize: "small" },
        fc.dictionary(arbMixedKey, fc.anything()),
        fc.dictionary(arbMixedKey, fc.oneof({ depthSize: "small" }, tie("tree"), fc.anything())),
        fc.record({
          nested: fc.dictionary(arbMixedKey, tie("tree")),
          value: fc.anything(),
        }),
      ),
    })).tree;

    fc.assert(
      fc.property(arbNestedObj, (obj) => {
        const result = projectToEnterpriseView(obj);
        expect(isProjectionClean(result)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("strips runtime fields from objects inside arrays", () => {
    const arbArrayWithRuntimeFields = fc.array(
      fc.oneof(
        fc.dictionary(arbMixedKey, fc.anything()),
        fc.array(fc.dictionary(arbMixedKey, fc.anything())),
        fc.anything(),
      ),
      { minLength: 1, maxLength: 10 },
    );

    fc.assert(
      fc.property(arbArrayWithRuntimeFields, (arr) => {
        const result = projectToEnterpriseView(arr);
        expect(isProjectionClean(result)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("preserves all non-runtime fields", () => {
    // Generate objects with only non-runtime keys and verify they are all preserved
    const arbSafeObj = fc.dictionary(arbNonRuntimeKey, fc.constant("value"), {
      minKeys: 1,
      maxKeys: 10,
    });

    fc.assert(
      fc.property(arbSafeObj, (obj) => {
        const result = projectToEnterpriseView(obj) as Record<string, unknown>;
        const inputKeys = Object.keys(obj).toSorted();
        const outputKeys = Object.keys(result).toSorted();
        expect(outputKeys).toEqual(inputKeys);
      }),
      { numRuns: 200 },
    );
  });

  it("does not mutate the original input", () => {
    // Use JSON-safe values to avoid undefined/NaN serialization issues with deep clone
    const arbJsonSafeValue: fc.Arbitrary<unknown> = fc.oneof(
      fc.string(),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
    );
    const arbSafeObj = fc.dictionary(arbMixedKey, arbJsonSafeValue, {
      minKeys: 1,
      maxKeys: 10,
    });

    fc.assert(
      fc.property(arbSafeObj, (obj) => {
        const snapshot = JSON.parse(JSON.stringify(obj)) as unknown;
        projectToEnterpriseView(obj);
        expect(obj).toEqual(snapshot);
      }),
      { numRuns: 200 },
    );
  });

  it("passes through primitives unchanged", () => {
    const arbPrimitive = fc.oneof(
      fc.string(),
      fc.integer(),
      fc.double({ noNaN: true }),
      fc.boolean(),
      fc.constant(null),
      fc.constant(undefined),
    );

    fc.assert(
      fc.property(arbPrimitive, (value) => {
        const result = projectToEnterpriseView(value);
        expect(result).toBe(value);
      }),
      { numRuns: 200 },
    );
  });
});
