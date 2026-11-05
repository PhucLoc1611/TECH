import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createQueryService, InputError, parseBrowseQuery, parseCsvBrowseQuery, parseReportRange } from "./query.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const csvColumns = ["id", "site_id", "responder_id", "responder", "response_business_minutes", "within_target", "completed_late"];

function csvField(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  return `${csvColumns.join(",")}\n${rows.map((row) => csvColumns.map((column) => csvField(row[column])).join(",")).join("\n")}\n`;
}

export function createApp({ syncService = null, repository = null } = {}) {
  const app = express();
  const queryService = repository ? createQueryService(repository) : null;

  app.use(express.static(path.join(here, "..", "public")));

  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  app.get("/ready", (req, res) => {
    const ready = syncService?.isReady() ?? false;
    res.status(ready ? 200 : 503).json({ ready });
  });

  app.get("/api/requests", (req, res) => {
    if (!queryService || !syncService?.isReady()) return res.status(503).json({ error: "not ready" });
    try {
      res.json(queryService.browse(parseBrowseQuery(req.query)));
    } catch (error) {
      if (error instanceof InputError) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: "unable to read report" });
    }
  });

  app.get("/api/requests.csv", (req, res) => {
    if (!queryService || !syncService?.isReady()) return res.status(503).json({ error: "not ready" });
    try {
      const rows = queryService.exportRows(parseCsvBrowseQuery(req.query));
      res.set("Content-Type", "text/csv");
      res.attachment("requests.csv").send(toCsv(rows));
    } catch (error) {
      if (error instanceof InputError) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: "unable to export requests" });
    }
  });

  app.get("/api/sla-report", (req, res) => {
    if (!queryService || !syncService?.isReady()) return res.status(503).json({ error: "not ready" });
    try {
      res.json(queryService.report(parseReportRange(req.query)));
    } catch (error) {
      if (error instanceof InputError) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: "unable to read report" });
    }
  });

  return app;
}
