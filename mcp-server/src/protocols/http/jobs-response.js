const DEFAULT_AGENT_LIMIT = 25;
const MAX_AGENT_LIMIT = 100;

const SOURCE_LABELS = new Map([
  ["github_issue", "github"],
  ["open_data_dataset", "open_data"],
  ["openapi_spec", "openapi"],
  ["osv_advisory", "osv"],
  ["standards_spec", "standards"],
  ["wikipedia_article", "wikipedia"]
]);

const SOURCE_ALIASES = new Map([
  ["wiki", "wikipedia"],
  ["wikipedia_article", "wikipedia"],
  ["open_data", "open_data"],
  ["open_data_dataset", "open_data"],
  ["data_gov", "open_data"],
  ["datagov", "open_data"],
  ["open_api", "openapi"],
  ["openapi", "openapi"],
  ["openapi_spec", "openapi"],
  ["osv", "osv"],
  ["osv_advisory", "osv"],
  ["standards", "standards"],
  ["standards_spec", "standards"],
  ["github", "github"],
  ["github_issue", "github"]
]);

export function buildPublicJobsResponse(jobs, searchParams) {
  if (!usesAgentFriendlyQuery(searchParams)) {
    return jobs;
  }

  const limit = parseLimit(searchParams.get("limit"), DEFAULT_AGENT_LIMIT, MAX_AGENT_LIMIT);
  const offset = parseOffset(searchParams.get("offset"));
  const filters = parseJobFilters(searchParams);
  const filteredJobs = jobs.filter((job) => matchesFilters(job, filters));
  const page = filteredJobs.slice(offset, offset + limit);

  return {
    jobs: page.map(toCompactJobRow),
    count: page.length,
    total: filteredJobs.length,
    limit,
    offset,
    nextOffset: offset + limit < filteredJobs.length ? offset + limit : null,
    filters,
    compact: true
  };
}

function usesAgentFriendlyQuery(searchParams) {
  if (!searchParams || [...searchParams.keys()].length === 0) {
    return false;
  }
  return normalizeToken(searchParams.get("format") ?? searchParams.get("shape")) !== "full";
}

function parseJobFilters(searchParams) {
  return {
    source: normalizeSourceFilter(searchParams.get("source")),
    category: normalizeToken(searchParams.get("category")),
    state: normalizeToken(searchParams.get("state"))
  };
}

function matchesFilters(job, filters) {
  if (filters.source && !sourceCandidates(job).has(filters.source)) {
    return false;
  }
  if (filters.category && normalizeToken(job.category) !== filters.category) {
    return false;
  }
  if (filters.state) {
    const lifecycle = job.lifecycle ?? {};
    const state = normalizeToken(lifecycle.state ?? lifecycle.status ?? "open");
    const status = normalizeToken(lifecycle.status ?? state);
    if (filters.state !== state && filters.state !== status) {
      return false;
    }
  }
  return true;
}

function toCompactJobRow(job) {
  const lifecycle = job.lifecycle ?? {};
  const state = lifecycle.state ?? lifecycle.status ?? "open";
  return {
    id: job.id,
    title: job.title,
    state,
    source: publicSourceLabel(job),
    sourceType: job.source?.type ?? null,
    category: job.category ?? null,
    jobType: job.jobType ?? null,
    tier: job.tier ?? null,
    stake: job.claimStake ?? job.stake ?? null,
    reward: {
      asset: job.rewardAsset ?? null,
      amount: job.rewardAmount ?? null
    },
    createdAt: lifecycle.createdAt ?? null,
    summary: summarizeJob(job),
    definitionUrl: `/jobs/definition?jobId=${encodeURIComponent(job.id)}`
  };
}

function summarizeJob(job) {
  const description = String(job.description ?? "").replace(/\s+/gu, " ").trim();
  if (!description) {
    return "";
  }
  return description.length > 180 ? `${description.slice(0, 177)}...` : description;
}

function sourceCandidates(job) {
  const source = job.source ?? {};
  return new Set([
    publicSourceLabel(job),
    normalizeSourceFilter(source.type),
    normalizeSourceFilter(source.provider),
    normalizeSourceFilter(source.project)
  ].filter(Boolean));
}

function publicSourceLabel(job) {
  const rawType = normalizeToken(job.source?.type);
  if (SOURCE_LABELS.has(rawType)) {
    return SOURCE_LABELS.get(rawType);
  }
  return normalizeSourceFilter(job.source?.provider)
    ?? normalizeSourceFilter(job.source?.project)
    ?? rawType
    ?? normalizeToken(job.category)
    ?? "unknown";
}

function normalizeSourceFilter(value) {
  const token = normalizeToken(value);
  return token ? SOURCE_ALIASES.get(token) ?? token : undefined;
}

function normalizeToken(value) {
  const token = String(value ?? "").trim().toLowerCase().replace(/[-\s]+/gu, "_");
  return token || undefined;
}

function parseLimit(value, fallback, max) {
  const raw = Number(value ?? fallback);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return Math.min(Math.trunc(raw), max);
}

function parseOffset(value) {
  const raw = Number(value ?? 0);
  if (!Number.isFinite(raw) || raw < 0) {
    return 0;
  }
  return Math.trunc(raw);
}
