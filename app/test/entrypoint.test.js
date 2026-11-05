import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("container entrypoint uses Unix line endings for /bin/sh", async () => {
  const script = await readFile(new URL("../entrypoint.sh", import.meta.url), "utf8");
  assert.doesNotMatch(script, /\r/);
});
