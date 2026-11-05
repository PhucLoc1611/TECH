import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("report page provides labeled report and browse controls without unsafe HTML insertion", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(html, /<label for="from">From<\/label>/);
  assert.match(html, /id="summary-body"/);
  assert.match(html, /id="browse-form"/);
  assert.match(html, /id="readiness-message"/);
  assert.match(html, /data-requires-readiness/);
  assert.match(html, /id="download-csv"/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(script, /textContent/);
  assert.match(script, /async function checkReadiness\(\)/);
  assert.match(script, /await fetch\("\/ready"\)/);
  assert.match(script, /setControlsEnabled\(true\)/);
  assert.match(script, /setInterval\(checkReadiness, 2000\)/);
  assert.match(script, /\/api\/requests\.csv/);
});
