import { createConfig } from "ponder";

import {
  AgentAccountCoreAbi,
  EscrowCoreAbi,
  ReputationSbtAbi,
  TreasuryPolicyAbi
} from "./abis/contractsAbi";

const parseStartBlock = (value: string | undefined, fallback: number | "latest") => {
  if (!value || value.trim() === "") return fallback;
  if (value === "latest") return "latest" as const;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const lowMemoryMode = process.env.PONDER_LOW_MEMORY === "true";
const includeTreasury = process.env.PONDER_ENABLE_TREASURY !== "false";
const treasuryPolicyAddress =
  (process.env.PONDER_TREASURY_POLICY_ADDRESS ??
    process.env.TREASURY_POLICY_ADDRESS ??
    "0xE190AC334CC5Be502A2e7b03Bc447d9E1Be6954D") as `0x${string}`;
const escrowCoreAddress =
  (process.env.PONDER_ESCROW_CORE_ADDRESS ??
    process.env.ESCROW_CORE_ADDRESS ??
    "0x642566F1A6FDff76D49C6e062f7464609455E0eC") as `0x${string}`;
const agentAccountAddress =
  (process.env.PONDER_AGENT_ACCOUNT_ADDRESS ?? process.env.AGENT_ACCOUNT_ADDRESS ?? "0xd89569B4a217B87f313A75EA36B9BF230Df2DaEe") as `0x${string}`;
const reputationSbtAddress =
  (process.env.PONDER_REPUTATION_SBT_ADDRESS ??
    process.env.REPUTATION_SBT_ADDRESS ??
    "0xb3035d5272854f3eB725db4965Db244059bB11FC") as `0x${string}`;

const treasuryStartBlock = parseStartBlock(
  process.env.PONDER_START_BLOCK_TREASURY,
  includeTreasury ? (lowMemoryMode ? 7623490 : 7616012) : "latest"
);
const escrowStartBlock = parseStartBlock(
  process.env.PONDER_START_BLOCK_ESCROW,
  lowMemoryMode ? 7623490 : 7622561
);
const reputationStartBlock = parseStartBlock(
  process.env.PONDER_START_BLOCK_REPUTATION,
  lowMemoryMode ? 7623490 : 7622659
);

export default createConfig({
  chains: {
    polkadotHubTestnet: {
      id: 420420417,
      rpc: process.env.PONDER_RPC_URL_420420417 ?? "https://eth-rpc-testnet.polkadot.io/",
      pollingInterval: lowMemoryMode ? 4_000 : 1_000,
      disableCache: lowMemoryMode,
      ethGetLogsBlockRange: lowMemoryMode ? 25 : undefined
    }
  },
  contracts: {
    TreasuryPolicy: {
      chain: "polkadotHubTestnet",
      abi: TreasuryPolicyAbi,
      address: treasuryPolicyAddress,
      startBlock: treasuryStartBlock
    },
    EscrowCore: {
      chain: "polkadotHubTestnet",
      abi: EscrowCoreAbi,
      address: escrowCoreAddress,
      startBlock: escrowStartBlock
    },
    AgentAccountCore: {
      chain: "polkadotHubTestnet",
      abi: AgentAccountCoreAbi,
      address: agentAccountAddress,
      startBlock: escrowStartBlock
    },
    ReputationSBT: {
      chain: "polkadotHubTestnet",
      abi: ReputationSbtAbi,
      address: reputationSbtAddress,
      startBlock: reputationStartBlock
    }
  }
});
