function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const el = byId(id);
  if (el) el.textContent = value;
}

function setHref(id, value) {
  const el = byId(id);
  if (el) el.setAttribute("href", value);
}

const EXAMPLE_WALLET = "0xfd2eae2043243fddd2721c0b42af1b8284fd6519";

function extractWallet() {
  const url = new URL(window.location.href);
  const query = url.searchParams.get("wallet");
  if (query) return query.trim().toLowerCase();
  const match = url.pathname.match(/\/agents\/(0x[a-fA-F0-9]{40})\/?$/u);
  return match ? match[1].toLowerCase() : "";
}

function formatAmountFromBase(amountObj) {
  if (!amountObj) return "—";
  try {
    const raw = BigInt(amountObj.amount ?? "0");
    const decimals = BigInt(amountObj.decimals ?? 18);
    const base = 10n ** decimals;
    const whole = raw / base;
    const fraction = raw % base;
    const fractionText = fraction.toString().padStart(Number(decimals), "0").slice(0, 4).replace(/0+$/u, "");
    const number = fractionText ? `${whole}.${fractionText}` : whole.toString();
    return `${number} ${amountObj.asset ?? ""}`.trim();
  } catch {
    return "—";
  }
}

function formatIso(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-CH", { dateStyle: "medium", timeStyle: "short" });
}

function renderBadges(badges = []) {
  const root = byId("profile-badges");
  if (!root) return;
  if (!badges.length) {
    root.innerHTML = '<p class="profile-empty">No approved badges yet. Once this wallet completes a verifier-approved run, badges will appear here.</p>';
    return;
  }

  root.innerHTML = badges.map((badge) => `
    <article class="badge-card">
      <p class="eyebrow">Badge</p>
      <h3>${badge.jobId}</h3>
      <div class="badge-meta">
        <span>${badge.category} · level ${badge.level}</span>
        <span>${formatAmountFromBase(badge.reward)}</span>
        <span>${formatIso(badge.completedAt)}</span>
      </div>
      <div class="link-row">
        <a class="button-ghost" href="${badge.badgeUrl ?? "#"}" target="_blank" rel="noreferrer">Open badge JSON</a>
      </div>
    </article>
  `).join("");
}

async function bootProfile() {
  const wallet = extractWallet();
  const loading = byId("profile-loading");
  if (!/^0x[a-f0-9]{40}$/u.test(wallet)) {
    if (loading) {
      loading.innerHTML = `No wallet specified. Open this page with <code>?wallet=0x…</code> or try <a href="/agents/${EXAMPLE_WALLET}">the example wallet profile</a>.`;
    }
    return;
  }

  setText("profile-wallet", wallet);
  setHref("profile-json-url", `https://api.averray.com/agents/${wallet}`);

  try {
    const response = await fetch(`https://api.averray.com/agents/${wallet}`, {
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`Profile lookup returned ${response.status}`);
    }
    const profile = await response.json();
    if (loading) loading.hidden = true;
    setText("profile-title", `Agent ${wallet.slice(0, 8)}…${wallet.slice(-4)}`);
    document.title = `Averray — ${wallet.slice(0, 8)}…${wallet.slice(-4)}`;
    setText("profile-tier", (profile.reputation?.tier ?? "starter").toUpperCase());
    setText("profile-skill", String(profile.reputation?.skill ?? 0));
    setText("profile-reliability", String(profile.reputation?.reliability ?? 0));
    setText("profile-economic", String(profile.reputation?.economic ?? 0));
    setText("profile-total-badges", String(profile.stats?.totalBadges ?? 0));
    setText("profile-approved", String(profile.stats?.approvedCount ?? 0));
    setText("profile-rejected", String(profile.stats?.rejectedCount ?? 0));
    setText("profile-completion-rate", profile.stats?.completionRate == null ? "—" : `${Math.round(profile.stats.completionRate * 100)}%`);
    setText("profile-total-earned", formatAmountFromBase(profile.stats?.totalEarned));
    setText("profile-active-since", formatIso(profile.stats?.activeSince));
    setText("profile-last-active", formatIso(profile.stats?.lastActive));
    setText(
      "profile-preferred-categories",
      Array.isArray(profile.stats?.preferredCategories) && profile.stats.preferredCategories.length
        ? profile.stats.preferredCategories.map((entry) => `${entry.category} (${entry.count})`).join(" · ")
        : "No preferred categories yet."
    );
    setText(
      "profile-category-levels",
      Object.keys(profile.categoryLevels ?? {}).length
        ? Object.entries(profile.categoryLevels).map(([category, level]) => `${category} · lvl ${level}`).join(" · ")
        : "No category levels yet."
    );
    renderBadges(profile.badges);
  } catch (error) {
    if (loading) loading.textContent = error?.message ?? "Failed to load profile.";
  }
}

bootProfile();
