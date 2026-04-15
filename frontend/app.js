import { DEFAULT_ESCALATION_MESSAGE, DEFAULT_POSTER_TERMS, DEFAULT_WALLET } from "./constants.js";
import { postJson, readJson } from "./http-client.js";
import { buildEvidenceTemplate, parseTerms } from "./job-utils.js";
import {
  applySessionState,
  applyVerificationState,
  refreshActionPanel,
  renderCatalog,
  renderRecommendations,
  updateAccount,
  updateReputation,
  updateSelectedJob
} from "./renderers.js";
import { readPersistedState, state } from "./state.js";
import { setOverallStatus, setText } from "./ui-helpers.js";

async function restoreSession(sessionId) {
  if (!sessionId) {
    applySessionState(undefined);
    applyVerificationState(undefined);
    refreshActionPanel();
    return;
  }

  const session = await readJson(`/api/session?sessionId=${encodeURIComponent(sessionId)}`);
  applySessionState(session);

  try {
    const result = await readJson(`/api/verifier/result?sessionId=${encodeURIComponent(sessionId)}`);
    if (result?.status !== "not_found") {
      applyVerificationState(result);
    } else {
      applyVerificationState(undefined);
    }
  } catch {
    applyVerificationState(undefined);
  }

  refreshActionPanel();
}

async function selectJob(jobId) {
  const job = await readJson(`/api/jobs/definition?jobId=${encodeURIComponent(jobId)}`);
  updateSelectedJob(job);

  const persisted = readPersistedState();
  const expectedSessionId =
    persisted.wallet === state.wallet && persisted.selectedJobId === job.id ? persisted.sessionId : "";

  if (expectedSessionId) {
    try {
      await restoreSession(expectedSessionId);
      setText("action-feedback", `Restored prior session ${expectedSessionId}.`);
      return;
    } catch {
      applySessionState(undefined);
      applyVerificationState(undefined);
    }
  }

  applySessionState(undefined);
  applyVerificationState(undefined);
  setText("action-feedback", `Loaded ${job.id}. Claim it when you are ready.`);
  refreshActionPanel();
}

async function loadWallet(wallet) {
  state.wallet = wallet;
  setText("wallet-feedback", "Refreshing live operator view...");

  const [account, reputation, recommendations] = await Promise.all([
    readJson(`/api/account?wallet=${encodeURIComponent(wallet)}`),
    readJson(`/api/reputation?wallet=${encodeURIComponent(wallet)}`),
    readJson(`/api/jobs/recommendations?wallet=${encodeURIComponent(wallet)}`)
  ]);

  state.recommendations = recommendations;

  updateAccount(account);
  updateReputation(reputation);
  renderRecommendations(recommendations);
  setText("job-count", `${recommendations.length} recommendations`);
  setText("wallet-feedback", `Loaded live data for ${wallet}.`);
  localStorage.setItem("averray:last-wallet", wallet);

  const persisted = readPersistedState();
  const nextJobId = recommendations.some((job) => job.jobId === persisted.selectedJobId)
    ? persisted.selectedJobId
    : recommendations[0]?.jobId ?? "";

  if (nextJobId) {
    await selectJob(nextJobId);
  } else if (!state.selectedJobId) {
    updateSelectedJob(undefined);
    setText("action-feedback", "No action flow available until recommendations appear.");
  }
}

async function loadCatalog() {
  const jobs = await readJson("/api/jobs");
  state.catalog = jobs;
  renderCatalog(jobs);
  setText("catalog-count", `${jobs.length} jobs live`);
}

async function claimSelectedJob() {
  if (!state.selectedJobId) return;

  const idempotencyKey = `ui:${state.wallet}:${state.selectedJobId}`;
  setText("action-feedback", `Claiming ${state.selectedJobId}...`);

  const session = await postJson(
    `/api/jobs/claim?wallet=${encodeURIComponent(state.wallet)}&jobId=${encodeURIComponent(state.selectedJobId)}&idempotencyKey=${encodeURIComponent(idempotencyKey)}`
  );

  applySessionState(session);
  applyVerificationState(undefined);
  setText("action-feedback", `Claimed ${state.selectedJobId}. Session ${session.sessionId} is ready for submission.`);
  refreshActionPanel();
}

