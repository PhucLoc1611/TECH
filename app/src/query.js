import crypto from "node:crypto";
import { DateTime } from "luxon";

const allowedSorts = new Set(["id", "-id", "response_business_minutes", "-response_business_minutes"]);

export class InputError extends Error {}

function single(value) {
  return typeof value === "string" ? value : null;
}

function date(value, name) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError(`${name} must be YYYY-MM-DD`);
  const parsed = DateTime.fromISO(value, { zone: "utc" });
  if (!parsed.isValid || parsed.toISODate() !== value) throw new InputError(`${name} must be YYYY-MM-DD`);
  return value;
}

function optionalInteger(value, name) {
  if (value === null || value === undefined) return null;
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new InputError(`${name} must be a positive integer`);
  return Number(value);
}

function optionalBoolean(value, name) {
  if (value === null || value === undefined) return null;
  if (value !== "true" && value !== "false") throw new InputError(`${name} must be true or false`);
  return value === "true";
}

export function parseReportRange(query) {
  const from = date(single(query.from), "from");
  const to = date(single(query.to), "to");
  if (from > to) throw new InputError("from must not be after to");
  return { from, to };
}

export function parseBrowseQuery(query) {
  const range = parseReportRange(query);
  const sort = single(query.sort) ?? "id";
  if (!allowedSorts.has(sort)) throw new InputError("invalid sort");
  const rawLimit = single(query.limit);
  const limit = rawLimit === null ? 50 : optionalInteger(rawLimit, "limit");
  if (limit > 200) throw new InputError("limit must be between 1 and 200");
  return {
    ...range,
    siteId: optionalInteger(single(query.site_id), "site_id"),
    responderId: optionalInteger(single(query.responder_id), "responder_id"),
    late: optionalBoolean(single(query.late), "late"),
    withinTarget: optionalBoolean(single(query.within_target), "within_target"),
    sort,
    limit,
    cursor: single(query.cursor),
  };
}

export function parseCsvBrowseQuery(query) {
  const { limit, cursor, ...filters } = query;
  return parseBrowseQuery(filters);
}

function compareRows(left, right, sort) {
  if (sort === "id" || sort === "-id") {
    return (sort === "id" ? 1 : -1) * (left.id - right.id);
  }
  const descending = sort.startsWith("-");
  const leftValue = left.response_business_minutes;
  const rightValue = right.response_business_minutes;
  if (leftValue === null && rightValue !== null) return 1;
  if (leftValue !== null && rightValue === null) return -1;
  if (leftValue !== null && leftValue !== rightValue) return (descending ? -1 : 1) * (leftValue - rightValue);
  return left.id - right.id;
}

function publicRow(row) {
  return {
    id: row.id,
    site_id: row.site_id,
    responder_id: row.responder_id,
    responder: row.responder,
    response_business_minutes: row.response_business_minutes,
    within_target: row.within_target,
    completed_late: row.completed_late,
  };
}

function signatureFor(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function createQueryService(repository, secret = crypto.randomBytes(32)) {
  function filterSignature(options) {
    const { cursor, ...filters } = options;
    return JSON.stringify(filters);
  }

  function decodeCursor(cursor, querySignature) {
    const [encoded, signature] = cursor.split(".");
    if (!encoded || !signature || signature !== signatureFor(encoded, secret)) throw new InputError("invalid cursor");
    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      if (payload.query !== querySignature || !Number.isInteger(payload.last.id)) throw new InputError("invalid cursor");
      return payload.last;
    } catch (error) {
      if (error instanceof InputError) throw error;
      throw new InputError("invalid cursor");
    }
  }

  function encodeCursor(last, querySignature) {
    const encoded = Buffer.from(JSON.stringify({
      query: querySignature,
      last: { id: last.id, response_business_minutes: last.response_business_minutes },
    })).toString("base64url");
    return `${encoded}.${signatureFor(encoded, secret)}`;
  }

  return {
    report({ from, to }) {
      const requests = repository.findSlaRows({ from, to });
      const summaries = new Map();
      for (const row of requests) {
        if (row.responder_id === null) continue;
        const summary = summaries.get(row.responder_id) ?? {
          id: row.responder_id, name: row.responder, requests: 0, within_target: 0, completed_late: 0,
        };
        summary.requests += 1;
        summary.within_target += Number(row.within_target === true);
        summary.completed_late += Number(row.completed_late === true);
        summaries.set(row.responder_id, summary);
      }
      return { from, to, requests: requests.map(publicRow), responders: [...summaries.values()] };
    },

    browse(options) {
      const querySignature = filterSignature(options);
      const last = options.cursor ? decodeCursor(options.cursor, querySignature) : null;
      let rows = repository.findSlaRows(options).sort((left, right) => compareRows(left, right, options.sort));
      if (last) rows = rows.filter((row) => compareRows(row, last, options.sort) > 0);
      const page = rows.slice(0, options.limit);
      const hasMore = rows.length > page.length;
      return {
        data: page.map(publicRow),
        next_cursor: hasMore ? encodeCursor(page.at(-1), querySignature) : null,
      };
    },

    exportRows(options) {
      return repository.findSlaRows(options)
        .sort((left, right) => compareRows(left, right, options.sort))
        .map(publicRow);
    },
  };
}
