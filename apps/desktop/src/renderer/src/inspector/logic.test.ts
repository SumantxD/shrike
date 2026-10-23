import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionView, DebugEvent } from "@shrike/schema";
import { cacheMarks, changedFields, changeSummary, dataChanges, dataFocus, formatTtl, keyFilters, outputLines, outsideCalls, parseParams, processFor, rowAsInsert, rowAsJson, rowKey, rowMatches, routesFor, tableOf, titleParts, unseenWriter } from "./logic.ts";

let n = 0;
const ev = (p: Partial<DebugEvent>): DebugEvent => ({ id: (++n).toString(16).padStart(16, "0"), traceId: "a".repeat(32), origin: "server", kind: "function", name: "f()", startMs: n, status: "ok", ...p });
const view = (events: DebugEvent[], id = "r"): ActionView => {
  const root = ev({ id, kind: "user_action", name: "Clicked" });
  return { id, traceId: root.traceId, trigger: "click", label: "Clicked", startMs: root.startMs, durationMs: 1, status: "ok", complete: true, root, tree: events.map((event) => ({ event, children: [] })), summary: { headline: "", steps: [], stats: { files: 0, functions: 0, requests: 0, queries: 0, logs: 0, errors: 0, totalMs: 0 } }, flags: [] };
};
const PG = { kind: "data" as const, id: "data:postgres:orders", name: "POSTGRES · orders" };

test("params previews parse back into values", () => {
  assert.deepEqual(parseParams("[ 30 ]"), [30]);
  assert.deepEqual(parseParams("[ 'cart-1', 1, null, true, 'it\\'s, ok' ]"), ["cart-1", 1, null, true, "it's, ok"]);
  assert.deepEqual(parseParams(undefined), []);
  assert.deepEqual(parseParams("{ a: 1 }"), []);
});

test("row highlight: the station's table and the rows its WHERE picked", () => {
  assert.equal(tableOf("SELECT id FROM carts WHERE id = $1 AND user_id = $2"), "carts");
  assert.equal(tableOf("INSERT INTO todos (title, user_id) VALUES (?, ?) RETURNING *"), "todos");
  assert.equal(tableOf('INSERT INTO "public"."Post" ("name") VALUES ($1)'), "Post", "Prisma's quoted schema");
  assert.equal(tableOf("SELECT `main`.`notes`.`id` FROM `main`.`notes` WHERE 1=1"), "notes", "backticks");
  assert.equal(tableOf("db.users.find()"), "users", "MongoDB");
  assert.equal(tableOf('UPDATE "orders" SET status = $1 WHERE id = $2'), "orders");
  assert.deepEqual(keyFilters("SELECT id FROM carts WHERE id = $1 AND user_id = $2", ["cart-1", 1]), [{ col: "id", value: "cart-1" }, { col: "user_id", value: 1 }]);
  assert.deepEqual(keyFilters("UPDATE todos SET done = ? WHERE id = ? RETURNING *", [1, 2]), [{ col: "id", value: 2 }]);
  assert.deepEqual(keyFilters("SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 5", [1]), [{ col: "user_id", value: 1 }]);
  const cols = ["id", "user_id"];
  assert.ok(rowMatches(cols, ["cart-1", 1], [{ col: "id", value: "cart-1" }, { col: "user_id", value: 1 }]));
  assert.ok(rowMatches(cols, ["cart-1", "1"], [{ col: "user_id", value: 1 }]), "numbers and strings compare as text");
  assert.ok(!rowMatches(cols, ["cart-2", 1], [{ col: "id", value: "cart-1" }]));
  assert.ok(!rowMatches(cols, ["cart-1", 1], []), "no filter highlights nothing");

  const a = ev({ kind: "db_query", place: PG, db: { system: "postgres", statement: "SELECT id FROM carts WHERE id = $1 AND user_id = $2", params: "[ 'cart-1', 1 ]" } });
  const b = ev({ kind: "db_query", place: PG, db: { system: "postgres", statement: "SELECT name FROM cart_items WHERE cart_id = $1", params: "[ 'cart-1' ]" } });
  const v = view([a, b]);
  assert.deepEqual(dataFocus(v, PG.id), { table: "carts", filters: [{ col: "id", value: "cart-1" }, { col: "user_id", value: 1 }], eventId: a.id });
  assert.equal(dataFocus(v, PG.id, [b.id]).table, "cart_items", "the focused station wins");
  assert.deepEqual(dataFocus(v, "data:sqlite:other.db"), { filters: [] });
  assert.deepEqual(dataFocus(undefined, PG.id), { filters: [] });
});