async function submitSelectedWork() {
  if (!state.session?.sessionId) return;

  const evidenceInput = document.getElementById("evidence-input");
  const evidence = evidenceInput?.value?.trim() || buildEvidenceTemplate(state.selectedJob);

  setText("action-feedback", `Submitting work for ${state.session.sessionId}...`);
  const session = await postJson(
    `/api/jobs/submit?sessionId=${encodeURIComponent(state.session.sessionId)}&evidence=${encodeURIComponent(evidence)}`
  );

  applySessionState(session);
  setText("action-feedback", "Submission stored. Run the verifier to settle the result.");
  refreshActionPanel();
}

async function verifySelectedWork() {
  if (!state.session?.sessionId) return;

  const evidenceInput = document.getElementById("evidence-input");
  const evidence = evidenceInput?.value?.trim() || buildEvidenceTemplate(state.selectedJob);

  setText("action-feedback", `Running verifier for ${state.session.sessionId}...`);
  const result = await postJson(
    `/api/verifier/run?sessionId=${encodeURIComponent(state.session.sessionId)}&evidence=${encodeURIComponent(evidence)}`
  );

  applyVerificationState(result);
  setText(
    "action-feedback",
    result.outcome === "approved"
      ? `Verifier approved the submission with ${result.reasonCode}.`
      : `Verifier returned ${result.outcome} with ${result.reasonCode}.`
  );
  refreshActionPanel();
}

async function refreshCurrentSession() {
  if (!state.session?.sessionId) return;

  setText("action-feedback", `Refreshing ${state.session.sessionId}...`);
  await restoreSession(state.session.sessionId);
  setText("action-feedback", `Refreshed session ${state.session.sessionId}.`);
}

function syncPosterDefaults(force = false) {
  const verifierMode = document.getElementById("poster-verifier-mode")?.value ?? "benchmark";
  const terms = document.getElementById("poster-verifier-terms");
  const escalation = document.getElementById("poster-escalation");

  if (terms && (force || !terms.value.trim())) {
    terms.value = DEFAULT_POSTER_TERMS[verifierMode] ?? "";
  }

  if (escalation && (force || !escalation.value.trim())) {
    escalation.value = DEFAULT_ESCALATION_MESSAGE;
  }
}

async function createPosterJob() {
  const form = document.getElementById("poster-form");
  const formData = new FormData(form);
  const category = String(formData.get("category") ?? "").trim().toLowerCase();
  const verifierMode = String(formData.get("verifierMode") ?? "benchmark");
  const outputSchemaRef = String(formData.get("outputSchemaRef") ?? "").trim() || `schema://jobs/${category}-output`;

  const payload = {
    id: String(formData.get("id") ?? "").trim(),
    category,
    tier: String(formData.get("tier") ?? "starter"),
    rewardAmount: Number(formData.get("rewardAmount") ?? 0),
    verifierMode,
    outputSchemaRef,
    inputSchemaRef: `schema://jobs/${category}-input`,
    claimTtlSeconds: Number(formData.get("claimTtlSeconds") ?? 3600),
    retryLimit: Number(formData.get("retryLimit") ?? 1),
    requiresSponsoredGas: formData.get("requiresSponsoredGas") === "on",
    verifierTerms: parseTerms(formData.get("verifierTerms")),
    verifierMatchMode: String(formData.get("verifierMatchMode") ?? "contains_all"),
    verifierMinimumMatches: Number(formData.get("verifierMinimumMatches") ?? 2),
    escalationMessage: String(formData.get("escalationMessage") ?? "").trim() || DEFAULT_ESCALATION_MESSAGE,
    autoApprove: formData.get("autoApprove") === "on"
  };

  setText("poster-feedback", `Creating ${payload.id || "job"}...`);
  const job = await postJson("/api/admin/jobs", payload);
  setText("poster-feedback", `Created ${job.id}. Refreshing catalog and operator view...`);
  await Promise.all([loadCatalog(), loadWallet(state.wallet)]);
  await selectJob(job.id);
  setText("poster-feedback", `Created ${job.id} and loaded it into the execution flow.`);
}

function wireWalletForm(walletForm, walletInput) {
  walletForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const wallet = walletInput?.value?.trim();
    if (!wallet) {
      setText("wallet-feedback", "Enter a wallet address first.");
      return;
    }

    try {
      await loadWallet(wallet);
    } catch (error) {
      console.error(error);
      setText("wallet-feedback", error.message ?? "Failed to load wallet data.");
    }
  });
}

function wireJobSelection(jobList) {
  jobList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-job-id]");
    if (!button) return;

    try {
      await selectJob(button.dataset.jobId);
    } catch (error) {
      console.error(error);
      setText("action-feedback", error.message ?? "Failed to load job definition.");
    }
  });
}

