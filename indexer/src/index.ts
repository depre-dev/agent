import { hexToString } from "viem";

import { ponder } from "ponder:registry";
import schema from "ponder:schema";

import { EscrowCoreAbi } from "../abis/contractsAbi";

const payoutModeLabels = ["single", "milestone"] as const;
const jobStateLabels = ["none", "open", "claimed", "submitted", "rejected", "disputed", "closed"] as const;

const decodeBytes32 = (value: string) => {
  try {
    return hexToString(value as `0x${string}`, { size: 32 }).replace(/\u0000/g, "");
  } catch {
    return value;
  }
};

const toEventId = (txHash: string, logIndex: number | bigint) => `${txHash}-${logIndex.toString()}`;

const toTier = (skill: bigint) => {
  if (skill >= 200n) return "elite";
  if (skill >= 100n) return "pro";
  return "starter";
};

const syncJob = async ({
  context,
  event,
  jobId
}: {
  context: any;
  event: any;
  jobId: `0x${string}`;
}) => {
  const live = await context.client.readContract({
    abi: EscrowCoreAbi,
    address: event.log.address,
    functionName: "jobs",
    args: [jobId]
  });

  const [
    poster,
    worker,
    asset,
    verifierMode,
    category,
    reward,
    opsReserve,
    contingencyReserve,
    released,
    claimExpiry,
    claimStake,
    claimStakeBps,
    payoutMode,
    state
  ] = live;

  await context.db
    .insert(schema.job)
    .values({
      id: jobId,
      poster,
      worker: worker === "0x0000000000000000000000000000000000000000" ? null : worker,
      asset,
      category,
      categoryLabel: decodeBytes32(category),
      verifierMode,
      verifierModeLabel: decodeBytes32(verifierMode),
      reward,
      opsReserve,
      contingencyReserve,
      released,
      claimExpiry,
      claimStake,
      claimStakeBps,
      payoutMode,
      payoutModeLabel: payoutModeLabels[payoutMode] ?? "unknown",
      state,
      stateLabel: jobStateLabels[state] ?? "unknown",
      createdAtBlock: event.block.number,
      createdAtTimestamp: event.block.timestamp,
      updatedAtBlock: event.block.number,
      updatedAtTimestamp: event.block.timestamp,
      lastTxHash: event.transaction.hash
    })
    .onConflictDoUpdate((row: any) => ({
      worker: row.worker,
      released: row.released,
      claimExpiry: row.claimExpiry,
      claimStake: row.claimStake,
      claimStakeBps: row.claimStakeBps,
      payoutMode: row.payoutMode,
      payoutModeLabel: row.payoutModeLabel,
      state: row.state,
      stateLabel: row.stateLabel,
      updatedAtBlock: row.updatedAtBlock,
      updatedAtTimestamp: row.updatedAtTimestamp,
      lastTxHash: row.lastTxHash
    }));
};

ponder.on("EscrowCore:JobFunded", async ({ event, context }) => {
  await syncJob({ context, event, jobId: event.args.jobId });
  await context.db.insert(schema.jobEvent).values({
    id: toEventId(event.transaction.hash, event.log.logIndex),
    jobId: event.args.jobId,
    kind: "JobFunded",
    actor: event.args.poster,
    amount: event.args.totalReserved,
    evidenceHash: null,
    reasonCode: null,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp
  });
});

ponder.on("EscrowCore:JobClaimed", async ({ event, context }) => {
  await syncJob({ context, event, jobId: event.args.jobId });
  await context.db.insert(schema.jobEvent).values({
    id: toEventId(event.transaction.hash, event.log.logIndex),
    jobId: event.args.jobId,
    kind: "JobClaimed",
    actor: event.args.worker,
    amount: event.args.claimStake,
    evidenceHash: null,
    reasonCode: null,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp
  });
});

ponder.on("EscrowCore:WorkSubmitted", async ({ event, context }) => {
  await syncJob({ context, event, jobId: event.args.jobId });
  await context.db.insert(schema.jobEvent).values({
    id: toEventId(event.transaction.hash, event.log.logIndex),
    jobId: event.args.jobId,
    kind: "WorkSubmitted",
    actor: event.args.worker,
    amount: null,
    evidenceHash: event.args.evidenceHash,
    reasonCode: null,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp
  });
});

ponder.on("EscrowCore:JobReopened", async ({ event, context }) => {
  await syncJob({ context, event, jobId: event.args.jobId });
  await context.db.insert(schema.jobEvent).values({
    id: toEventId(event.transaction.hash, event.log.logIndex),
    jobId: event.args.jobId,
    kind: "JobReopened",
    actor: null,
    amount: null,
    evidenceHash: null,
    reasonCode: null,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp
  });
});

