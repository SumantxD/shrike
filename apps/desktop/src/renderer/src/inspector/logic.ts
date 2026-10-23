// Place inspector (docs/13 I): pure helpers for the dock views. Tested in logic.test.ts.
import type { ActionView, Cell, DebugEvent, ProcessSpec, Route, TimelineNode } from "@shrike/schema";
import { allEvents, stripAnsi } from "../lib/format.ts";

/** "[ 30, 'cart-1', null ]" (a node-agent params preview) -> [30, "cart-1", null]. */
export function parseParams(preview: string | undefined): Cell[] {
  const s = preview?.trim();
  if (!s?.startsWith("[") || !s.endsWith("]")) return [];
  const body = s.slice(1, -1);
  const out: Cell[] = [];
  for (let i = 0; i < body.length; ) {
    const ch = body[i]!;
    if (ch === " " || ch === ",") {
      i++;
    } else if (ch === "'" || ch === '"') {
      let v = "";
      for (i++; i < body.length && body[i] !== ch; i++) v += body[i] === "\\" ? body[++i] : body[i];
      out.push(v);
      i++;
    } else {
      const end = body.indexOf(",", i) < 0 ? body.length : body.indexOf(",", i);
      const t = body.slice(i, end).trim();
      out.push(t === "null" || t === "undefined" ? null : t === "true" ? true : t === "false" ? false : /^-?\d+(\.\d+)?n?$/.test(t) ? Number(t.replace(/n$/, "")) : t);
      i = end;
    }
  }
  return out;
}

const IDENT = String.raw`(?:["\x60]?[\w$]+["\x60]?\.)?["\x60]?([\w$]+)["\x60]?`;

