import { randomUUID } from "node:crypto";
import {
  ConflictError,
  NotFoundError
} from "./errors.js";

export class JobExecutionService {
  constructor(stateStore, blockchainGateway = undefined, getJobDefinition) {
    this.stateStore = stateStore;
    this.blockchainGateway = blockchainGateway;
    this.getJobDefinition = getJobDefinition;
  }

  async claimJob(wallet, jobId, protocol, idempotencyKey) {
    const existing = await this.stateStore.findSessionByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    const job = this.getJobDefinition(jobId);
    const sessionId = `${jobId}:${wallet}`;
    const sessionLockId = sessionId;
    const lockOwner = randomUUID();
    const lockAcquired = await this.stateStore.acquireClaimLock?.(
      sessionLockId,
      lockOwner,
      this.getClaimLockTtlSeconds(job)
    );

    if (lockAcquired === false) {
      const racedSession = await this.stateStore.getSession(sessionId);
      if (racedSession) {
        return racedSession;
      }
      throw new ConflictError(`Claim already in progress for ${sessionId}`, "claim_in_progress");
    }

    try {
      const replay = await this.stateStore.findSessionByIdempotencyKey(idempotencyKey);
      if (replay) {
        return replay;
      }

      const existingSession = await this.stateStore.getSession(sessionId);
      if (existingSession) {
        return existingSession;
      }

      const chainJobId = jobId;
      if (this.blockchainGateway?.isEnabled()) {
        const live = await this.blockchainGateway.getJob(jobId);
        if (live.state !== 0 && live.state !== 1) {
          throw new ConflictError(`Job ${jobId} is not claimable in its current on-chain state.`, "job_not_claimable");
        }
        if (this.blockchainGateway.ensureJob) {
          await this.blockchainGateway.ensureJob(job, chainJobId);
        }
        await this.blockchainGateway.claimJob(chainJobId);
      }

      const session = {
        sessionId,
        wallet,
        jobId,
        chainJobId,
        idempotencyKey,
        status: "claimed",
        protocolHistory: [protocol]
      };

      return this.stateStore.upsertSession(session);
    } finally {
      await this.stateStore.releaseClaimLock?.(sessionLockId, lockOwner);
    }
  }

  async submitWork(sessionId, protocol, evidence = "submitted-via-service") {
    const session = await this.requireSession(sessionId);
    if (this.blockchainGateway?.isEnabled()) {
      await this.blockchainGateway.submitWork(session.chainJobId ?? session.jobId, evidence);
    }
    const protocolHistory = [...new Set([...session.protocolHistory, protocol])];
    return this.stateStore.upsertSession({
      ...session,
      status: "submitted",
      protocolHistory
    });
  }

  async resumeSession(sessionId) {
    return this.requireSession(sessionId);
  }

  async listSessionHistory({ wallet = undefined, limit = 10, jobId = undefined } = {}) {
    let sessions = [];
    if (wallet) {
      sessions = await this.stateStore.listSessionsByWallet?.(wallet, limit) ?? [];
      if (jobId) {
        sessions = sessions.filter((session) => session.jobId === jobId);
      }
    } else if (jobId) {
      sessions = await this.stateStore.listSessionsByJob?.(jobId, limit) ?? [];
    }

    return Promise.all(
      sessions.map(async (session) => ({
        ...session,
        verification: await this.stateStore.getVerificationResult(session.sessionId) ?? undefined
      }))
    );
  }

  async requireSession(sessionId) {
    const session = await this.stateStore.getSession(sessionId);
    if (!session) {
      throw new NotFoundError(`Unknown session: ${sessionId}`, "session_not_found");
    }
    return session;
  }

  getClaimLockTtlSeconds(job) {
    return Math.max(60, Math.min(Number(job?.claimTtlSeconds ?? 300), 900));
  }
}