test("what this click changed: grouped per table, refused writes left out, wording", () => {
  const v = view([
    ev({ kind: "db_query", place: PG, db: { system: "postgres", statement: "INSERT" }, change: { table: "orders", op: "insert", count: 1, rows: [{ pk: "3", after: { id: 3, total: 4900 } }] } }),
    ev({ kind: "db_query", place: PG, db: { system: "postgres", statement: "UPDATE" }, change: { table: "orders", op: "update", count: 2, rows: [{ pk: "1", before: { id: 1, status: "new" }, after: { id: 1, status: "paid" } }] } }),
    ev({ kind: "db_query", place: PG, db: { system: "postgres", statement: "DELETE" }, change: { table: "carts", op: "delete", count: 1, rows: [{ pk: "cart-1", before: { id: "cart-1" } }] } }),
    ev({ kind: "db_query", place: PG, status: "error", db: { system: "postgres", statement: "INSERT" }, change: { table: "orders", op: "insert", count: 1 } }),
    ev({ kind: "db_query", place: { ...PG, id: "data:sqlite:x.db" }, change: { table: "events", op: "insert", count: 1 } }),
  ]);
  const g = dataChanges(v, PG.id);
  assert.deepEqual(g.map((x) => [x.table, x.added, x.changed, x.removed, x.rows.map((r) => `${r.kind} ${r.pk}`)]), [
    ["orders", 1, 2, 0, ["added 3", "changed 1"]],
    ["carts", 0, 0, 1, ["removed cart-1"]],
  ]);
  assert.equal(changeSummary(g[0]!), "1 added, 2 changed");
  assert.equal(changeSummary(g[1]!), "1 removed");
  assert.deepEqual(changedFields({ id: 1, status: "new" }, { id: 1, status: "paid" }), ["status"]);
  assert.deepEqual(dataChanges(view([ev({ kind: "db_query", place: PG, status: "error", db: { system: "sqlite", statement: "INSERT INTO todos" } })]), PG.id), [], "the planted bug: nothing changed");
  assert.equal(rowKey(["id", "title"], ["id"], [4, "x"]), "4");
  assert.equal(rowKey(["a", "b"], ["a", "b"], [1, 2]), "1, 2");
  assert.equal(rowKey(["title"], [], ["x"]), undefined);
});

