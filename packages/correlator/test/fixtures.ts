import type { DebugEvent } from "@shrike/schema";

const T = "0af7651916cd43dd8448eb211c80319c";
let n = 0;
export const id = (): string => (++n).toString(16).padStart(16, "0");

export function ev(p: Partial<DebugEvent> & Pick<DebugEvent, "kind" | "name" | "startMs">): DebugEvent {
  return { id: id(), traceId: T, origin: "server", status: "ok", ...p };
}

// The contract's killer demo: Add Todo -> 500 from a NOT NULL constraint.
export function addTodo() {
  const root = ev({ kind: "user_action", origin: "browser", name: 'Clicked "Add Todo"', trigger: "click", startMs: 1000, source: { file: "src/TodoForm.tsx", line: 31, precision: "exact" } });
  const fetch = ev({ kind: "http_request", origin: "browser", parentId: root.id, name: "POST /api/todos", startMs: 1002, durationMs: 44, status: "error",
    source: { file: "src/api.ts", line: 12, precision: "exact" },
    http: { method: "POST", url: "/api/todos", status: 500, reqBody: '{"title":"buy milk","userId":1}', resBody: '{"error":"NOT NULL constraint failed: todos.user_id"}' } });
  const server = ev({ kind: "http_request", parentId: fetch.id, name: "POST /api/todos", startMs: 1004, durationMs: 40, status: "error",
    http: { method: "POST", url: "/api/todos", status: 500 } });
  const mw = ev({ kind: "function", parentId: server.id, name: "jsonParser()", startMs: 1004.5, durationMs: 0.5, source: { file: "node_modules/express/lib/x.js", line: 3, precision: "exact" } });
  const create = ev({ kind: "function", parentId: server.id, name: "createTodo()", startMs: 1005, durationMs: 38, status: "error",
    source: { file: "server/todos.controller.ts", line: 14, precision: "exact" },
    args: ["req { POST /api/todos body: { title: 'buy milk', userId: 1 } }", "res"], error: { message: "NOT NULL constraint failed: todos.user_id" } });
  const log = ev({ kind: "log", parentId: create.id, name: "log", startMs: 1006, log: { level: "info", message: "creating todo { title: 'buy milk' }" }, source: { file: "server/todos.controller.ts", line: 16, precision: "exact" } });
  const insert = ev({ kind: "function", parentId: create.id, name: "insertTodo()", startMs: 1007, durationMs: 2, status: "error",
    source: { file: "server/db.ts", line: 20, precision: "exact" }, callSite: { file: "server/todos.controller.ts", line: 18, precision: "exact" },
    args: ["{ title: 'buy milk', userId: undefined }"], error: { message: "NOT NULL constraint failed: todos.user_id" } });
  const db = ev({ kind: "db_query", origin: "db", parentId: insert.id, name: "INSERT INTO todos", startMs: 1007.5, durationMs: 1, status: "error",
    source: { file: "server/db.ts", line: 22, precision: "exact" },
    db: { system: "sqlite", statement: "INSERT INTO todos (title, user_id)\n  VALUES (?, ?)", params: "[ 'buy milk', undefined ]" }, error: { message: "NOT NULL constraint failed: todos.user_id" } });
  // shuffled on purpose
  return { root, events: [db, log, root, insert, server, create, mw, fetch], ids: { fetch, server, create, log, insert, db, mw } };
}

export function addTodoFixed() {
  const root = ev({ kind: "user_action", origin: "browser", name: 'Clicked "Add Todo"', trigger: "click", startMs: 5000, durationMs: 20 });
  const fetch = ev({ kind: "http_request", origin: "browser", parentId: root.id, name: "POST /api/todos", startMs: 5001, durationMs: 15,
    http: { method: "POST", url: "/api/todos", status: 201, resBody: '{"id":1,"title":"buy milk"}' } });
  const server = ev({ kind: "http_request", parentId: fetch.id, name: "POST /api/todos", startMs: 5002, durationMs: 12, http: { method: "POST", url: "/api/todos", status: 201 } });
  const create = ev({ kind: "function", parentId: server.id, name: "createTodo()", startMs: 5003, durationMs: 10, source: { file: "server/todos.controller.ts", line: 14, precision: "exact" } });
  return { root, events: [root, fetch, server, create] };
}

const API = { kind: "service", id: "service:api", name: "API", detail: "localhost:4100" } as const;
const AUTH = { kind: "service", id: "service:auth", name: "AUTH", detail: "localhost:4101" } as const;

