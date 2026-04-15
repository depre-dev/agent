export const formatAmount = (value) => {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "-";
};

export const setText = (id, value) => {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
};

export const setOverallStatus = (label, className) => {
  const pill = document.getElementById("system-pill");
  if (!pill) return;
  pill.textContent = label;
  pill.className = `status-pill ${className}`;
};

export const setActionStatus = (label, className) => {
  const pill = document.getElementById("action-pill");
  if (!pill) return;
  pill.textContent = label;
  pill.className = `status-pill ${className}`;
};
