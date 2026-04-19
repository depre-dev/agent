import { extractSubmissionText } from "../core/submission.js";

const HANDLER_VERSION = 1;

function normalizeEvidence(input) {
  return extractSubmissionText(input).trim().toLowerCase();
}

function createBenchmarkHandler() {
  return {
    id: "benchmark",
    evaluate(job, evidence) {
      const normalized = normalizeEvidence(evidence);
      const matched = job.verifierConfig.requiredKeywords.filter((keyword) => normalized.includes(keyword.toLowerCase()));
      const approved = matched.length >= job.verifierConfig.minimumMatches;

      return {
        jobId: job.id,
        handler: "benchmark",
        handlerVersion: HANDLER_VERSION,
        outcome: approved ? "approved" : "rejected",
        score: Math.round((matched.length / Math.max(job.verifierConfig.requiredKeywords.length, 1)) * 100),
        reasonCode: approved ? "BENCHMARK_THRESHOLD_MET" : "BENCHMARK_THRESHOLD_MISSED",
        detail: `Matched ${matched.length}/${job.verifierConfig.requiredKeywords.length} required keywords.`
      };
    }
  };
}

function createDeterministicHandler() {
  return {
    id: "deterministic",
    evaluate(job, evidence) {
      const normalized = normalizeEvidence(evidence);
      const expected = job.verifierConfig.expectedOutputs.map((value) => value.toLowerCase());
      const approved = job.verifierConfig.matchMode === "exact"
        ? expected.includes(normalized)
        : expected.every((value) => normalized.includes(value));

      return {
        jobId: job.id,
        handler: "deterministic",
        handlerVersion: HANDLER_VERSION,
        outcome: approved ? "approved" : "rejected",
        score: approved ? 100 : 0,
        reasonCode: approved ? "DETERMINISTIC_MATCH" : "DETERMINISTIC_MISMATCH",
        detail: approved
          ? `Submission satisfied ${job.verifierConfig.matchMode} deterministic checks.`
          : `Submission failed ${job.verifierConfig.matchMode} deterministic checks.`
      };
    }
  };
}

function createHumanFallbackHandler() {
  return {
    id: "human_fallback",
    evaluate(job) {
      return {
        jobId: job.id,
        handler: "human_fallback",
        handlerVersion: HANDLER_VERSION,
        outcome: job.verifierConfig.autoApprove ? "approved" : "disputed",
        score: job.verifierConfig.autoApprove ? 100 : 0,
        reasonCode: job.verifierConfig.autoApprove ? "HUMAN_FALLBACK_AUTO_APPROVE" : "HUMAN_REVIEW_REQUIRED",
        detail: job.verifierConfig.escalationMessage
      };
    }
  };
}

export class VerifierRegistry {
  constructor() {
    this.handlers = new Map([
      ["benchmark", createBenchmarkHandler()],
      ["deterministic", createDeterministicHandler()],
      ["human_fallback", createHumanFallbackHandler()]
    ]);
  }

  listHandlers() {
    return [...this.handlers.keys()];
  }

  evaluate(job, evidence) {
    const handlerId = job.verifierConfig.handler;
    const handler = this.handlers.get(handlerId);
    if (!handler) {
      throw new Error(`No verifier handler registered for ${handlerId}`);
    }
    return handler.evaluate(job, evidence);
  }
}
