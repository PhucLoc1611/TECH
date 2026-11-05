import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { createRepository } from "../src/repository.js";

function seed(repository) {
  const rows = [
    { id: 2, site_id: 11, date: "2026-10-02", responder_id: 304, responder: "Benjamin Tan", minutes: 42, target: true, late: false },
    { id: 4, site_id: 12, date: "2026-10-03", responder_id: null, responder: null, minutes: null, target: null, late: null },
    { id: 7, site_id: 11, date: "2026-10-04", responder_id: 304, responder: "Benjamin Tan", minutes: 90, target: false, late: true },
  ];
  for (const row of rows) {
    repository.upsertSlaRow({ id: row.id, site_id: row.site_id }, row.date, {
      responder_id: row.responder_id,
      responder: row.responder,
      response_business_minutes: row.minutes,
      within_target: row.target,
      completed_late: row.late,
    });
  }
}

async function withServer(fn) {
  const repository = createRepository(":memory:");
  seed(repository);
  const server = createApp({ repository, syncService: { isReady: () => true } }).listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    await fn(`http://127.0.0.1:${server.address().port}`, repository);
  } finally {
    server.close();
  }
}

test("GET /api/sla-report returns contract rows and responder summary", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/sla-report?from=2026-10-01&to=2026-10-31`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      from: "2026-10-01",
      to: "2026-10-31",
      requests: [
        { id: 2, site_id: 11, responder_id: 304, responder: "Benjamin Tan", response_business_minutes: 42, within_target: true, completed_late: false },
        { id: 4, site_id: 12, responder_id: null, responder: null, response_business_minutes: null, within_target: null, completed_late: null },
        { id: 7, site_id: 11, responder_id: 304, responder: "Benjamin Tan", response_business_minutes: 90, within_target: false, completed_late: true },
      ],
      responders: [{ id: 304, name: "Benjamin Tan", requests: 2, within_target: 1, completed_late: 1 }],
    });
  });
});

test("report rejects invalid date ranges", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/sla-report?from=2026-10-32&to=2026-10-01`);
    assert.equal(res.status, 400);
  });
});

test("GET /api/requests filters, sorts, and pages with a query-bound cursor", async () => {
  await withServer(async (baseUrl) => {
    const first = await fetch(`${baseUrl}/api/requests?from=2026-10-01&to=2026-10-31&site_id=11&sort=-response_business_minutes&limit=1`);
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.data[0].id, 7);
    assert.ok(firstBody.next_cursor);

    const second = await fetch(`${baseUrl}/api/requests?from=2026-10-01&to=2026-10-31&site_id=11&sort=-response_business_minutes&limit=1&cursor=${encodeURIComponent(firstBody.next_cursor)}`);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).data[0].id, 2);

    const mismatched = await fetch(`${baseUrl}/api/requests?from=2026-10-01&to=2026-10-31&site_id=12&sort=-response_business_minutes&limit=1&cursor=${encodeURIComponent(firstBody.next_cursor)}`);
    assert.equal(mismatched.status, 400);
  });
});

test("browse supports all boolean and responder filters with nulls last", async () => {
  await withServer(async (baseUrl) => {
    const base = `${baseUrl}/api/requests?from=2026-10-01&to=2026-10-31`;
    const late = await (await fetch(`${base}&late=true`)).json();
    assert.deepEqual(late.data.map((row) => row.id), [7]);

    const target = await (await fetch(`${base}&within_target=true`)).json();
    assert.deepEqual(target.data.map((row) => row.id), [2]);

    const responder = await (await fetch(`${base}&responder_id=304`)).json();
    assert.deepEqual(responder.data.map((row) => row.id), [2, 7]);

    const sorted = await (await fetch(`${base}&sort=-response_business_minutes`)).json();
    assert.deepEqual(sorted.data.map((row) => row.id), [7, 2, 4]);

    const invalid = await fetch(`${base}&cursor=not-issued-by-the-server`);
    assert.equal(invalid.status, 400);
  });
});

test("GET /api/requests.csv exports every sorted filtered row and ignores paging", async () => {
  await withServer(async (baseUrl, repository) => {
    repository.upsertSlaRow({ id: 8, site_id: 11 }, "2026-10-05", {
      responder_id: 305,
      responder: 'Lee, "Kai"',
      response_business_minutes: 10,
      within_target: true,
      completed_late: false,
    });

    const response = await fetch(`${baseUrl}/api/requests.csv?from=2026-10-01&to=2026-10-31&sort=id&limit=1&cursor=not-issued-by-the-server`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/csv/);
    assert.equal(await response.text(), [
      "id,site_id,responder_id,responder,response_business_minutes,within_target,completed_late",
      "2,11,304,Benjamin Tan,42,true,false",
      "4,12,,,,,",
      "7,11,304,Benjamin Tan,90,false,true",
      '8,11,305,"Lee, ""Kai""",10,true,false',
      "",
    ].join("\n"));
  });
});
