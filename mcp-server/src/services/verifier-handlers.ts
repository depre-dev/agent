import { JobDefinition, VerificationVerdict } from "../schemas/types.js";

function normalizeEvidence(evidence: string) {
  return evidence.trim().toLowerCase();
}

interface VerifierHandler {
  id: string;
  evaluate(job: JobDefinition, evidence: string): VerificationVerdict;
}

function createBenchmarkHandler(): VerifierHandler {
  return {
    id: "benchmark",
    evaluate(job, evidence) {
      if (job.verifierConfig.handler !== "benchmark") {
        throw new Error("Invalid benchmark verifier config");
      }

      const normalized = normalizeEvidence(evidence);
      const matched = job.verifierConfig.requiredKeywords.filter((keyword) => normalized.includes(keyword.toLowerCase()));
      const approved = matched.length >= job.verifierConfig.minimumMatches;

      return {
        jobId: job.id,
        handler: "benchmark",
        outcome: approved ? "approved" : "rejected",
        score: Math.round((matched.length / Math.max(job.verifierConfig.requiredKeywords.length, 1)) * 100),
        reasonCode: approved ? "BENCHMARK_THRESHOLD_MET" : "BENCHMARK_THRESHOLD_MISSED",
        detail: `Matched ${matched.length}/${job.verifierConfig.requiredKeywords.length} required keywords.`
      };
    }
  };
}

function createDeterministicHandler(): VerifierHandler {
  return {
    id: "deterministic",
    evaluate(job, evidence) {
      if (job.verifierConfig.handler !== "deterministic") {
        throw new Error("Invalid deterministic verifier config");
      }

      const normalized = normalizeEvidence(evidence);
      const expected = job.verifierConfig.expectedOutputs.map((value) => value.toLowerCase());
      const approved = job.verifierConfig.matchMode === "exact"
        ? expected.includes(normalized)
        : expected.every((value) => normalized.includes(value));

      return {
        jobId: job.id,
        handler: "deterministic",
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

function createHumanFallbackHandler(): VerifierHandler {
  return {
    id: "human_fallback",
    evaluate(job) {
      if (job.verifierConfig.handler !== "human_fallback") {
        throw new Error("Invalid human fallback verifier config");
      }

      return {
        jobId: job.id,
        handler: "human_fallback",
        outcome: job.verifierConfig.autoApprove ? "approved" : "disputed",
        score: job.verifierConfig.autoApprove ? 100 : 0,
        reasonCode: job.verifierConfig.autoApprove ? "HUMAN_FALLBACK_AUTO_APPROVE" : "HUMAN_REVIEW_REQUIRED",
        detail: job.verifierConfig.escalationMessage
      };
    }
  };
}

export class VerifierRegistry {
  private readonly handlers = new Map<string, VerifierHandler>([
    ["benchmark", createBenchmarkHandler()],
    ["deterministic", createDeterministicHandler()],
    ["human_fallback", createHumanFallbackHandler()]
  ]);

  listHandlers(): string[] {
    return [...this.handlers.keys()];
  }

  evaluate(job: JobDefinition, evidence: string): VerificationVerdict {
    const handlerId = job.verifierConfig.handler;
    const handler = this.handlers.get(handlerId);
    if (!handler) {
      throw new Error(`No verifier handler registered for ${handlerId}`);
    }
    return handler.evaluate(job, evidence);
  }
}
