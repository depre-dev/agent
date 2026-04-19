import { keccak256, toUtf8Bytes } from "ethers";
import { ValidationError } from "./errors.js";

export function normalizeSubmission(input) {
  if (typeof input === "string") {
    return {
      kind: "text",
      rawText: input,
      evidenceText: input
    };
  }

  if (isStructuredSubmission(input)) {
    return {
      kind: "structured",
      structured: input,
      evidenceText: stableStringify(input)
    };
  }

  throw new ValidationError("submission must be a string, object, or array");
}

export function extractSubmissionText(input) {
  if (!input) {
    return "";
  }
  if (typeof input === "string") {
    return input;
  }
  if (typeof input.evidenceText === "string") {
    return input.evidenceText;
  }
  if (typeof input.rawText === "string") {
    return input.rawText;
  }
  if (isStructuredSubmission(input.structured)) {
    return stableStringify(input.structured);
  }
  if (isStructuredSubmission(input)) {
    return stableStringify(input);
  }
  return "";
}

export function hashSubmission(input) {
  return keccak256(toUtf8Bytes(extractSubmissionText(input)));
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function isStructuredSubmission(value) {
  return Array.isArray(value) || (value !== null && typeof value === "object");
}
