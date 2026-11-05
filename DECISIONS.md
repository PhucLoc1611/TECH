# DECISIONS

Write in English. Short bullet points are fine. Reviewers read this file alongside your code.

## Planning approach

- I read `docs/rules.md`, `docs/contract.md`, and `docs/api.md` before implementation, then split the work into independent increments: application scaffold, SQLite projection, SLA calculation, live synchronization, report/browse/CSV APIs, UI, and deployment documentation.
- Each increment has focused automated tests. This kept the business-time rules separate from API paging/filtering and from the browser presentation.
- I prioritized the levels in the order requested: correct report rows first, local indexed reads for performance, change-feed polling for freshness, then browse and CSV export.

## What I assumed

- The report returns rows in stable ID order where the contract leaves order unspecified.
- When two events have the same `at` value, I use the event ID as a deterministic tie-breaker for “first” and “last”.
- A response at or before `created_at` has zero business minutes, as required by rule 4.
- A `null` priority uses the Low target (480 business minutes), following rule 5.
- SQLite is stored in the Compose-mounted `/data` directory so restarting the app does not require another full initial import.
- The report page uses the existing `/ready` endpoint every two seconds during the initial import. This keeps readiness presentation in the browser while all Helpdesk credentials and synchronization remain server-side.

## What I found in the API or data

- Automated tests use a deterministic fake Helpdesk client; live API calls are reserved for integration verification.
- The change feed may replay items. Request and event IDs are SQLite primary keys, so applying a replay is idempotent.
- A change cursor can expire. The sync clears the cursor and safely rebuilds from the feed instead of staying unavailable.
- During live verification, `/v1/changes` returned a temporary `503`. The worker retries `429` responses using `Retry-After` when present and retries temporary `5xx` responses with capped exponential-backoff delays.
- The practice data reached 12,001 requests and 45,906 events. After the initial load, the local projection contained 11,162 eligible report rows.

## How I used AI

- I used Codex to read the supplied contract/rules/API documentation, discuss the architecture, draft implementation code, and create test cases.
- I reviewed generated code against the supplied rules, adjusted it after live API observations, and verified the resulting implementation with unit/integration tests.
- I chose SQLite because this workload needs indexed range/filter/sort queries and persistent request/event history.

## Trade-offs and what I would do next

- SQLite is appropriate for the assessment’s single-container deployment. For a horizontally scaled production deployment, I would move to a shared relational database and run only one elected sync worker.
- The page intentionally uses dense, accessible tables instead of charts because the assessment prioritizes correct report rows and browsing behaviour.
- I would add structured sync metrics, an alert on repeated upstream failures, and browser E2E tests before production.
- Local verification returned a six-month report with 11,044 rows in 85.1 ms and October with 1,910 rows in 66.6 ms. These measurements are local app response times after readiness, not guarantees for every deployment.
- Docker Desktop was unavailable on the development machine, so `docker compose up --build` and `docker compose run --rm app test` still need to be run once before submission.
