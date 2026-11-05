import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const schema = `
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY,
    site_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    priority TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT,
    merged_into_id INTEGER,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS requests_site_created_idx
    ON requests (site_id, created_at);

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    request_id INTEGER NOT NULL,
    at INTEGER NOT NULL,
    status TEXT,
    actor_id INTEGER,
    reverts_id INTEGER,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_request_at_idx
    ON events (request_id, at, id);

  CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY,
    timezone TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS holidays (
    site_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    PRIMARY KEY (site_id, date)
  );
  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sla_rows (
    request_id INTEGER PRIMARY KEY,
    site_id INTEGER NOT NULL,
    created_local_date TEXT NOT NULL,
    responder_id INTEGER,
    responder TEXT,
    response_business_minutes INTEGER,
    within_target INTEGER,
    completed_late INTEGER
  );
  CREATE INDEX IF NOT EXISTS sla_rows_range_idx
    ON sla_rows (created_local_date, site_id, request_id);
  CREATE INDEX IF NOT EXISTS sla_rows_filter_idx
    ON sla_rows (site_id, responder_id, within_target, completed_late);
`;

export function createDatabase(filename) {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec(schema);
  return database;
}
