import assert from "node:assert/strict";
import { test } from "node:test";
import { businessMinutesBetween, calculateSla, isReportableRequest } from "../src/sla.js";

const singapore = {
  id: 11,
  timezone: "Asia/Singapore",
  business_hours: {
    mon: { open: "08:00", close: "18:00" },
    tue: { open: "08:00", close: "18:00" },
    wed: { open: "08:00", close: "18:00" },
    thu: { open: "08:00", close: "18:00" },
    fri: { open: "08:00", close: "18:00" },
    sat: null,
    sun: null,
  },
};

function epoch(iso) {
  return Math.floor(Date.parse(iso) / 1000);
}

test("excludes canceled, deleted, and merged requests", () => {
  assert.equal(isReportableRequest({ status: "canceled", deleted_at: null, merged_into_id: null }), false);
  assert.equal(isReportableRequest({ status: "pending", deleted_at: "2026-10-01T00:00:00Z", merged_into_id: null }), false);
  assert.equal(isReportableRequest({ status: "pending", deleted_at: null, merged_into_id: 9 }), false);
  assert.equal(isReportableRequest({ status: "pending", deleted_at: null, merged_into_id: null }), true);
});

test("counts only site business hours and holidays, flooring the result", () => {
  const minutes = businessMinutesBetween(
    "2026-10-05T07:30:30Z",
    "2026-10-06T01:00:29Z",
    singapore,
    new Set(["2026-10-06"]),
  );
  assert.equal(minutes, 149);
});

test("uses elapsed seconds across Sydney daylight-saving changes", () => {
  const sydney = {
    id: 12,
    timezone: "Australia/Sydney",
    business_hours: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: { open: "00:00", close: "04:00" } },
  };
  assert.equal(
    businessMinutesBetween("2026-10-03T14:00:00Z", "2026-10-03T17:00:00Z", sydney, new Set()),
    180,
  );
});

test("uses the first non-reverted processing event with a human actor", () => {
  const result = calculateSla({
    request: {
      id: 42, status: "pending", priority: "High", created_at: "2026-10-05T00:00:00Z",
      deleted_at: null, merged_into_id: null,
    },
    site: singapore,
    holidays: new Set(),
    staffById: new Map([[3, { id: 3, name: "Current Name" }]]),
    events: [
      { id: 1, status: "processing", at: epoch("2026-10-05T01:00:00Z"), actor_id: 1, reverts_id: null, due_at: null },
      { id: 2, status: "pending", at: epoch("2026-10-05T02:00:00Z"), actor_id: 2, reverts_id: 1, due_at: null },
      { id: 3, status: "processing", at: epoch("2026-10-05T03:00:00Z"), actor_id: 3, reverts_id: null, due_at: null },
    ],
  });

  assert.deepEqual(result, {
    responder_id: 3,
    responder: "Current Name",
    response_business_minutes: 180,
    within_target: false,
    completed_late: null,
  });
});

test("uses the last complete event and latest local deadline even after a reopen", () => {
  const result = calculateSla({
    request: {
      id: 43, status: "processing", priority: "Low", created_at: "2026-10-06T00:00:00Z",
      deleted_at: null, merged_into_id: null,
    },
    site: singapore,
    holidays: new Set(),
    staffById: new Map(),
    events: [
      { id: 1, status: "pending", at: epoch("2026-10-06T00:10:00Z"), actor_id: null, reverts_id: null, due_at: "06/10/2026 10:00" },
      { id: 2, status: "complete", at: epoch("2026-10-06T02:01:00Z"), actor_id: null, reverts_id: null, due_at: null },
      { id: 3, status: "processing", at: epoch("2026-10-06T02:02:00Z"), actor_id: 9, reverts_id: null, due_at: null },
    ],
  });

  assert.equal(result.completed_late, true);
});
