# Response-time report

An SLA report for Helpdesk requests. The app maintains a local SQLite projection of the change feed and calculates first-response and completion performance against each site's timezone, business hours, and holidays.

## Setup

1. Copy `.env.example` to `.env` and set `HELPDESK_URL` and `HELPDESK_TOKEN`.
2. Start the service: `docker compose up --build`.
3. Open `http://localhost:8080`.
4. Run tests: `docker compose run --rm app test`.

Docker Compose reads the root `.env` file automatically. For a direct local run, load that file into the current PowerShell process before starting Node:

```powershell
cd app
Get-Content ..\.env | Where-Object { $_ -and -not $_.StartsWith('#') } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  Set-Item -Path "Env:$name" -Value $value
}
npm ci
npm start
```

`GET /health` is available immediately. `GET /ready` returns `503` until the first full change-feed import finishes, then returns `200 {"ready":true}`. The browser checks this endpoint every two seconds, displays the import state, and enables report actions automatically once the service is ready. SQLite data is stored under `./data/`, so the local projection survives a container restart.

## Architecture

- `app/src/sync.js` imports sites, holidays, staff, requests, and events from `/v1/changes`, retries rate limits, and safely restarts expired cursors.
- `app/src/sla.js` implements the seven rules in `docs/rules.md`, including local business hours and Sydney daylight saving.
- `app/src/repository.js` stores source data plus derived, indexed report rows in SQLite.
- `app/src/query.js` provides strict report/browse validation and signed, query-bound cursors.

## Endpoints

- `GET /health`
- `GET /ready`
- `GET /api/sla-report?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/requests?from=YYYY-MM-DD&to=YYYY-MM-DD&site_id=&responder_id=&late=&within_target=&sort=&limit=&cursor=`

The source requirements and exact response shapes remain in `docs/`.