// Pay now: api checks the session cache, asks auth, then Stripe refuses the charge.
export function payNow(opts: { authMs?: number } = {}) {
  const authMs = opts.authMs ?? 6;
  const root = ev({ kind: "user_action", origin: "browser", name: 'Clicked "Pay now"', trigger: "click", startMs: 0 });
  const fetch = ev({ kind: "http_request", origin: "browser", parentId: root.id, name: "POST /api/pay", startMs: 1, durationMs: authMs + 40, status: "error",
    http: { method: "POST", url: "/api/pay", status: 402 } });
  const api = ev({ kind: "http_request", parentId: fetch.id, name: "POST /api/pay", startMs: 2, durationMs: authMs + 38, place: API,
    http: { method: "POST", url: "/api/pay", status: 402 } });
  const pay = ev({ kind: "function", parentId: api.id, name: "pay()", startMs: 3, durationMs: authMs + 36, place: API, source: { file: "api/pay.ts", line: 4, precision: "exact" } });
  const cache = ev({ kind: "cache_op", origin: "db", parentId: pay.id, name: "GET session:91", startMs: 4, durationMs: 0.2, cache: { op: "get", key: "session:91", hit: true },
    place: { kind: "cache", id: "cache:lru:sessions", name: "LRU · sessions" }, source: { file: "api/pay.ts", line: 6, precision: "exact" } });
  const toAuth = ev({ kind: "external_call", parentId: pay.id, name: "GET localhost:4101/verify", startMs: 5, durationMs: authMs,
    http: { method: "GET", url: "http://localhost:4101/verify", status: 200 }, place: { kind: "outside", id: "outside:localhost:4101", name: "LOCALHOST:4101", detail: "localhost:4101" },
    source: { file: "api/pay.ts", line: 8, precision: "exact" } });
  const authReq = ev({ kind: "http_request", parentId: toAuth.id, name: "GET /verify", startMs: 5.5, durationMs: authMs - 1, place: AUTH, http: { method: "GET", url: "/verify", status: 200 } });
  const stripe = ev({ kind: "external_call", parentId: pay.id, name: "POST api.stripe.com/v1/charges", startMs: authMs + 6, durationMs: 30, status: "error",
    http: { method: "POST", url: "https://api.stripe.com/v1/charges", status: 400, resBody: '{"error":{"message":"amount must be at least 50 cents","type":"invalid_request_error"}}' },
    place: { kind: "outside", id: "outside:api.stripe.com", name: "STRIPE", detail: "api.stripe.com" }, source: { file: "api/pay.ts", line: 12, precision: "exact" } });
  return { root, events: [stripe, authReq, toAuth, cache, pay, api, fetch, root], ids: { fetch, api, pay, cache, toAuth, authReq, stripe } };
}

// CORS: a cross-origin fetch from the browser fails with no status.
export function corsBlocked() {
  const root = ev({ kind: "user_action", origin: "browser", name: 'Clicked "Load profile"', trigger: "click", startMs: 0, durationMs: 3 });
  const fetch = ev({
    kind: "http_request",
    origin: "browser",
    parentId: root.id,
    name: "GET https://api.example.com/me",
    startMs: 1,
    durationMs: 2,
    status: "error",
    source: { file: "src/api.ts", line: 12, precision: "exact" },
    http: { method: "GET", url: "https://api.example.com/me" },
  });
  return { root, events: [fetch, root], ids: { fetch } };
}

// Mixed content: an https page calls an http URL.
export function mixedContent() {
  const root = ev({ kind: "user_action", origin: "browser", name: 'Clicked "Load image"', trigger: "click", startMs: 0, durationMs: 3 });
  const fetch = ev({
    kind: "http_request",
    origin: "browser",
    parentId: root.id,
    name: "GET http://insecure.example.com/img.png",
    startMs: 1,
    durationMs: 2,
    status: "error",
    live: true,
    source: { file: "src/api.ts", line: 30, precision: "exact" },
    http: { method: "GET", url: "http://insecure.example.com/img.png" },
  });
  return { root, events: [fetch, root], ids: { fetch } };
}

// Same-origin server down: relative URL, no status. Must NOT read as CORS.
export function sameOriginDown() {
  const root = ev({ kind: "user_action", origin: "browser", name: 'Clicked "Load"', trigger: "click", startMs: 0, durationMs: 3 });
  const fetch = ev({
    kind: "http_request",
    origin: "browser",
    parentId: root.id,
    name: "GET /api/data",
    startMs: 1,
    durationMs: 2,
    status: "error",
    source: { file: "src/api.ts", line: 5, precision: "exact" },
    http: { method: "GET", url: "/api/data" },
  });
  return { root, events: [fetch, root], ids: { fetch } };
}
// SameSite: a cross-origin request with credentials that came back 401.
export function sameSiteBlocked() {
  const root = ev({ kind: "user_action", origin: "browser", name: 'Clicked "Refresh"', trigger: "click", startMs: 0, durationMs: 3 });
  const fetch = ev({
    kind: "http_request",
    origin: "browser",
    parentId: root.id,
    name: "GET https://api.example.com/me",
    startMs: 1,
    durationMs: 2,
    status: "error",
    source: { file: "src/api.ts", line: 20, precision: "exact" },
    http: { method: "GET", url: "https://api.example.com/me", status: 401, reqHeaders: { cookie: "session=abc" } },
  });
  return { root, events: [fetch, root], ids: { fetch } };
}