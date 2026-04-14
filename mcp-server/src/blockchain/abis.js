export const AGENT_ACCOUNT_ABI = [
  "function positions(address account, address asset) view returns (uint256 liquid, uint256 reserved, uint256 strategyAllocated, uint256 collateralLocked, uint256 debtOutstanding)",
  "function getBorrowCapacity(address account, address asset) view returns (uint256)",
  "function deposit(address asset, uint256 amount)",
  "function reserveForJob(address account, address asset, uint256 amount)",
  "function allocateIdleFunds(address account, bytes32 strategyId, uint256 amount)",
  "function borrow(address asset, uint256 amount)",
  "function repay(address asset, uint256 amount)"
];

export const ESCROW_CORE_ABI = [
  "function createSinglePayoutJob(bytes32 jobId, address asset, uint256 reward, uint256 opsReserve, uint256 contingencyReserve, uint256 claimTtl, bytes32 verifierMode, bytes32 category)",
  "function claimJob(bytes32 jobId)",
  "function submitWork(bytes32 jobId, bytes32 evidenceHash)",
  "function resolveSinglePayout(bytes32 jobId, bool approved, bytes32 reasonCode, string metadataURI)",
  "function jobs(bytes32 jobId) view returns (address poster, address worker, address asset, bytes32 verifierMode, bytes32 category, uint256 reward, uint256 opsReserve, uint256 contingencyReserve, uint256 released, uint256 claimExpiry, uint8 payoutMode, uint8 state)"
];

export const REPUTATION_SBT_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function reputations(address account) view returns (uint256 skill, uint256 reliability, uint256 economic)",
  "function categoryLevels(address account, bytes32 category) view returns (uint256)"
];
