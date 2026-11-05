import assert from "node:assert/strict";
import { test } from "node:test";
import { createRepository } from "../src/repository.js";
import { SyncService } from "../src/sync.js";

const site = {
  id: 11,
  timezone: "Asia/Singapore",
  business_hours: {
    mon: { open: "08:00", close: "18:00" }, tue: { open: "08:00", close: "18:00" },
    wed: { open: "08:00", close: "18:00" }, thu: { open: "08:00", close: "18:00" },
    fri: { open: "08:00", close: "18:00" }, sat: null, sun: null,
  },
};

test("imports metadata and change pages idempotently before becoming ready", async () => {
  let changesCalls = 0;
  const client = {
    async get(pathname) {
      if (pathname === "/v1/sites") return { data: [site] };
      if (pathname === "/v1/sites/11/holidays") return { data: [] };
      if (pathname === "/v1/staff") return { data: [{ id: 304, name: "Benjamin Tan" }] };
      if (pathname === "/v1/changes") {
        changesCalls += 1;
        return changesCalls === 1
          ? {
              data: [
                { type: "request.created", request: { id: 42, site_id: 11, status: "pending", priority: "High", created_at: "2026-10-05T00:00:00Z", deleted_at: null, merged_into_id: null } },
                { type: "event.created", request_id: 42, event: { id: 100, status: "processing", at: 1791162000, actor_id: 304, reverts_id: null, due_at: null } },
              ],
              next_cursor: "page-1",
              has_more: true,
            }
          : {
              data: [{ type: "event.created", request_id: 42, event: { id: 100, status: "processing", at: 1791162000, actor_id: 304, reverts_id: null, due_at: null } }],
              next_cursor: "page-2",
              has_more: false,
            };
      }
      throw new Error(`unexpected ${pathname}`);
    },
  };
  const repository = createRepository(":memory:");
  const service = new SyncService({ client, repository, intervalMs: 60_000 });

  await service.syncOnce();

  assert.equal(service.isReady(), true);
  assert.equal(repository.getSyncCursor(), "page-2");
  assert.equal(repository.getEventsForRequest(42).length, 1);
  assert.deepEqual(repository.getSlaRow(42), {
    id: 42,
    site_id: 11,
    responder_id: 304,
    responder: "Benjamin Tan",
    response_business_minutes: 60,
    within_target: true,
    completed_late: null,
  });
});

test("restarts the change feed without an expired cursor", async () => {
  const cursors = [];
  const client = {
    async get(pathname, params = {}) {
      if (pathname === "/v1/sites") return { data: [site] };
      if (pathname === "/v1/sites/11/holidays") return { data: [] };
      if (pathname === "/v1/staff") return { data: [] };
      if (pathname === "/v1/changes") {
        cursors.push(params.cursor ?? null);
        if (params.cursor === "expired") {
          const error = new Error("cursor expired");
          error.status = 410;
          throw error;
        }
        return { data: [], next_cursor: "fresh", has_more: false };
      }
      throw new Error(`unexpected ${pathname}`);
    },
  };
  const repository = createRepository(":memory:");
  repository.setSyncCursor("expired");

  await new SyncService({ client, repository }).syncOnce();

  assert.deepEqual(cursors, ["expired", null]);
  assert.equal(repository.getSyncCursor(), "fresh");
});

test("keeps the polling loop alive after a recoverable sync failure", async () => {
  const logged = [];
  const service = new SyncService({
    client: {},
    repository: {},
    logger: { error: (message) => logged.push(message) },
  });
  service.syncOnce = async () => { throw new Error("temporary upstream failure"); };
  let scheduled = false;
  service.schedule = () => { scheduled = true; };

  await service.start();

  assert.equal(scheduled, true);
  assert.deepEqual(logged, ["Helpdesk sync failed; will retry"]);
});

test("backs off and retries a temporary upstream 503", async () => {
  let calls = 0;
  const waits = [];
  const service = new SyncService({
    client: {
      async get() {
        calls += 1;
        if (calls === 1) {
          const error = new Error("temporary outage");
          error.status = 503;
          throw error;
        }
        return { data: [] };
      },
    },
    repository: {},
    sleep: async (milliseconds) => waits.push(milliseconds),
  });

  assert.deepEqual(await service.getWithRetry("/v1/changes"), { data: [] });
  assert.deepEqual(waits, [1000]);
  assert.equal(calls, 2);
});

test("recalculates each changed request once per change-feed page", async () => {
  const repository = createRepository(":memory:");
  const client = {
    async get(pathname) {
      if (pathname === "/v1/sites") return { data: [] };
      if (pathname === "/v1/staff") return { data: [] };
      if (pathname === "/v1/changes") return {
        data: [
          { type: "request.created", request: { id: 88, site_id: 11, status: "pending", priority: "Low", created_at: "2026-10-01T00:00:00Z", deleted_at: null, merged_into_id: null } },
          { type: "event.created", request_id: 88, event: { id: 1, status: "pending", at: 1, actor_id: null, reverts_id: null } },
          { type: "event.created", request_id: 88, event: { id: 2, status: "processing", at: 2, actor_id: 304, reverts_id: null } },
        ], next_cursor: "done", has_more: false,
      };
      throw new Error(`unexpected ${pathname}`);
    },
  };
  const service = new SyncService({ client, repository });
  const refreshed = [];
  service.refreshRequest = (requestId) => refreshed.push(requestId);

  await service.syncOnce();

  assert.deepEqual(refreshed, [88]);
});
