import { parseAbi } from "viem";

export const EscrowCoreAbi = parseAbi([
  "event JobFunded(bytes32 indexed jobId, address indexed poster, address indexed asset, uint256 totalReserved, uint8 payoutMode)",
  "event JobClaimed(bytes32 indexed jobId, address indexed worker, uint256 claimExpiry)",
  "event WorkSubmitted(bytes32 indexed jobId, address indexed worker, bytes32 evidenceHash)",
  "event JobReopened(bytes32 indexed jobId)",
  "event JobRejected(bytes32 indexed jobId, bytes32 reasonCode)",
  "event DisputeOpened(bytes32 indexed jobId, address indexed opener)",
  "event JobClosed(bytes32 indexed jobId, address indexed worker, uint256 releasedAmount)",
  "function jobs(bytes32 jobId) view returns (address poster, address worker, address asset, bytes32 verifierMode, bytes32 category, uint256 reward, uint256 opsReserve, uint256 contingencyReserve, uint256 released, uint256 claimExpiry, uint8 payoutMode, uint8 state)"
]);

export const ReputationSbtAbi = parseAbi([
  "event BadgeMinted(uint256 indexed tokenId, address indexed account, bytes32 indexed category, uint256 level, string metadataURI)",
  "event ReputationUpdated(address indexed account, uint256 skill, uint256 reliability, uint256 economic)"
]);

export const TreasuryPolicyAbi = parseAbi([
  "event OutflowRecorded(uint256 day, uint256 amount, uint256 newTotal)"
]);
