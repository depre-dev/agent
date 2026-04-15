const setText = (id, value) => {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
};

const setOverallStatus = (label, className) => {
  const pill = document.getElementById("system-pill");
  if (!pill) return;
  pill.textContent = label;
  pill.className = `status-pill ${className}`;
};

async function readJson(path) {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

async function boot() {
  try {
    const [health, onboarding, index] = await Promise.all([
      readJson("/api/health"),
      readJson("/api/onboarding"),
      readJson("/index/")
    ]);

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

boot();