ponder.on("EscrowCore:JobRejected", async ({ event, context }) => {
  await syncJob({ context, event, jobId: event.args.jobId });
  await context.db.insert(schema.jobEvent).values({
    id: toEventId(event.transaction.hash, event.log.logIndex),
    jobId: event.args.jobId,
    kind: "JobRejected",
    actor: null,
    amount: null,
    evidenceHash: null,
    reasonCode: event.args.reasonCode,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp
  });
});

ponder.on("EscrowCore:DisputeOpened", async ({ event, context }) => {
  await syncJob({ context, event, jobId: event.args.jobId });
  await context.db.insert(schema.jobEvent).values({
    id: toEventId(event.transaction.hash, event.log.logIndex),
    jobId: event.args.jobId,
    kind: "DisputeOpened",
    actor: event.args.opener,
    amount: null,
    evidenceHash: null,
    reasonCode: null,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp
  });
});

ponder.on("EscrowCore:JobClosed", async ({ event, context }) => {
  await syncJob({ context, event, jobId: event.args.jobId });
  await context.db.insert(schema.jobEvent).values({
    id: toEventId(event.transaction.hash, event.log.logIndex),
    jobId: event.args.jobId,
    kind: "JobClosed",
    actor: event.args.worker,
    amount: event.args.releasedAmount,
    evidenceHash: null,
    reasonCode: null,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp
  });
  const live = await context.db.find(schema.job, { id: event.args.jobId });
  if (live) {
    await context.db.insert(schema.payout).values({
      id: toEventId(event.transaction.hash, event.log.logIndex),
      jobId: event.args.jobId,
      asset: live.asset,
      amount: event.args.releasedAmount,
      recipient: event.args.worker,
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp
    });
  }
});

ponder.on("ReputationSBT:BadgeMinted", async ({ event, context }) => {
  await context.db.insert(schema.badgeMint).values({
    id: event.args.tokenId.toString(),
    tokenId: event.args.tokenId,
    account: event.args.account,
    category: event.args.category,
    categoryLabel: decodeBytes32(event.args.category),
    level: event.args.level,
    metadataUri: event.args.metadataURI,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp
  });
});

ponder.on("ReputationSBT:ReputationUpdated", async ({ event, context }) => {
  await context.db
    .insert(schema.reputationSnapshot)
    .values({
      id: toEventId(event.transaction.hash, event.log.logIndex),
      account: event.args.account,
      skill: event.args.skill,
      reliability: event.args.reliability,
      economic: event.args.economic,
      tier: toTier(event.args.skill),
      txHash: event.transaction.hash,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp
    });
});

ponder.on("ReputationSBT:ReputationSlashed", async ({ event, context }) => {
  await context.db.insert(schema.reputationSlash).values({
    id: toEventId(event.transaction.hash, event.log.logIndex),
    account: event.args.account,
    skillDelta: event.args.skillDelta,
    reliabilityDelta: event.args.reliabilityDelta,
    economicDelta: event.args.economicDelta,
    reasonCode: event.args.reasonCode,
    newSkill: event.args.newSkill,
    newReliability: event.args.newReliability,
    newEconomic: event.args.newEconomic,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp
  });

  await context.db.insert(schema.reputationSnapshot).values({
    id: `${toEventId(event.transaction.hash, event.log.logIndex)}-slash`,
    account: event.args.account,
    skill: event.args.newSkill,
    reliability: event.args.newReliability,
    economic: event.args.newEconomic,
    tier: toTier(event.args.newSkill),
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp
  });
});

ponder.on("TreasuryPolicy:OutflowRecorded", async ({ event, context }) => {
  await context.db.insert(schema.treasuryOutflow).values({
    id: toEventId(event.transaction.hash, event.log.logIndex),
    day: event.args.day,
    amount: event.args.amount,
    newTotal: event.args.newTotal,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp
  });
});

ponder.on("AgentAccountCore:JobStakeLocked", async ({ event, context }) => {
  await context.db.insert(schema.jobStakeEvent).values({
    id: toEventId(event.transaction.hash, event.log.logIndex),
    account: event.args.account,
    asset: event.args.asset,
    kind: "locked",
    amount: event.args.amount,
    posterAmount: null,
    treasuryAmount: null,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp
  });
});

ponder.on("AgentAccountCore:JobStakeReleased", async ({ event, context }) => {
  await context.db.insert(schema.jobStakeEvent).values({
    id: toEventId(event.transaction.hash, event.log.logIndex),
    account: event.args.account,
    asset: event.args.asset,
    kind: "released",
    amount: event.args.amount,
    posterAmount: null,
    treasuryAmount: null,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp
  });
});

ponder.on("AgentAccountCore:JobStakeSlashed", async ({ event, context }) => {
  await context.db.insert(schema.jobStakeEvent).values({
    id: toEventId(event.transaction.hash, event.log.logIndex),
    account: event.args.account,
    asset: event.args.asset,
    kind: "slashed",
    amount: event.args.amount,
    posterAmount: event.args.posterAmount,
    treasuryAmount: event.args.treasuryAmount,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp
  });
});