test("cache marks, outside calls, processes, output lines, labels", () => {
  const LRU = { kind: "cache" as const, id: "cache:lru:orders", name: "LRU · orders" };
  const v = view([
    ev({ kind: "cache_op", place: LRU, cache: { op: "get", key: "user:1", hit: false } }),
    ev({ kind: "cache_op", place: LRU, cache: { op: "set", key: "user:1" } }),
    ev({ kind: "cache_op", place: LRU, cache: { op: "get", key: "user:1", hit: true } }),
    ev({ kind: "cache_op", place: LRU, cache: { op: "get", key: "user:2", hit: true } }),
    ev({ kind: "cache_op", place: { ...LRU, id: "cache:lru:sessions" }, cache: { op: "get", key: "x", hit: false } }),
    ev({ kind: "cache_op", place: LRU, cache: { op: "json.set", key: "cart:1" } }),
    ev({ kind: "cache_op", place: LRU, cache: { op: "json.del", key: "cart:2" } }),
    ev({ kind: "cache_op", place: LRU, cache: { op: "json.del", key: "cart:3", path: "$.items[0]" } }),
    ev({ kind: "cache_op", place: LRU, cache: { op: "json.del", key: "cart:4", path: "$" } }),
  ]);
  assert.deepEqual([...cacheMarks(v, LRU.id)], [["user:1", "set"], ["user:2", "hit"], ["cart:1", "set"], ["cart:2", "delete"], ["cart:3", "set"], ["cart:4", "delete"]]);

  const STRIPE = { kind: "outside" as const, id: "outside:localhost:4199", name: "Stripe (test double)" };
  const c1 = ev({ kind: "external_call", place: STRIPE, startMs: 10, http: { method: "POST", url: "x", status: 400 } });
  const c2 = ev({ kind: "external_call", place: STRIPE, startMs: 20, http: { method: "POST", url: "x", status: 200 } });
  assert.deepEqual(outsideCalls([view([c1], "a"), view([c2, ev({ kind: "external_call", place: { ...STRIPE, id: "outside:other" } })], "b")], STRIPE.id).map((c) => [c.actionId, c.event.id]), [["b", c2.id], ["a", c1.id]]);

  assert.equal(processFor("service:api", [{ name: "web" }, { name: "api" }]), "api");
  assert.equal(processFor("service:app", [{ name: "app" }]), "app");
  assert.equal(processFor("service:server", [{ name: "app" }]), "app", "the fallback SERVER lane of a one-process project");
  assert.equal(processFor("service:worker", [{ name: "web" }, { name: "api" }]), undefined);
  const routes = [{ method: "GET", path: "/api/cart", handler: { file: "services/api/index.ts", line: 3, precision: "exact" as const } }, { method: "POST", path: "/verify", handler: { file: "services/auth/index.ts", line: 9, precision: "exact" as const } }];
  assert.deepEqual(routesFor(routes, "api", 4).map((r) => r.path), ["/api/cart"]);
  assert.equal(routesFor(routes, "app", 1).length, 2);

  const lines = outputLines("\u001b[32mapi ready\u001b[0m\r\npayment refused: Amount must be at least 50 cents\nother\n", ["payment refused: Amount must be at least 50 cents"]);
  assert.deepEqual(lines, [{ text: "api ready", hit: false }, { text: "payment refused: Amount must be at least 50 cents", hit: true }, { text: "other", hit: false }]);

  assert.equal(formatTtl(null), "no expiry");
  assert.equal(formatTtl(59_400), "59s");
  assert.equal(formatTtl(600_000), "10m");
  assert.deepEqual(titleParts("POSTGRES · orders"), { head: "POSTGRES", sub: "orders" });
  assert.deepEqual(titleParts("Stripe (test double)"), { head: "STRIPE", sub: "test double" });
  assert.deepEqual(titleParts("API"), { head: "API" });
});

test("fastapi: a click through a Python API Shrike can't see inside never claims nothing changed", () => {
  const post = ev({ kind: "http_request", origin: "browser", name: "POST /api/v1/items/", http: { method: "POST", url: "http://localhost:18000/api/v1/items/", status: 200 } });
  assert.equal(unseenWriter(view([post]), PG.id), "localhost:18000");
  assert.equal(unseenWriter(view([ev({ ...post, http: { ...post.http!, url: "http://127.0.0.1:18000/x" } })]), PG.id), "localhost:18000");
  const seen = { ...view([]), tree: [{ event: post, children: [{ event: ev({ kind: "http_request", name: "POST /api/v1/items/" }), children: [] }] }] };
  assert.equal(unseenWriter(seen, PG.id), undefined, "the server side was recorded");
  assert.equal(unseenWriter(view([post, ev({ kind: "db_query", place: PG, otel: true, db: { system: "postgres", statement: "INSERT INTO t" } })]), PG.id), "localhost:18000", "OpenTelemetry queries carry no row changes");
  assert.equal(unseenWriter(view([post, ev({ kind: "db_query", place: PG, db: { system: "postgres", statement: "SELECT 1" } })]), PG.id), undefined, "queries reached this database");
  assert.equal(unseenWriter(view([ev({ ...post, http: { ...post.http!, url: "https://api.stripe.com/v1/charges" } })]), PG.id), undefined, "an outside API is not our database's writer");
});

test("python-agent: steps recorded but database writes it can't read never claim nothing changed", () => {
  const svc = { kind: "service" as const, id: "service:api", name: "API", detail: "localhost:4620" };
  const step = ev({ name: "create_order()", place: svc, source: { file: "app/main.py", line: 40, precision: "exact" } });
  assert.equal(unseenWriter(view([step]), PG.id), "localhost:4620", "a driver python-agent doesn't hook (pg8000): no query reached Shrike");
  assert.equal(unseenWriter(view([step]), "data:sqlite:edge.db"), undefined, "python-agent sees every sqlite3 query");
  const SQ = { kind: "data" as const, id: "data:sqlite:shop.db", name: "SQLITE · shop.db" };
  const insert = ev({ kind: "db_query", place: SQ, name: "INSERT INTO orders (item) VALUES (?)", db: { system: "sqlite", statement: "INSERT INTO orders (item) VALUES (?)" } });
  const req = ev({ kind: "http_request", name: "POST /api/orders", place: svc });
  const tree = (q: DebugEvent) => ({ ...view([]), tree: [{ event: req, children: [{ event: step, children: [{ event: q, children: [] }] }] }] });
  assert.equal(unseenWriter(tree(insert), SQ.id), "localhost:4620", "a write seen without its rows");
  assert.equal(unseenWriter(tree({ ...insert, change: { op: "insert", table: "orders", count: 1 } }), SQ.id), undefined, "node-agent's writes carry their rows");
  assert.equal(unseenWriter(tree({ ...insert, name: "SELECT 1", db: { system: "sqlite", statement: "SELECT 1" } }), SQ.id), undefined, "reads change nothing");
});

