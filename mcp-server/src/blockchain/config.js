function parseAssets(rawAssets) {
  if (!rawAssets) {
    return [];
  }

  return rawAssets
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [symbol, address] = entry.split(":");
      return { symbol, address };
    });
}

export function loadBlockchainConfig(env = process.env) {
  const supportedAssets = parseAssets(env.SUPPORTED_ASSETS);
  const enabled = Boolean(
    env.RPC_URL &&
    env.AGENT_ACCOUNT_ADDRESS &&
    env.ESCROW_CORE_ADDRESS &&
    env.REPUTATION_SBT_ADDRESS &&
    supportedAssets.length > 0
  );

  return {
    enabled,
    rpcUrl: env.RPC_URL ?? "",
    signerPrivateKey: env.SIGNER_PRIVATE_KEY ?? "",
    agentAccountAddress: env.AGENT_ACCOUNT_ADDRESS ?? "",
    escrowCoreAddress: env.ESCROW_CORE_ADDRESS ?? "",
    reputationSbtAddress: env.REPUTATION_SBT_ADDRESS ?? "",
    supportedAssets
  };
}

