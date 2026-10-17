import type { ActionView, DebugEvent, Flag, TimelineNode } from "@shrike/schema";
import { callPath, endOf, errMsg, firstFailure, fmtMs, loc, reqName, targetName, topRequests, trunc, walk, withWord } from "./util.ts";

type View = Omit<ActionView, "summary" | "flags">;

const at = (e: DebugEvent): string => {
  const l = loc(e.source);
  return l ? ` at ${l}` : "";
};

const describe = (e: DebugEvent, n?: TimelineNode): string =>
  e.kind === "http_request"
    ? reqName(e)
    : e.kind === "db_query"
      ? `The query "${trunc(e.db?.statement ?? e.name, 60)}"`
      : e.kind === "external_call"
        ? `The call to ${n ? targetName(n) : e.place?.name ?? e.name} (${callPath(e)})`
        : e.kind === "cache_op"
          ? `The cache call ${e.name}`
          : e.name;

export function normalizeSql(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "?")
    .replace(/\$\d+|:\w+|@\w+/g, "?")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\(\s*\?(?:\s*,\s*\?)*\s*\)/g, "(?)")
    .replace(/\s+/g, " ")
    .replace(/;\s*$/, "")
    .trim()
    .toLowerCase();
}

const ANALYTICS_HOSTS = ["google-analytics.com", "googletagmanager.com", "segment.com", "segment.io"];