test("python-agent: Postgres writes through psycopg carry their rows, a count it couldn't get stays can't tell", () => {
  const svc = { kind: "service" as const, id: "service:api", name: "API", detail: "localhost:4620" };
  const EDGE = { kind: "data" as const, id: "data:postgres:localhost:4623/edge", name: "POSTGRES · edge" };
  const req = ev({ kind: "http_request", name: "POST /api/orders", place: svc });
  const step = ev({ name: "create_order()", place: svc, source: { file: "main.py", line: 81, precision: "exact" } });
  const stmt = "INSERT INTO orders (item, cents, currency, receipt_sent) VALUES (%(item)s::VARCHAR, %(cents)s::INTEGER, %(currency)s::VARCHAR, %(receipt_sent)s) RETURNING orders.id";
  const insert = ev({ kind: "db_query", origin: "db", place: EDGE, name: stmt.slice(0, 60), db: { system: "postgres", statement: stmt }, change: { table: "orders", op: "insert", count: 1, rows: [{ pk: "1", after: { item: "mug", cents: 1200, currency: "USD", receipt_sent: false, id: 1 } }] } });
  const tree = (...qs: DebugEvent[]) => ({ ...view([]), tree: [{ event: req, children: [{ event: step, children: qs.map((event) => ({ event, children: [] })) }] }] });
  assert.equal(unseenWriter(tree(insert), EDGE.id), undefined, "SQLAlchemy over psycopg: the write and its rows reached Shrike");
  assert.deepEqual(dataChanges(tree(insert), EDGE.id).map((g) => [g.table, g.added, g.rows[0]?.after?.item]), [["orders", 1, "mug"]]);
  const blind = ev({ kind: "db_query", origin: "db", place: EDGE, name: "UPDATE orders SET receipt_sent = true", db: { system: "postgres", statement: "UPDATE orders SET receipt_sent = true WHERE item = $1 RETURNING *" } });
  assert.equal(unseenWriter(tree(insert, blind), EDGE.id), "localhost:4620", "asyncpg's fetchrow can't say how many rows a non-key UPDATE changed");
  assert.equal(unseenWriter(tree({ ...insert, change: { table: "orders", op: "update", count: 0 } }), EDGE.id), undefined, "a write that matched nothing changed nothing");
});

test("rowAsJson and rowAsInsert copy a row as JSON or an SQL INSERT (#93)", () => {
  const cols = ["id", "title", "done"];
  assert.equal(rowAsJson(cols, [1, "buy milk", false]), '{"id":1,"title":"buy milk","done":false}');
  assert.equal(
    rowAsInsert("todos", cols, [1, "buy milk", false]),
    `INSERT INTO "todos" ("id", "title", "done") VALUES (1, 'buy milk', FALSE);`,
  );
  // Quoting rules: a ' inside a string is doubled, NULL stays NULL, booleans become TRUE/FALSE.
  assert.equal(
    rowAsInsert("todos", cols, [2, "it's done", null]),
    `INSERT INTO "todos" ("id", "title", "done") VALUES (2, 'it''s done', NULL);`,
  );
  assert.equal(rowAsInsert("todos", cols, [3, "x", true]).endsWith("TRUE);"), true);
  // A redacted value copies masked: the helpers only see what the grid shows.
  assert.equal(rowAsJson(["password"], ["[redacted:password]"]), '{"password":"[redacted:password]"}');
  assert.equal(rowAsInsert("users", ["password"], ["[redacted:password]"]), `INSERT INTO "users" ("password") VALUES ('[redacted:password]');`);
});
