import { ConfigError } from "../core/errors.js";

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
      if (!symbol || !address) {
        throw new ConfigError(`Invalid SUPPORTED_ASSETS entry: ${entry}`);
      }
      return { symbol, address };
    });
}

export function loadBlockchainConfig(env = process.env) {
  const requiredFields = [
    "RPC_URL",
    "SIGNER_PRIVATE_KEY",
    "TREASURY_POLICY_ADDRESS",
    "AGENT_ACCOUNT_ADDRESS",
    "ESCROW_CORE_ADDRESS",
    "REPUTATION_SBT_ADDRESS",
    "SUPPORTED_ASSETS"
  ];
  const configuredFields = requiredFields.filter((key) => Boolean(env[key]));
  const hasPartialConfig = configuredFields.length > 0 && configuredFields.length < requiredFields.length;
  if (hasPartialConfig) {
    const missing = requiredFields.filter((key) => !env[key]);
    throw new ConfigError(
      `Incomplete blockchain configuration. Missing: ${missing.join(", ")}`,
      { missing, configured: configuredFields }
    );
  }

  const supportedAssets = parseAssets(env.SUPPORTED_ASSETS);
  const enabled = configuredFields.length === requiredFields.length && supportedAssets.length > 0;

  if (configuredFields.length === requiredFields.length && supportedAssets.length === 0) {
    throw new ConfigError("SUPPORTED_ASSETS must contain at least one symbol:address entry.");
  }

  return {
    enabled,
    rpcUrl: env.RPC_URL ?? "",
    signerPrivateKey: env.SIGNER_PRIVATE_KEY ?? "",
    treasuryPolicyAddress: env.TREASURY_POLICY_ADDRESS ?? "",
    agentAccountAddress: env.AGENT_ACCOUNT_ADDRESS ?? "",
    escrowCoreAddress: env.ESCROW_CORE_ADDRESS ?? "",
    reputationSbtAddress: env.REPUTATION_SBT_ADDRESS ?? "",
    supportedAssets
  };
}