/** The table a statement reads or writes first; for MongoDB (db.users.find()) the collection. */
export function tableOf(statement: string): string | undefined {
  return /^db\.([^.\s]+)\.\w+\(/.exec(statement)?.[1] ?? new RegExp(String.raw`\b(?:FROM|INTO|UPDATE|JOIN)\s+${IDENT}`, "i").exec(statement)?.[1];
}

/** `WHERE a = ? AND b = $2` with its params -> the values those rows must have. */
export function keyFilters(statement: string, params: Cell[]): { col: string; value: Cell }[] {
  const where = /\bWHERE\b([\s\S]*?)(?:\bORDER\b|\bGROUP\b|\bLIMIT\b|\bRETURNING\b|$)/i.exec(statement);
  if (!where) return [];
  const before = statement.slice(0, where.index);
  let q = (before.match(/\?/g) ?? []).length;
  const out: { col: string; value: Cell }[] = [];
  for (const m of where[1]!.matchAll(/"?([\w$]+)"?\s*=\s*(\?|\$(\d+))/g)) {
    const i = m[3] ? Number(m[3]) - 1 : q++;
    if (i < params.length) out.push({ col: m[1]!, value: params[i]! });
  }
  return out;
}

const same = (a: Cell, b: Cell) => a === b || (a !== null && b !== null && String(a) === String(b));

export function rowMatches(columns: string[], row: Cell[], filters: { col: string; value: Cell }[]): boolean {
  if (!filters.length) return false;
  return filters.every((f) => {
    const i = columns.indexOf(f.col);
    return i >= 0 && same(row[i]!, f.value);
  });
}

/** The table and rows a trip touched in this database: the focused station when it is here, else the trip's first query here. */
export function dataFocus(view: ActionView | undefined, placeId: string, stationIds: string[] = []): { table?: string; filters: { col: string; value: Cell }[]; eventId?: string } {
  if (!view) return { filters: [] };
  const here = allEvents(view).filter((e) => e.kind === "db_query" && e.place?.id === placeId && e.db);
  const e = here.find((x) => stationIds.includes(x.id)) ?? here[0];
  if (!e?.db) return { filters: [] };
  return { table: tableOf(e.db.statement), filters: keyFilters(e.db.statement, parseParams(e.db.params)), eventId: e.id };
}

export interface ChangeRow {
  kind: "added" | "changed" | "removed";
  pk?: string;
  before?: Record<string, Cell>;
  after?: Record<string, Cell>;
}
export interface ChangeGroup {
  table: string;
  added: number;
  changed: number;
  removed: number;
  rows: ChangeRow[];
}

/** I3: what a trip's writes changed in this database, per table. */
export function dataChanges(view: ActionView | undefined, placeId: string): ChangeGroup[] {
  const groups = new Map<string, ChangeGroup>();
  for (const e of view ? allEvents(view) : []) {
    const c = e.kind === "db_query" && e.status !== "error" && e.place?.id === placeId ? e.change : undefined;
    if (!c?.count) continue;
    let g = groups.get(c.table);
    if (!g) groups.set(c.table, (g = { table: c.table, added: 0, changed: 0, removed: 0, rows: [] }));
    const kind = c.op === "insert" ? "added" : c.op === "update" ? "changed" : "removed";
    g[kind] += c.count;
    for (const r of c.rows ?? []) g.rows.push({ kind, ...r });
  }
  return [...groups.values()];
}

const WRITE = /^\s*(insert|update|delete|replace|merge|upsert)\b/i;
const serviceHost = (e: DebugEvent | undefined) => (e?.place?.kind === "service" ? (e.place.detail ?? e.place.name) : undefined);

/** A local server this trip called that Shrike can't see row changes in (unrecorded, or only through OpenTelemetry): it may have written here unseen. Its host, else undefined. */
export function unseenWriter(view: ActionView | undefined, placeId: string): string | undefined {
  if (!view) return undefined;
  const events = allEvents(view);
  const queries = events.filter((e) => e.kind === "db_query" && !e.otel && e.place?.id === placeId);
  // A write seen without its rows (a count the driver couldn't give, like sqlite3 with RETURNING): the server that sent it.
  const blind = queries.find((e) => !e.change && e.status !== "error" && WRITE.test(e.db?.statement ?? e.name));
  if (blind) {
    const by = (nodes: TimelineNode[], svc?: DebugEvent): DebugEvent | undefined => {
      for (const n of nodes) {
        const s = n.event.place?.kind === "service" ? n.event : svc;
        if (n.event.id === blind.id) return s;
        const hit = by(n.children, s);
        if (hit) return hit;
      }
      return undefined;
    };
    return serviceHost(by(view.tree ?? [])) ?? "your server";
  }
  if (queries.length) return undefined;
  // python-agent records sqlite3, psycopg, psycopg2, asyncpg, PyMySQL and mysqlclient queries, but through another driver
  // (pg8000, aiomysql, pymongo) a Python server that sent nothing here may still have written here.
  const py = placeId.startsWith("data:sqlite") ? undefined : events.find((e) => e.origin === "server" && !e.otel && /\.py$/.test((e.source ?? e.callSite)?.file ?? ""));
  if (py) return serviceHost(py) ?? "your Python server";
  const find = (nodes: TimelineNode[]): string | undefined => {
    for (const n of nodes) {
      const e = n.event;
      const call = (e.kind === "http_request" && e.origin === "browser") || (e.kind === "external_call" && e.place?.kind !== "outside");
      if (call && !n.children.some((c) => c.event.origin === "server" && !c.event.otel)) {
        const url = /^https?:\/\//i.test(e.http?.url ?? "") ? new URL(e.http!.url) : undefined;
        if (!url) return "your server";
        if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(url.hostname)) return url.host.replace(/^(127\.0\.0\.1|\[::1\]|0\.0\.0\.0)/, "localhost");
      }
      const below = find(n.children);
      if (below) return below;
    }
    return undefined;
  };
  return find(view.tree ?? []);
}

export function changeSummary(g: Pick<ChangeGroup, "added" | "changed" | "removed">): string {
  return [g.added && `${g.added} added`, g.changed && `${g.changed} changed`, g.removed && `${g.removed} removed`].filter(Boolean).join(", ");
}

/** Columns whose value differs between before and after. */
export function changedFields(before: Record<string, Cell> | undefined, after: Record<string, Cell> | undefined): string[] {
  if (!before || !after) return [];
  return Object.keys(after).filter((k) => !same(before[k] ?? null, after[k] ?? null) || (k in before) !== (k in after));
}

/** A row's key, matching ChangeRow.pk: primary key columns joined, else `id`. */
export function rowKey(columns: string[], pk: string[], row: Cell[]): string | undefined {
  const cols = pk.length ? pk : columns.includes("id") ? ["id"] : [];
  return cols.length ? cols.map((c) => String(row[columns.indexOf(c)])).join(", ") : undefined;
}

