const reportForm = document.querySelector("#report-form");
const browseForm = document.querySelector("#browse-form");
const status = document.querySelector("#status");
const readinessMessage = document.querySelector("#readiness-message");
const readinessControls = [...document.querySelectorAll("[data-requires-readiness]")];
const summaryBody = document.querySelector("#summary-body");
const reportBody = document.querySelector("#report-body");
const browseBody = document.querySelector("#browse-body");
const downloadCsv = document.querySelector("#download-csv");
const nextPage = document.querySelector("#next-page");

let nextCursor = null;
let applicationReady = false;
let readinessTimer = null;

function clear(element) { element.replaceChildren(); }

function text(value) {
  if (value === null || value === undefined) return "—";
  if (value === true) return "Yes";
  if (value === false) return "No";
  return String(value);
}

function renderEmpty(body, columns, message) {
  clear(body);
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = columns;
  cell.className = "empty";
  cell.textContent = message;
  row.append(cell);
  body.append(row);
}

function renderRows(body, rows) {
  if (rows.length === 0) return renderEmpty(body, 6, "No requests match this range.");
  clear(body);
  for (const request of rows) {
    const row = document.createElement("tr");
    const values = [request.id, request.site_id, request.responder, request.response_business_minutes === null ? null : `${request.response_business_minutes} min`, request.within_target, request.completed_late];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = text(value);
      row.append(cell);
    }
    body.append(row);
  }
}

function renderSummary(responders) {
  if (responders.length === 0) return renderEmpty(summaryBody, 4, "No responder activity in this range.");
  clear(summaryBody);
  for (const responder of responders) {
    const row = document.createElement("tr");
    for (const value of [responder.name, responder.requests, responder.within_target, responder.completed_late]) {
      const cell = document.createElement("td");
      cell.textContent = text(value);
      row.append(cell);
    }
    summaryBody.append(row);
  }
}

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

function setReadinessMessage(message, error = false) {
  readinessMessage.textContent = message;
  readinessMessage.classList.toggle("error", error);
}

function setControlsEnabled(enabled) {
  for (const control of readinessControls) {
    control.disabled = !enabled || control === nextPage;
  }
}

async function checkReadiness() {
  if (applicationReady) return;
  try {
    const response = await fetch("/ready");
    const payload = await response.json();
    if (response.ok && payload.ready) {
      applicationReady = true;
      setControlsEnabled(true);
      setReadinessMessage("Data is ready. Choose a date range and run the report.");
      clearInterval(readinessTimer);
      return;
    }
    setControlsEnabled(false);
    setReadinessMessage("Syncing Helpdesk data. Reports will be available automatically.");
  } catch {
    setControlsEnabled(false);
    setReadinessMessage("Waiting to reach the report service. Retrying automatically.", true);
  }
}

async function readJson(response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `Request failed with ${response.status}`);
  return payload;
}

function selectedRange() {
  const form = new FormData(reportForm);
  return { from: form.get("from"), to: form.get("to") };
}

async function loadBrowse(cursor = null) {
  const range = selectedRange();
  if (!range.from || !range.to) {
    setStatus("Choose a report range before browsing requests.", true);
    return;
  }
  const params = new URLSearchParams(range);
  for (const [key, value] of new FormData(browseForm)) if (value) params.set(key, value);
  if (cursor) params.set("cursor", cursor);
  const payload = await readJson(await fetch(`/api/requests?${params}`));
  renderRows(browseBody, payload.data);
  nextCursor = payload.next_cursor;
  nextPage.disabled = nextCursor === null;
}

reportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const params = new URLSearchParams(new FormData(reportForm));
  setStatus("Loading report…");
  try {
    const payload = await readJson(await fetch(`/api/sla-report?${params}`));
    renderRows(reportBody, payload.requests);
    renderSummary(payload.responders);
    renderEmpty(browseBody, 6, "Apply filters to browse these requests.");
    nextCursor = null;
    nextPage.disabled = true;
    setStatus(`${payload.requests.length} requests loaded for ${payload.from} to ${payload.to}.`);
  } catch (error) {
    setStatus(error.message, true);
  }
});

browseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Loading filtered requests…");
  try {
    await loadBrowse();
    setStatus("Filtered requests loaded.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

nextPage.addEventListener("click", async () => {
  try {
    await loadBrowse(nextCursor);
    setStatus("Next page loaded.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

downloadCsv.addEventListener("click", () => {
  const range = selectedRange();
  if (!range.from || !range.to) {
    setStatus("Choose a report range before downloading CSV.", true);
    return;
  }
  const params = new URLSearchParams(range);
  for (const [key, value] of new FormData(browseForm)) if (value) params.set(key, value);
  window.location.assign(`/api/requests.csv?${params}`);
});

checkReadiness();
readinessTimer = setInterval(checkReadiness, 2000);
