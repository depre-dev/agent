export function buildEvidenceTemplate(job) {
  if (!job) return "";

  if (job.verifierConfig?.handler === "benchmark") {
    return `complete verified output for ${job.id}`;
  }

  if (job.verifierConfig?.handler === "deterministic") {
    return (job.verifierConfig.expectedOutputs ?? []).join(" ");
  }

  return `submission for ${job.id}`;
}

export function describeVerifier(job) {
  if (!job?.verifierConfig) return "Verifier config unavailable.";

  if (job.verifierConfig.handler === "benchmark") {
    return `Keywords: ${job.verifierConfig.requiredKeywords.join(", ")}. Need ${job.verifierConfig.minimumMatches} matches.`;
  }

  if (job.verifierConfig.handler === "deterministic") {
    return `Expected outputs (${job.verifierConfig.matchMode}): ${job.verifierConfig.expectedOutputs.join(", ")}.`;
  }

  return job.verifierConfig.escalationMessage;
}

export function parseTerms(value) {
  return String(value ?? "")
    .split("\n")
    .map((term) => term.trim())
    .filter(Boolean);
}
