import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";

test("GET /ready reflects whether the initial sync completed", async () => {
  const server = createApp({ syncService: { isReady: () => true } }).listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/ready`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ready: true });
  } finally {
    server.close();
  }
});
