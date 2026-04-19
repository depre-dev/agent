const BASE_CAPABILITIES = [
  "account:read",
  "account:fund",
  "events:read",
  "jobs:list",
  "jobs:claim",
  "jobs:preflight",
  "jobs:recommend",
  "jobs:submit",
  "payments:send",
  "reputation:read",
  "session:read",
  "session:timeline",
  "strategies:list",
  "subjobs:read"
];

const ROLE_CAPABILITIES = {
  admin: [
    "admin:status",
    "jobs:create",
    "jobs:fire-recurring",
    "jobs:pause-recurring",
    "jobs:resume-recurring",
    "subjobs:create"
  ],
  verifier: [
    "verifier:handlers:read",
    "verifier:result:read",
    "verifier:replay",
    "verifier:run"
  ]
};

export function resolveCapabilities(claims = {}) {
  const capabilities = new Set(BASE_CAPABILITIES);
  const roles = Array.isArray(claims.roles) ? claims.roles : [];
  for (const role of roles) {
    for (const capability of ROLE_CAPABILITIES[role] ?? []) {
      capabilities.add(capability);
    }
  }
  return [...capabilities].sort();
}

export function capabilityMatrix() {
  return {
    base: [...BASE_CAPABILITIES],
    roles: Object.fromEntries(
      Object.entries(ROLE_CAPABILITIES).map(([role, capabilities]) => [role, [...capabilities]])
    ),
    routes: {
      "/account": ["account:read"],
      "/account/fund": ["account:fund"],
      "/jobs": ["jobs:list"],
      "/jobs/recommendations": ["jobs:recommend"],
      "/jobs/preflight": ["jobs:preflight"],
      "/jobs/claim": ["jobs:claim"],
      "/jobs/submit": ["jobs:submit"],
      "/jobs/sub": ["subjobs:read", "subjobs:create"],
      "/session": ["session:read"],
      "/session/timeline": ["session:timeline"],
      "/events": ["events:read"],
      "/payments/send": ["payments:send"],
      "/reputation": ["reputation:read"],
      "/strategies": ["strategies:list"],
      "/admin/status": ["admin:status"],
      "/admin/jobs": ["jobs:create"],
      "/admin/jobs/fire": ["jobs:fire-recurring"],
      "/admin/jobs/pause": ["jobs:pause-recurring"],
      "/admin/jobs/resume": ["jobs:resume-recurring"],
      "/verifier/handlers": ["verifier:handlers:read"],
      "/verifier/result": ["verifier:result:read"],
      "/verifier/replay": ["verifier:replay"],
      "/verifier/run": ["verifier:run"]
    }
  };
}