export type CacheMark = "hit" | "miss" | "set" | "delete";

/** This trip's cache operations in this cache, by key: a later write wins over a read. */
export function cacheMarks(view: ActionView | undefined, placeId: string): Map<string, CacheMark> {
  const m = new Map<string, CacheMark>();
  const evs = view ? allEvents(view).filter((e) => e.kind === "cache_op" && e.place?.id === placeId && e.cache?.key !== undefined) : [];
  for (const e of evs.sort((a, b) => a.startMs - b.startMs)) {
    const { op, key, hit, path } = e.cache!;
    const mark: CacheMark | undefined = hit === true ? "hit" : hit === false ? "miss" : /^(set|setex|psetex|setnx|mset|hset|incr|incrby|decr|decrby|lpush|rpush|sadd|zadd|expire|json\.set|json\.mset|json\.merge|json\.arrappend|json\.arrinsert|json\.numincrby|json\.strappend|json\.toggle|json\.clear|json\.arrpop|json\.arrtrim)$/.test(op) ? "set" : /^(del|delete|unlink|hdel|srem)$/.test(op) ? "delete" : /^(json\.del|json\.forget)$/.test(op) ? (!path || path === "$" || path === "." ? "delete" : "set") : undefined;
    if (mark && !(m.get(key!) === "set" && mark !== "delete")) m.set(key!, mark);
  }
  return m;
}

/** Every call this session made to an outside host, newest first. */
export function outsideCalls(actions: ActionView[], placeId: string): { actionId: string; event: DebugEvent }[] {
  const out: { actionId: string; event: DebugEvent }[] = [];
  for (const a of actions) for (const e of allEvents(a)) if (e.kind === "external_call" && e.place?.id === placeId) out.push({ actionId: a.id, event: e });
  return out.sort((x, y) => y.event.startMs - x.event.startMs);
}

/** The process behind a service lane: "service:api" -> "api"; a single-process project runs every service. */
export function processFor(placeId: string, processes: Pick<ProcessSpec, "name">[]): string | undefined {
  const name = placeId.replace(/^service:/, "");
  return processes.find((p) => p.name.toLowerCase() === name)?.name ?? (processes.length === 1 ? processes[0]!.name : undefined);
}

// ponytail: a route belongs to a process when its handler file sits in a folder named like it; one process gets them all.
export function routesFor(routes: Route[], processName: string | undefined, processCount: number): Route[] {
  if (processCount <= 1 || !processName) return routes;
  return routes.filter((r) => !!r.handler && `/${r.handler.file}`.includes(`/${processName}/`));
}

/** Output lines, the last `max`, marking those that carry this trip's log or error messages. */
export function outputLines(output: string, messages: string[], max = 400): { text: string; hit: boolean }[] {
  const lines = stripAnsi(output).replace(/\r/g, "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const needles = messages.map((m) => m.split("\n")[0]!.trim()).filter((m) => m.length >= 4);
  return lines.slice(-max).map((text) => ({ text, hit: needles.some((n) => text.includes(n)) }));
}

export function formatTtl(ms: number | null): string {
  if (ms === null) return "no expiry";
  if (ms < 1000) return "expiring";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
}

/** "POSTGRES · orders" -> head and sub; "Stripe (test double)" -> STRIPE / test double. */
export function titleParts(name: string): { head: string; sub?: string } {
  const paren = /^(.+?)\s*\((.+)\)$/.exec(name);
  const [head, sub] = paren ? [paren[1]!, paren[2]] : name.split(" · ");
  return { head: head!.toUpperCase(), ...(sub ? { sub } : {}) };
}

/** One database row as JSON, from the redacted cells the grid already shows (#93). */
export function rowAsJson(columns: string[], row: Cell[]): string {
  return JSON.stringify(Object.fromEntries(columns.map((c, i) => [c, row[i] ?? null])));
}

const sqlIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
const sqlValue = (v: Cell): string => {
  if (v === null) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
};

/** One database row as an SQL INSERT: strings single-quoted with ' doubled, numbers bare, null as NULL, booleans as TRUE/FALSE, identifiers double-quoted (#93). */
export function rowAsInsert(table: string, columns: string[], row: Cell[]): string {
  return `INSERT INTO ${sqlIdent(table)} (${columns.map(sqlIdent).join(", ")}) VALUES (${row.map(sqlValue).join(", ")});`;
}
