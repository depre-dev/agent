export class VerificationIngestionService {
  constructor(stateStore, eventBus = undefined) {
    this.stateStore = stateStore;
    this.eventBus = eventBus;
  }

  async ingest(verdict) {
    const session = await this.stateStore.findSessionByJobId(verdict.jobId);
    if (!session) {
      return undefined;
    }

    const status = verdict.outcome === "approved"
      ? "resolved"
      : verdict.outcome === "disputed"
        ? "disputed"
        : "rejected";

    const updatedSession = await this.stateStore.upsertSession({
      ...session,
      status
    });
    this.eventBus?.publish({
      id: `platform-verification-${updatedSession.sessionId}-${Date.now()}`,
      topic: "verification.resolved",
      wallet: updatedSession.wallet,
      wallets: [updatedSession.wallet],
      jobId: updatedSession.jobId,
      sessionId: updatedSession.sessionId,
      timestamp: new Date().toISOString(),
      data: {
        outcome: verdict.outcome,
        reasonCode: verdict.reasonCode,
        status
      }
    });
    return updatedSession;
  }
}
