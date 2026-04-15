async function requestJson(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new Error(payload?.error ?? payload?.status ?? `${path} returned ${response.status}`);
  }

  return payload;
}

export function readJson(path) {
  return requestJson(path);
}

export function postJson(path, body = undefined) {
  return requestJson(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
