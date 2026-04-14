import { PlatformService } from "../../core/platform-service.js";
import { VerifierService } from "../../services/verifier-service.js";

export function createMcpToolRegistry(service: PlatformService, verifierService?: VerifierService) {
  return {
    getPlatformCapabilities: async () => service.getPlatformCapabilities(),
    getAccountSummary: async (wallet: string) => service.getAccountSummary(wallet),
    recommendJobs: async (wallet: string) => service.recommendJobs(wallet),
    getJobDefinition: async (jobId: string) => service.getJobDefinition(jobId),
    preflightJob: async (wallet: string, jobId: string) => service.preflightJob(wallet, jobId),
    explainEligibility: async (wallet: string, jobId: string) => service.explainEligibility(wallet, jobId),
    estimateNetReward: async (wallet: string, jobId: string) => service.estimateNetReward(wallet, jobId),
    reserveForJob: async (wallet: string, asset: string, amount: number) => service.reserveForJob(wallet, asset, amount),
    claimJob: async (wallet: string, jobId: string, idempotencyKey: string) => service.claimJob(wallet, jobId, "mcp", idempotencyKey),
    submitWork: async (sessionId: string, evidence?: string) => service.submitWork(sessionId, "mcp", evidence),
    resumeSession: async (sessionId: string) => service.resumeSession(sessionId),
    allocateIdleFunds: async (wallet: string, asset: string, amount: number, strategyId?: string) => service.allocateIdleFunds(wallet, asset, amount, strategyId),
    getBorrowCapacity: async (wallet: string, asset: string) => service.getBorrowCapacity(wallet, asset),
    borrow: async (wallet: string, asset: string, amount: number) => service.borrow(wallet, asset, amount),
    repay: async (wallet: string, asset: string, amount: number) => service.repay(wallet, asset, amount),
    getReputation: async (wallet: string) => service.getReputation(wallet),
    verifySubmission: async (sessionId: string, evidence: string, metadataURI?: string) => {
      if (!verifierService) {
        throw new Error("Verifier service is not configured");
      }
      return verifierService.verifySubmission({ sessionId, evidence, metadataURI });
    },
    getVerificationResult: async (sessionId: string) => verifierService?.getResult(sessionId) ?? { status: "not_found" },
    listVerifierHandlers: async () => verifierService?.listHandlers() ?? []
  };
}
