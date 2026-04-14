import { createClient, RedisClientType } from "redis";
import { JobSession } from "../schemas/types.js";

export interface StateStore<TVerificationResult = unknown> {
  getSession(sessionId: string): Promise<JobSession | undefined>;
  upsertSession(session: JobSession): Promise<JobSession>;
  findSessionByIdempotencyKey(idempotencyKey: string): Promise<JobSession | undefined>;
  findSessionByJobId(jobId: string): Promise<JobSession | undefined>;
  getVerificationResult(sessionId: string): Promise<TVerificationResult | undefined>;
  upsertVerificationResult(sessionId: string, result: TVerificationResult): Promise<TVerificationResult>;
}

export class MemoryStateStore<TVerificationResult = unknown> implements StateStore<TVerificationResult> {
  private readonly sessions = new Map<string, JobSession>();
  private readonly idempotency = new Map<string, string>();
  private readonly jobSessions = new Map<string, string>();
  private readonly verificationResults = new Map<string, TVerificationResult>();

  async getSession(sessionId: string): Promise<JobSession | undefined> {
    return this.sessions.get(sessionId);
  }

  async upsertSession(session: JobSession): Promise<JobSession> {
    this.sessions.set(session.sessionId, session);
    this.idempotency.set(session.idempotencyKey, session.sessionId);
    this.jobSessions.set(session.jobId, session.sessionId);
    return session;
  }

  async findSessionByIdempotencyKey(idempotencyKey: string): Promise<JobSession | undefined> {
    const sessionId = this.idempotency.get(idempotencyKey);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  async findSessionByJobId(jobId: string): Promise<JobSession | undefined> {
    const sessionId = this.jobSessions.get(jobId);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  async getVerificationResult(sessionId: string): Promise<TVerificationResult | undefined> {
    return this.verificationResults.get(sessionId);
  }

  async upsertVerificationResult(sessionId: string, result: TVerificationResult): Promise<TVerificationResult> {
    this.verificationResults.set(sessionId, result);
    return result;
  }
}

export class RedisStateStore<TVerificationResult = unknown> implements StateStore<TVerificationResult> {
  private readonly client: RedisClientType;
  private connectionPromise?: Promise<unknown>;

  constructor(
    private readonly redisUrl: string,
    private readonly namespace = "agent-platform"
  ) {
    this.client = createClient({ url: redisUrl });
  }

  async getSession(sessionId: string): Promise<JobSession | undefined> {
    await this.connect();
    const raw = await this.client.get(this.key("session", sessionId));
    return raw ? JSON.parse(raw) as JobSession : undefined;
  }

  async upsertSession(session: JobSession): Promise<JobSession> {
    await this.connect();
    await this.client.set(this.key("session", session.sessionId), JSON.stringify(session));
    await this.client.set(this.key("idempotency", session.idempotencyKey), session.sessionId);
    await this.client.set(this.key("job", session.jobId), session.sessionId);
    return session;
  }

  async findSessionByIdempotencyKey(idempotencyKey: string): Promise<JobSession | undefined> {
    await this.connect();
    const sessionId = await this.client.get(this.key("idempotency", idempotencyKey));
    return sessionId ? this.getSession(sessionId) : undefined;
  }

  async findSessionByJobId(jobId: string): Promise<JobSession | undefined> {
    await this.connect();
    const sessionId = await this.client.get(this.key("job", jobId));
    return sessionId ? this.getSession(sessionId) : undefined;
  }

  async getVerificationResult(sessionId: string): Promise<TVerificationResult | undefined> {
    await this.connect();
    const raw = await this.client.get(this.key("verification", sessionId));
    return raw ? JSON.parse(raw) as TVerificationResult : undefined;
  }

  async upsertVerificationResult(sessionId: string, result: TVerificationResult): Promise<TVerificationResult> {
    await this.connect();
    await this.client.set(this.key("verification", sessionId), JSON.stringify(result));
    return result;
  }

  private async connect() {
    if (!this.connectionPromise) {
      this.connectionPromise = this.client.connect();
    }
    await this.connectionPromise;
  }

  private key(kind: string, id: string) {
    return `${this.namespace}:${kind}:${id}`;
  }
}

export function createStateStore<TVerificationResult = unknown>(env = process.env): StateStore<TVerificationResult> {
  if (env.REDIS_URL) {
    return new RedisStateStore<TVerificationResult>(env.REDIS_URL, env.REDIS_NAMESPACE ?? "agent-platform");
  }
  return new MemoryStateStore<TVerificationResult>();
}