function wireCatalogSelection(catalogList) {
  catalogList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-catalog-job-id]");
    if (!button) return;

    try {
      await selectJob(button.dataset.catalogJobId);
      setText("poster-feedback", `Loaded ${button.dataset.catalogJobId} into the execution flow.`);
    } catch (error) {
      console.error(error);
      setText("poster-feedback", error.message ?? "Failed to load catalog job.");
    }
  });
}

function wireActionButtons({ claimButton, submitButton, verifyButton, refreshButton }) {
  claimButton?.addEventListener("click", async () => {
    try {
      await claimSelectedJob();
    } catch (error) {
      console.error(error);
      setText("action-feedback", error.message ?? "Claim failed.");
    }
  });

  submitButton?.addEventListener("click", async () => {
    try {
      await submitSelectedWork();
    } catch (error) {
      console.error(error);
      setText("action-feedback", error.message ?? "Submit failed.");
    }
  });

  verifyButton?.addEventListener("click", async () => {
    try {
      await verifySelectedWork();
    } catch (error) {
      console.error(error);
      setText("action-feedback", error.message ?? "Verification failed.");
    }
  });

  refreshButton?.addEventListener("click", async () => {
    try {
      await refreshCurrentSession();
    } catch (error) {
      console.error(error);
      setText("action-feedback", error.message ?? "Refresh failed.");
    }
  });
}

function wirePosterControls({ posterForm, refreshCatalogButton, verifierModeSelect }) {
  posterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await createPosterJob();
    } catch (error) {
      console.error(error);
      setText("poster-feedback", error.message ?? "Create job failed.");
    }
  });

  refreshCatalogButton?.addEventListener("click", async () => {
    try {
      setText("poster-feedback", "Refreshing live catalog...");
      await loadCatalog();
      setText("poster-feedback", "Catalog refreshed.");
    } catch (error) {
      console.error(error);
      setText("poster-feedback", error.message ?? "Catalog refresh failed.");
    }
  });

  verifierModeSelect?.addEventListener("change", () => {
    syncPosterDefaults(true);
  });
}

async function loadPlatformStatus() {
  try {
    const [health, onboarding, index] = await Promise.all([readJson("/api/health"), readJson("/api/onboarding"), readJson("/index/")]);

    setText("api-status", health.status === "ok" ? "Healthy" : "Unexpected");
    setText("index-status", index.status === "ok" ? "Serving" : "Unexpected");
    setText("protocol-status", onboarding.protocols.join(" / ").toUpperCase());
    setText("starter-flow", `${onboarding.onboarding.starterFlow.length} live steps`);
    setOverallStatus("Online", "status-ok");
  } catch (error) {
    console.error(error);
    setText("api-status", "Unavailable");
    setText("index-status", "Unavailable");
    setText("protocol-status", "Check routes");
    setText("starter-flow", "Waiting for API");
    setOverallStatus("Attention needed", "status-pending");
  }
}

async function boot() {
  const walletInput = document.getElementById("wallet-input");
  const walletForm = document.getElementById("wallet-form");
  const jobList = document.getElementById("job-list");
  const claimButton = document.getElementById("claim-button");
  const submitButton = document.getElementById("submit-button");
  const verifyButton = document.getElementById("verify-button");
  const refreshButton = document.getElementById("refresh-session-button");
  const posterForm = document.getElementById("poster-form");
  const refreshCatalogButton = document.getElementById("refresh-catalog-button");
  const catalogList = document.getElementById("catalog-list");
  const verifierModeSelect = document.getElementById("poster-verifier-mode");
  const initialWallet = localStorage.getItem("averray:last-wallet") || DEFAULT_WALLET;

  if (walletInput) walletInput.value = initialWallet;
  syncPosterDefaults(true);

  await loadPlatformStatus();

  try {
    await Promise.all([loadWallet(initialWallet), loadCatalog()]);
  } catch (error) {
    console.error(error);
    setText("wallet-feedback", error.message ?? "Failed to load wallet data.");
    renderRecommendations([]);
    setText("poster-feedback", error.message ?? "Failed to load poster workspace.");
  }

  wireWalletForm(walletForm, walletInput);
  wireJobSelection(jobList);
  wireCatalogSelection(catalogList);
  wireActionButtons({ claimButton, submitButton, verifyButton, refreshButton });
  wirePosterControls({ posterForm, refreshCatalogButton, verifierModeSelect });
  refreshActionPanel();
}

boot();
