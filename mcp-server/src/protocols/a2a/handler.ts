import { PlatformService } from "../../core/platform-service.js";
import { agentCard } from "./agent-card.js";

export function handleA2ARequest(service: PlatformService, request: { action: string; wallet?: string; jobId?: string; idempotencyKey?: string; sessionId?: string }) {
  switch (request.action) {
    case "describe":
      return agentCard;
    case "recommendJobs":
      return service.recommendJobs(request.wallet ?? "");
    case "claimJob":
      return service.claimJob(request.wallet ?? "", request.jobId ?? "", "a2a", request.idempotencyKey ?? `${request.wallet}:${request.jobId}`);
    case "resumeSession":
      return service.resumeSession(request.sessionId ?? "");
    default:
      throw new Error(`Unsupported A2A action: ${request.action}`);
  }
}
