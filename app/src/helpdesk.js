export class HelpdeskError extends Error {
  constructor(message, { status, retryAfterSeconds = null } = {}) {
    super(message);
    this.name = "HelpdeskError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class HelpdeskClient {
  constructor({
    baseUrl = process.env.HELPDESK_URL || "http://localhost:4010",
    token = process.env.HELPDESK_TOKEN || "",
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  // GET a path (e.g. "/some/endpoint") with optional query params; returns parsed JSON.
  async get(pathname, params = {}) {
    const url = new URL(this.baseUrl + pathname);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new HelpdeskError(`Helpdesk API GET ${url.pathname} failed: ${res.status} ${body}`, {
        status: res.status,
        retryAfterSeconds: Number(res.headers.get("Retry-After")) || null,
      });
    }
    return res.json();
  }
}
