import test from "node:test";
import assert from "node:assert/strict";

import { ValidationError } from "./errors.js";
import { getBuiltinJobSchema, validateStructuredSubmission } from "./job-schema-registry.js";

test("getBuiltinJobSchema resolves built-in first-wave schemas", () => {
  const schema = getBuiltinJobSchema("schema://jobs/pr-review-findings-output");
  assert.equal(schema?.$id, "schema://jobs/pr-review-findings-output");
});

test("validateStructuredSubmission accepts a schema-compliant PR review payload", () => {
  const payload = {
    summary: "Found two issues in the auth flow.",
    findings: [
      {
        severity: "high",
        file: "frontend/auth.js",
        issue: "Reauth loop can hide expired token state.",
        recommendation: "Surface token expiry and short-circuit reauth once."
      }
    ],
    risk_level: "high",
    files_touched: ["frontend/auth.js"],
    recommended_next_step: "request_changes"
  };

  assert.doesNotThrow(() => {
    validateStructuredSubmission("schema://jobs/pr-review-findings-output", payload);
  });
});

test("validateStructuredSubmission rejects missing required fields", () => {
  assert.throws(
    () => validateStructuredSubmission("schema://jobs/pr-review-findings-output", {
      summary: "Looks good"
    }),
    (error) => error instanceof ValidationError && /findings is required/.test(error.message)
  );
});

test("validateStructuredSubmission rejects unknown schemas for structured payloads", () => {
  assert.throws(
    () => validateStructuredSubmission("schema://jobs/custom-output", { ok: true }),
    (error) => error instanceof ValidationError && /known built-in schema/.test(error.message)
  );
});
