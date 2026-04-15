import { createClient } from "redis";

export class MemoryStateStore {
  constructor() {
    this.sessions = new Map();
    this.idempotency = new Map();
    this.jobSessions = new Map();
    this.verificationResults = new Map();
    this.claimLocks = new Map();
  }

  async getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  async upsertSession(session) {
    this.sessions.set(session.sessionId, session);
    this.idempotency.set(session.idempotencyKey, session.sessionId);
    this.jobSessions.set(session.jobId, session.sessionId);
    return session;
  }

  async findSessionByIdempotencyKey(idempotencyKey) {
    const sessionId = this.idempotency.get(idempotencyKey);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  async findSessionByJobId(jobId) {
    const sessionId = this.jobSessions.get(jobId);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  async getVerificationResult(sessionId) {
    return this.verificationResults.get(sessionId);
  }

  async upsertVerificationResult(sessionId, result) {
    this.verificationResults.set(sessionId, result);
    return result;
  }

  async acquireClaimLock(lockId, owner, ttlSeconds = 30) {
    const now = Date.now();
    const existing = this.claimLocks.get(lockId);
    if (existing && existing.expiresAt > now && existing.owner !== owner) {
      return false;
    }

    this.claimLocks.set(lockId, {
      owner,
      expiresAt: now + (ttlSeconds * 1000)
    });
    return true;
  }

  async releaseClaimLock(lockId, owner) {
    const existing = this.claimLocks.get(lockId);
    if (existing?.owner === owner) {
      this.claimLocks.delete(lockId);
    }
  }
}

export class RedisStateStore {
  constructor(redisUrl, namespace = "agent-platform") {
    this.redisUrl = redisUrl;
    this.namespace = namespace;
    this.client = createClient({ url: redisUrl });
    this.connectionPromise = undefined;
  }

  async getSession(sessionId) {
    await this.connect();
    const raw = await this.client.get(this.key("session", sessionId));
    return raw ? JSON.parse(raw) : undefined;
  }

  async upsertSession(session) {
    await this.connect();
    await this.client.set(this.key("session", session.sessionId), JSON.stringify(session));
    await this.client.set(this.key("idempotency", session.idempotencyKey), session.sessionId);
    await this.client.set(this.key("job", session.jobId), session.sessionId);
    return session;
  }

  async findSessionByIdempotencyKey(idempotencyKey) {
    await this.connect();
    const sessionId = await this.client.get(this.key("idempotency", idempotencyKey));
    return sessionId ? this.getSession(sessionId) : undefined;
  }

  async findSessionByJobId(jobId) {
    await this.connect();
    const sessionId = await this.client.get(this.key("job", jobId));
    return sessionId ? this.getSession(sessionId) : undefined;
  }

  async getVerificationResult(sessionId) {
    await this.connect();
    const raw = await this.client.get(this.key("verification", sessionId));
    return raw ? JSON.parse(raw) : undefined;
  }

  async upsertVerificationResult(sessionId, result) {
    await this.connect();
    await this.client.set(this.key("verification", sessionId), JSON.stringify(result));
    return result;
  }

  async acquireClaimLock(lockId, owner, ttlSeconds = 30) {
    await this.connect();
    const reply = await this.client.set(this.key("claim-lock", lockId), owner, {
      NX: true,
      EX: ttlSeconds
    });
    return reply === "OK";
  }

  async releaseClaimLock(lockId, owner) {
    await this.connect();
    const key = this.key("claim-lock", lockId);
    const existing = await this.client.get(key);
    if (existing === owner) {
      await this.client.del(key);
    }
  }

  async connect() {
    if (!this.connectionPromise) {
      this.connectionPromise = this.client.connect();
    }
    await this.connectionPromise;
  }

  key(kind, id) {
    return `${this.namespace}:${kind}:${id}`;
  }
}

export function createStateStore(env = process.env) {
  if (env.REDIS_URL) {
    return new RedisStateStore(env.REDIS_URL, env.REDIS_NAMESPACE ?? "agent-platform");
  }
  return new MemoryStateStore();
}
