import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRepository, defaultDatabasePath } from "../src/repository.js";

test("uses an app-local data directory when DATABASE_PATH is unset", () => {
  assert.equal(
    defaultDatabasePath(null),
    path.join(process.cwd(), "data", "sla-report.db"),
  );
});

test("creates the parent directory for a file-backed database", () => {
  const databasePath = path.join(tmpdir(), `sla-report-${Date.now()}`, "data", "report.db");
  const repository = createRepository(databasePath);

  assert.equal(existsSync(databasePath), true);
  repository.close();
  rmSync(path.dirname(path.dirname(databasePath)), { recursive: true, force: true });
});

test("repository upserts remote requests and events without duplication", () => {
  const repository = createRepository(":memory:");
  repository.upsertRequest({
    id: 42,
    site_id: 11,
    status: "pending",
    priority: "High",
    created_at: "2026-10-06T02:15:07Z",
    deleted_at: null,
    merged_into_id: null,
  });
  repository.upsertRequest({
    id: 42,
    site_id: 11,
    status: "processing",
    priority: "High",
    created_at: "2026-10-06T02:15:07Z",
    deleted_at: null,
    merged_into_id: null,
  });
  repository.upsertEvent(42, {
    id: 100,
    status: "processing",
    at: 1791252907,
    actor_id: 304,
    actor_name: "Old name",
    assignee_name: null,
    due_at: null,
    note: null,
    reverts_id: null,
  });
  repository.upsertEvent(42, {
    id: 100,
    status: "processing",
    at: 1791252907,
    actor_id: 304,
    actor_name: "Old name",
    assignee_name: null,
    due_at: null,
    note: "updated payload",
    reverts_id: null,
  });

  assert.equal(repository.getRequest(42).status, "processing");
  assert.deepEqual(repository.getEventsForRequest(42), [{
    id: 100,
    status: "processing",
    at: 1791252907,
    actor_id: 304,
    actor_name: "Old name",
    assignee_name: null,
    due_at: null,
    note: "updated payload",
    reverts_id: null,
  }]);
});

test("repository persists the latest change cursor", () => {
  const repository = createRepository(":memory:");
  assert.equal(repository.getSyncCursor(), null);
  repository.setSyncCursor("cursor-101");
  assert.equal(repository.getSyncCursor(), "cursor-101");
});
