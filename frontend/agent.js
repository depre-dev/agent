import { apiUrl } from "./config.js";
import { initObservability } from "./observability.js";
import {
  debug,
  escapeHtml,
  formatAmount,
  html,
  renderHtml,
  setText,
  showToast
} from "./ui-helpers.js";

// Static agent-profile page. Renders `/api/agents/:wallet` into the DOM
// using the same XSS-safe html tagged template the main app uses. Reads
// the wallet from either `?wallet=0x…` query param or the trailing path
// segment when the page is served via a `/agents/:wallet` rewrite.

function extractWalletFromUrl() {
  const url = new URL(window.location.href);
  const query = url.searchParams.get("wallet");
  if (query) return query.trim();
  const match = url.pathname.match(/\/agents\/(0x[a-fA-F0-9]{40})\/?$/u);
  return match ? match[1] : "";
}

function shortenAddress(wallet) {
  if (!wallet) return "";
  return wallet.length > 10 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;
}

function formatAmountFromBase(amountObj) {
  if (!amountObj) return "—";
  const { amount, decimals, asset } = amountObj;
  try {
    const raw = BigInt(amount);
    const base = 10n ** BigInt(decimals);
    const whole = raw / base;
    const fraction = raw - whole * base;
    const fractionPadded = fraction.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/u, "");
    const human = fractionPadded ? `${whole}.${fractionPadded}` : whole.toString();
    return `${formatAmount(human)} ${asset ?? ""}`.trim();
  } catch {
    return "—";
  }
}

function formatCompletionRate(rate) {
  if (rate === null || rate === undefined) return "—";
  const pct = Math.round(rate * 100);
  return `${pct}%`;
}

function formatIsoDate(iso) {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-CH", { dateStyle: "medium", timeStyle: "short" });
}

function tierClass(tier) {
  if (tier === "elite") return "tier-ok";
  if (tier === "pro") return "status-ok";
  return "tier-warn";
}

function renderCategoryLevels(levels) {
  const entries = Object.entries(levels ?? {});
  if (entries.length === 0) return "No category tiers earned yet.";
  return entries
    .map(([category, level]) => `${escapeHtml(category)} · lvl ${escapeHtml(level)}`)
    .join(" · ");
}

function renderPreferredCategories(list) {
  if (!Array.isArray(list) || list.length === 0) return "No categories yet.";
  return list
    .map((entry) => `${escapeHtml(entry.category)} (${escapeHtml(entry.count)})`)
    .join(" · ");
}

function renderBadges(badges) {
  const root = document.getElementById("profile-badges");
  if (!root) return;
  if (!Array.isArray(badges) || badges.length === 0) {
    root.innerHTML =
      '<p class="empty-state">No badges yet. Once the wallet completes its first job, badges will appear here most-recent first.</p>';
    return;
  }

  const cards = badges.map((badge) => {
    const reward = formatAmountFromBase(badge.reward);
    const completed = formatIsoDate(badge.completedAt);
    const urlAttr = badge.badgeUrl ?? "#";
    return html`
      <article class="history-card">
        <div class="job-topline">
          <p class="job-id">${badge.jobId}</p>
          <span class="eligibility-pill eligible-yes">Level ${badge.level}</span>
        </div>
        <div class="catalog-meta">
          <span>${badge.category}</span>
          <span>${reward}</span>
          <span>${completed}</span>
        </div>
        <p>${badge.sessionId}</p>
        <a class="job-select-button" href="${urlAttr}" target="_blank" rel="noreferrer">
          View badge JSON
        </a>
      </article>
    `;
  });
  renderHtml(root, html`${cards}`);
}

function applyProfile(profile) {
  const wallet = profile.wallet ?? "";
  setText("profile-title", `Agent ${shortenAddress(wallet)}`);
  setText("profile-wallet", wallet);

  const tierEl = document.getElementById("profile-tier");
  if (tierEl) {
    tierEl.textContent = (profile.reputation?.tier ?? "starter").toUpperCase();
    tierEl.className = `status-pill ${tierClass(profile.reputation?.tier)}`;
  }

  setText("profile-badge-count", String(profile.stats?.totalBadges ?? 0));
  setText("profile-completion-rate", formatCompletionRate(profile.stats?.completionRate));
  setText("profile-last-active", formatIsoDate(profile.stats?.lastActive));

  setText("rep-skill", formatAmount(profile.reputation?.skill));
  setText("rep-reliability", formatAmount(profile.reputation?.reliability));
  setText("rep-economic", formatAmount(profile.reputation?.economic));
  setText("stat-approved", String(profile.stats?.approvedCount ?? 0));
  setText("stat-rejected", String(profile.stats?.rejectedCount ?? 0));
  setText("stat-total-earned", formatAmountFromBase(profile.stats?.totalEarned));
  setText("stat-active-since", formatIsoDate(profile.stats?.activeSince));
  setText("stat-category-levels", renderCategoryLevels(profile.categoryLevels));
  setText("stat-preferred-categories", renderPreferredCategories(profile.stats?.preferredCategories));
  setText(
    "profile-badges-meta",
    `${profile.stats?.totalBadges ?? 0} earned · fetched ${formatIsoDate(profile.fetchedAt)}`
  );

  const jsonLink = document.getElementById("profile-json-link");
  if (jsonLink) {
    jsonLink.href = apiUrl(`/agents/${wallet}`);
  }

  renderBadges(profile.badges);
}

function showError(message) {
  setText("profile-title", "Agent profile unavailable");
  setText("profile-lede", message);
  setText("profile-badge-count", "—");
  setText("profile-completion-rate", "—");
  setText("profile-last-active", "—");
  const root = document.getElementById("profile-badges");
  if (root) {
    root.innerHTML = `<p class="empty-state">${escapeHtml(message)}</p>`;
  }
}

async function boot() {
  initObservability();

  const wallet = extractWalletFromUrl();
  if (!/^0x[a-fA-F0-9]{40}$/u.test(wallet)) {
    showError(
      "No wallet specified. Append ?wallet=0x… to the URL (or route /agents/:wallet to this page) to load a profile."
    );
    return;
  }

  try {
    const response = await fetch(apiUrl(`/agents/${wallet}`), {
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message ?? body.error ?? `API returned ${response.status}`);
    }
    const profile = await response.json();
    if (profile.schemaVersion !== "v1") {
      throw new Error(
        `Unexpected schemaVersion "${profile.schemaVersion}". This page only renders v1 profiles.`
      );
    }
    applyProfile(profile);
  } catch (error) {
    debug.error("[agent-profile] load failed", error);
    const message = error?.message ?? "Failed to load agent profile.";
    showError(message);
    showToast(message, "error");
  }
}

boot();
