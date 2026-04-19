/**
 * Small JS client for the Averray agent platform.
 *
 * This intentionally mirrors the current HTTP surface rather than hiding it
 * behind a large abstraction layer. The goal is to give operators and builders
 * one typed-ish place to call auth, jobs, sessions, verifier, and admin
 * routes without repeating raw fetch glue.
 */
export class AgentPlatformClient {
  constructor({ baseUrl, token = undefined, fetchImpl = fetch } = {}) {
    if (!baseUrl) {
      throw new Error("baseUrl is required");
    }
    this.baseUrl = String(baseUrl).replace(/\/+$/u, "");
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  setToken(token) {
    this.token = token;
  }

  async getHealth() {
    return this.request("/health");
  }

  async getOnboarding() {
    return this.request("/onboarding");
  }

  async issueNonce(wallet) {
    return this.request("/auth/nonce", {
      method: "POST",
      body: { wallet }
    });
  }

  async verifySignature(message, signature) {
    return this.request("/auth/verify", {
      method: "POST",
      body: { message, signature }
    });
  }

  async getAuthSession() {
    return this.request("/auth/session");
  }

  async listJobs() {
    return this.request("/jobs");
  }

  async getJobDefinition(jobId) {
    return this.request(`/jobs/definition?jobId=${encodeURIComponent(jobId)}`);
  }

  async getRecommendations() {
    return this.request("/jobs/recommendations");
  }

  async preflightJob(jobId) {
    return this.request(`/jobs/preflight?jobId=${encodeURIComponent(jobId)}`);
  }

  async claimJob(jobId, idempotencyKey = undefined) {
    return this.request("/jobs/claim", {
      method: "POST",
      body: {
        jobId,
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    });
  }

  async submitWork(sessionId, submission) {
    return this.request("/jobs/submit", {
      method: "POST",
      body: {
        sessionId,
        ...(typeof submission === "string" ? { evidence: submission } : { submission })
      }
    });
  }

  async getSession(sessionId) {
    return this.request(`/session?sessionId=${encodeURIComponent(sessionId)}`);
  }

  async getSessionTimeline(sessionId) {
    return this.request(`/session/timeline?sessionId=${encodeURIComponent(sessionId)}`);
  }

  async listSessions({ limit = undefined, jobId = undefined } = {}) {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set("limit", String(limit));
    if (jobId) params.set("jobId", jobId);
    return this.request(`/sessions${params.size ? `?${params.toString()}` : ""}`);
  }

  async listSubJobs(parentSessionId) {
    return this.request(`/jobs/sub?parentSessionId=${encodeURIComponent(parentSessionId)}`);
  }

  async createSubJob(payload) {
    return this.request("/jobs/sub", {
      method: "POST",
      body: payload
    });
  }

  async runVerifier(sessionId, evidence = undefined, metadataURI = undefined) {
    return this.request("/verifier/run", {
      method: "POST",
      body: compact({
        sessionId,
        evidence,
        metadataURI
      })
    });
  }

  async replayVerifier(sessionId) {
    return this.request("/verifier/replay", {
      method: "POST",
      body: { sessionId }
    });
  }

  async getVerifierResult(sessionId) {
    return this.request(`/verifier/result?sessionId=${encodeURIComponent(sessionId)}`);
  }

  async createJob(payload) {
    return this.request("/admin/jobs", {
      method: "POST",
      body: payload
    });
  }

  async fireRecurringJob(templateId, { firedAt = undefined, idempotencyKey = undefined } = {}) {
    return this.request("/admin/jobs/fire", {
      method: "POST",
      body: compact({ templateId, firedAt, idempotencyKey })
    });
  }

  async pauseRecurringJob(templateId) {
    return this.request("/admin/jobs/pause", {
      method: "POST",
      body: { templateId }
    });
  }

  async resumeRecurringJob(templateId) {
    return this.request("/admin/jobs/resume", {
      method: "POST",
      body: { templateId }
    });
  }

  async getAdminStatus() {
    return this.request("/admin/status");
  }

  async request(path, { method = "GET", body = undefined, headers = {} } = {}) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set("accept", "application/json");
    if (body !== undefined) {
      requestHeaders.set("content-type", "application/json");
    }
    if (this.token) {
      requestHeaders.set("authorization", `Bearer ${this.token}`);
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    const payload = text ? safeJsonParse(text) : undefined;
    if (!response.ok) {
      throw new Error(payload?.message ?? payload?.error ?? `${method} ${path} failed with ${response.status}`);
    }
    return payload;
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