function isAnalyticsHost(host: string): boolean {
  return ANALYTICS_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

function blockedRequest(view: View): Flag | undefined {
  let found: DebugEvent | undefined;
  walk(view.tree, (n) => {
    if (found) return;
    const e = n.event;
    if (e.kind !== "http_request" || e.origin !== "browser" || e.status !== "error") return;
    const h = e.http;
    if (!h) return;
    // Only inspect requests that got no answer, or got a 401 (a cookie may have dropped).
    if (h.status !== undefined && h.status !== 401) return;
    try {
      const u = new URL(h.url, "https://shrike.local");
      if (isAnalyticsHost(u.hostname)) return;
    } catch {
      return;
    }
    found = e;
  });
  if (!found) return undefined;

  const h = found.http!;
  const isAbsolute = /^https?:\/\//.test(h.url);
  
  let host = h.url;
  if (isAbsolute) {
    try {
      host = new URL(h.url).host;
    } catch {
      // keep the raw url
    }
  }

    // SameSite: cross-origin + credentials + 401. Say "may": it's a guess.
  const hasCredentials = Boolean(h.reqHeaders?.["cookie"] || h.reqHeaders?.["authorization"]);
  if (isAbsolute && hasCredentials && h.status === 401) {
    return {
      kind: "blocked_request",
      eventId: found.id,
      message: `The browser may have dropped your login cookie on this cross-site request (SameSite).`,
      source: found.source,
    };
  }

  // Everything below is the "no status" case.
  if (h.status !== undefined) return undefined;

  // Mixed content: only when we know the page is https (a live-recorded page).
  // A page served from http calling an http URL is not mixed content.
  if (found.live && h.url.startsWith("http://")) {
    return {
      kind: "blocked_request",
      eventId: found.id,
      message: `The browser blocked an http request from an https page (mixed content).`,
      source: found.source,
    };
  }

  // CORS: an absolute (cross-origin) URL that never got a status.
    // Cross-origin with no status. CORS is likely, but the server could also be down.
  if (isAbsolute) {
    return {
      kind: "blocked_request",
      eventId: found.id,
      message: `The browser blocked this request, or ${host} didn't answer. If the server is up, it's CORS: it doesn't allow requests from this page.`,
      source: found.source,
    };
  }

  // A relative URL that failed with no status is a same-origin server problem, not CORS.
  return undefined;
}
export function findFlags(view: View): Flag[] {
  const flags: Flag[] = [];
  const parentOf = new Map<TimelineNode, TimelineNode | undefined>();
  walk(view.tree, (n, p) => parentOf.set(n, p));

  // slow: only the deepest slow step in a chain, so one slow query doesn't flag every layer above it.
  const slow = new Set<TimelineNode>();
  for (const [n, p] of parentOf) {
    const d = n.event.durationMs ?? 0;
    const pd = p ? (p.event.durationMs ?? 0) : view.durationMs;
    if (d > 100 && pd > 0 && d > 0.3 * pd) slow.add(n);
  }
  for (const n of slow) {
    let hasSlowChild = false;
    walk(n.children, (c) => {
      if (slow.has(c)) hasSlowChild = true;
    });
    if (hasSlowChild) continue;
    const p = parentOf.get(n);
    const pd = p ? (p.event.durationMs ?? 0) : view.durationMs;
    const d = n.event.durationMs ?? 0;
    flags.push({
      kind: "slow",
      eventId: n.event.id,
      message: `${describe(n.event, n)} took ${fmtMs(d)}, ${Math.round((d / pd) * 100)}% of ${p ? describe(p.event, p) : "the whole action"}${at(n.event)}.`,
      source: n.event.source,
    });
  }

  // n_plus_one: group queries by their nearest enclosing request.
  const groups = new Map<string, { req?: DebugEvent; shapes: Map<string, DebugEvent[]> }>();
  for (const [n] of parentOf) {
    if (n.event.kind !== "db_query" || !n.event.db) continue;
    let req: DebugEvent | undefined;
    for (let p = parentOf.get(n); p; p = parentOf.get(p)) {
      if (p.event.kind === "http_request") {
        req = p.event;
        break;
      }
    }
    const key = req?.id ?? "";
    const g = groups.get(key) ?? { req, shapes: new Map() };
    groups.set(key, g);
    const shape = normalizeSql(n.event.db.statement);
    const list = g.shapes.get(shape) ?? [];
    list.push(n.event);
    g.shapes.set(shape, list);
  }
  for (const g of groups.values()) {
    for (const [shape, list] of g.shapes) {
      const first = list[0];
      if (list.length < 5 || !first) continue;
      flags.push({
        kind: "n_plus_one",
        eventId: first.id,
        message: `The same database question was asked ${list.length} times${g.req ? ` during ${reqName(g.req)}` : ""}: ${trunc(shape, 80)}${at(first)}.`,
        source: first.source,
      });
    }
  }

  // sequential: ponytail: events don't say whether a function is async, so any slow back-to-back sibling
  // functions count; independence is a text check of the first result inside the second's args.
  const seq = (children: TimelineNode[]) => {
    const fns = children.map((c) => c.event).filter((e) => e.kind === "function" && (e.durationMs ?? 0) > 100);
    for (let i = 0; i + 1 < fns.length; i++) {
      const a = fns[i]!;
      const b = fns[i + 1]!;
      const total = endOf(b) - a.startMs;
      if (b.startMs < endOf(a) || total <= 200) continue;
      const r = a.returned?.trim();
      if (r && r.length >= 3 && r !== "undefined" && b.args?.some((x) => x.includes(r))) continue;
      const where = loc(b.callSite ?? b.source);
      flags.push({
        kind: "sequential",
        eventId: b.id,
        message: `${a.name} and ${b.name} ran one after the other (${fmtMs(a.durationMs ?? 0)} + ${fmtMs(b.durationMs ?? 0)}, ${fmtMs(total)} total) and look independent, so they could run at the same time${where ? ` at ${where}` : ""}.`,
        source: b.callSite ?? b.source,
      });
    }
  };
  seq(view.tree);
  for (const [n] of parentOf) seq(n.children);

  // duplicate_request
  const seen = new Map<string, DebugEvent[]>();
  for (const n of topRequests(view.tree)) {
    const h = n.event.http;
    if (!h) continue;
    const key = `${h.method} ${h.url} ${h.reqBody ?? ""}`;
    const list = seen.get(key) ?? [];
    list.push(n.event);
    seen.set(key, list);
  }
  for (const list of seen.values()) {
    const second = list[1];
    if (!second) continue;
    flags.push({
      kind: "duplicate_request",
      eventId: second.id,
      message: `${reqName(second)} was sent ${list.length} times with the same body in this action${at(second)}.`,
      source: second.source,
    });
  }

    const blocked = blockedRequest(view);
  if (blocked) flags.push(blocked);

  // cache_never_hit: every lookup in the trip missed.
  const nodes = [...parentOf.keys()];
  const reads = nodes.map((n) => n.event).filter((e) => e.kind === "cache_op" && e.cache?.hit !== undefined);
  const firstRead = reads[0];
  if (firstRead && reads.length >= 3 && reads.every((e) => e.cache?.hit === false)) {
    const toDb = nodes.some((n) => n.event.kind === "db_query");
    flags.push({
      kind: "cache_never_hit",
      eventId: firstRead.id,
      message: `The cache never hit: all ${reads.length} lookups missed${toDb ? ", so every request went to the database" : ""}${at(firstRead)}.`,
      source: firstRead.source,
    });
  }

  // slow_outside: one call to another service or host took most of the trip.
  for (const n of nodes) {
    const d = n.event.durationMs ?? 0;
    if (n.event.kind !== "external_call" || d <= 100 || d <= 0.5 * view.durationMs) continue;
    flags.push({
      kind: "slow_outside",
      eventId: n.event.id,
      message: `${targetName(n)} took ${fmtMs(d)} of the ${fmtMs(view.durationMs)}${at(n.event)}.`,
      source: n.event.source,
    });
  }

  // empty_result: Supabase answered OK with no rows, or a write that changed nothing. Row level security does this silently.
  const RLS = "Row level security can do this when no policy matches the signed-in user.";
  for (const n of nodes) {
    const e = n.event;
    const h = e.http;
    const table = h && /\/rest\/v1\/([^/?]+)/.exec(h.url)?.[1];
    if (e.kind !== "db_query" || !e.place?.id.startsWith("data:supabase:") || e.status === "error" || !h || !table || (h.status ?? 0) < 200 || (h.status ?? 0) >= 300) continue;
    const t = decodeURIComponent(table);
    let message: string | undefined;
    if (h.method === "GET" || h.method === "HEAD") {
      const total = /\/(\d+)$/.exec(h.resHeaders?.["content-range"] ?? "")?.[1];
      if (h.method === "HEAD" ? total === "0" : h.resBody?.trim() === "[]") message = `Supabase answered with 0 rows from ${t}. ${RLS}`;
    } else if (e.change && e.change.op !== "insert") {
      if (e.change.count === 0) message = `Supabase ${e.change.op === "delete" ? "deleted 0 rows from" : "updated 0 rows in"} ${t}. ${RLS}`;
      else if (e.change.count === undefined) message = `Supabase didn't say how many rows changed in ${t}. If Save did nothing, row level security may have matched 0 rows.`;
    }
    if (message) flags.push({ kind: "empty_result", eventId: e.id, message, source: e.source });
  }

  // swallowed_error
  for (const [n] of parentOf) {
    const s = n.event.http?.status;
    if (n.event.kind !== "http_request" || n.event.origin !== "server" || s === undefined || s >= 400) continue;
    const fn = firstFailure(n.children);
    const f = fn?.event;
    if (!f) continue;
    const msg = errMsg(f);
    flags.push({
      kind: "swallowed_error",
      eventId: f.id,
      message: `${describe(f, fn)} failed${msg ? ` (${trunc(msg, 100)})` : ""} but the server still replied ${withWord(s)}${at(f)}.`,
      source: f.source,
    });
  }
  return flags;
}
