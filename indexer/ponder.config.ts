import { createConfig } from "ponder";

import {
  EscrowCoreAbi,
  ReputationSbtAbi,
  TreasuryPolicyAbi
} from "./abis/contractsAbi";

export default createConfig({
  chains: {
    polkadotHubTestnet: {
      id: 420420417,
      rpc: process.env.PONDER_RPC_URL_420420417 ?? "https://eth-rpc-testnet.polkadot.io/"
    }
  },
  contracts: {
    TreasuryPolicy: {
      chain: "polkadotHubTestnet",
      abi: TreasuryPolicyAbi,
      address: "0xE190AC334CC5Be502A2e7b03Bc447d9E1Be6954D",
      startBlock: 7616012
    },
    EscrowCore: {
      chain: "polkadotHubTestnet",
      abi: EscrowCoreAbi,
      address: "0x642566F1A6FDff76D49C6e062f7464609455E0eC",
      startBlock: 7622561
    },
    ReputationSBT: {
      chain: "polkadotHubTestnet",
      abi: ReputationSbtAbi,
      address: "0xb3035d5272854f3eB725db4965Db244059bB11FC",
      startBlock: 7622659
    }
  }
});
