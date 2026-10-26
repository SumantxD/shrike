import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ActionView, ApprovalRequest, DebugEvent, Finding, Flag, HttpRequestSpec, MemoryNote, ShrikeHost, TimelineNode } from "@shrike/schema";
import { INTERNAL_HEADER, parseSkill, startMcpServer, type SkillDoc } from "../src/index.ts";

const TRACE = "a".repeat(32);
const ROOT_ID = "1111111111111111";
const AFTER_ID = "2222222222222222";

function ev(p: Partial<DebugEvent> & Pick<DebugEvent, "id" | "kind" | "name">): DebugEvent {
  return { traceId: TRACE, origin: "server", startMs: 1000, durationMs: 5, status: "ok", ...p };
}

function view(id: string, failing: boolean, flags: Flag[] = []): ActionView {
  const root = ev({ id, kind: "user_action", origin: "browser", name: 'Clicked "Add Todo"', trigger: "click", status: failing ? "error" : "ok", traceId: id.repeat(2) });
  const t = root.traceId;
  const query = ev({
    id: id.slice(0, 12) + "dddd", traceId: t, kind: "db_query", origin: "db", name: "INSERT INTO todos", parentId: "f",
    status: failing ? "error" : "ok",
    source: { file: "server/todos.repo.ts", line: 9, precision: "exact" },
    ...(failing ? { error: { message: "NOT NULL constraint failed: todos.user_id" } } : {}),
  });
  const fn = ev({ id: id.slice(0, 12) + "ffff", traceId: t, kind: "function", name: "createTodo()", source: { file: "server/todos.controller.ts", line: 14, precision: "exact" }, status: failing ? "error" : "ok" });
  const log = ev({ id: id.slice(0, 12) + "eeee", traceId: t, kind: "log", name: "creating todo", log: { level: "info", message: "creating todo { title: 'buy milk' }" }, source: { file: "server/todos.controller.ts", line: 16, precision: "exact" } });
  const http = ev({ id: id.slice(0, 12) + "cccc", traceId: t, kind: "http_request", name: "POST /api/todos", http: { method: "POST", url: "/api/todos", status: failing ? 500 : 201 }, status: failing ? "error" : "ok" });
  const tree: TimelineNode[] = [{ event: http, children: [{ event: fn, children: [{ event: log, children: [] }, { event: query, children: [] }] }] }];
  return {
    id, traceId: t, trigger: "click", label: root.name, startMs: id === ROOT_ID ? 1000 : 2000, durationMs: 42,
    status: root.status, complete: true, tree, root,
    summary: { headline: "x", steps: [], stats: { files: 2, functions: 1, requests: 1, queries: 1, logs: 1, errors: failing ? 1 : 0, totalMs: 42 } },
    flags,
  };
}

// AFTER_ID is the trip that "worked" while swallowing an error: it carries a
// swallowed_error flag even though its status is ok, while ROOT_ID is clean.
const actions = new Map([
  [ROOT_ID, view(ROOT_ID, true)],
  [AFTER_ID, view(AFTER_ID, false, [{ kind: "swallowed_error", eventId: AFTER_ID.slice(0, 12) + "ffff", message: "A step inside failed but the server still replied 201." }])],
]);
const allEvents = [...actions.values()].flatMap((a) => {
  const out: DebugEvent[] = [a.root];
  const walk = (ns: TimelineNode[]) => ns.forEach((n) => (out.push(n.event), walk(n.children)));
  walk(a.tree);
  return out;
});

let root: string;
const calls: { approvals: Omit<ApprovalRequest, "id">[]; sent: HttpRequestSpec[]; findings: Finding[][]; patches: unknown[]; clicks: string[]; notes: MemoryNote[]; watches: [string, string[]][] } = {
  approvals: [], sent: [], findings: [], patches: [], clicks: [], notes: [], watches: [],
};
let feedback: string | undefined;
let approve = true;
let patchDecision: "applied" | "rejected" = "applied";

const host: ShrikeHost = {
  projectRoot: () => root,
  listActions: () => [...actions.values()],
  getAction: (id) => actions.get(id),
  getEvent: (id) => allEvents.find((e) => e.id === id),
  searchEvents: (q) => allEvents.filter((e) => JSON.stringify(e).toLowerCase().includes(q.toLowerCase())),
  listFiles: async () => ["server/todos.controller.ts", "src/App.tsx", "node_modules/x/index.js", ".env"],
  readFile: (p) => fs.readFile(path.join(root, p), "utf8"),
  searchCode: async (q) => [{ file: "server/todos.controller.ts", line: 18, text: `  ${q}({ title, userId: req.body.user })` }, { file: ".env", line: 1, text: "SECRET=1" }],
  listRoutes: () => [{ method: "POST", path: "/api/todos", handler: { file: "server/todos.controller.ts", line: 14, precision: "exact" } }, { method: "GET", path: "/api/todos" }],
  sendRequest: async (req) => {
    calls.sent.push(req);
    return { response: { status: 500, statusText: "Internal Server Error", headers: {}, body: '{"error":"boom"}' + "x".repeat(5000), durationMs: 12 }, actionId: ROOT_ID };
  },
  appSnapshot: async () => ({
    url: "http://localhost:5173/", title: "Todos",
    elements: [
      { ref: "e1", role: "textbox", name: "What needs doing?" },
      { ref: "e2", role: "button", name: "Add Todo" },
      { ref: "e3", role: "checkbox", name: "Toggle buy eggs" },
    ],
    text: "Todos\nbuy eggs",
  }),
  appClick: async (ref) => (calls.clicks.push(ref), { actionId: ref === "e2" ? ROOT_ID : null }),
  appType: async (_ref, _text, submit) => ({ actionId: submit ? ROOT_ID : null }),
  appNavigate: async () => ({ actionId: AFTER_ID }),
  waitForAction: async (id) => actions.get(id),
  requestApproval: async (req) => (calls.approvals.push(req), approve),
  proposePatch: async (files, rationale, from) => (calls.patches.push({ files, rationale, from }), { patchId: "p1", status: patchDecision, ...(feedback ? { feedback } : {}) }),
  revertPatch: async () => {},
  reportFindings: (f) => void calls.findings.push(f),
  remember: async (n) => {
    const note: MemoryNote = { id: `m${calls.notes.length + 1}`, createdAt: 1, by: "agent", ...n };
    calls.notes.push(note);
    return note;
  },
  noteWatch: (client, ids) => void calls.watches.push([client, ids]),
};

let server: Awaited<ReturnType<typeof startMcpServer>>;
let client: Client;

async function connect(name = "test", internal = true) {
  const c = new Client({ name, version: "0" });
  const headers: Record<string, string> = { Authorization: `Bearer ${server.token}`, ...(internal ? { [INTERNAL_HEADER]: "1" } : {}) };
  await c.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }));
  return c;
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
  return { text, isError: r.isError === true };
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "shrike-mcp-"));
  await fs.mkdir(path.join(root, "server"));
  await fs.mkdir(path.join(root, "node_modules/x"), { recursive: true });
  await fs.writeFile(path.join(root, "server/todos.controller.ts"), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"));
  await fs.writeFile(path.join(root, ".env"), "SECRET=1");
  await fs.writeFile(path.join(root, "node_modules/x/index.js"), "x");
  await fs.symlink("/etc", path.join(root, "etc-link"));
  await fs.mkdir(path.join(root, "skills"));
  await fs.writeFile(path.join(root, "skills/bad-value.md"), "---\nname: Bad value\nwhen: A value is wrong\n---\n\n# Bad value\n\n1. Follow the value.\n");
  await fs.writeFile(path.join(root, "skills/broken.md"), "no front matter");
  server = await startMcpServer(host, { skillsDir: path.join(root, "skills") });
  client = await connect();
});

after(async () => {
  await client.close();
  await server.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("binds to 127.0.0.1 and rejects requests without the bearer token", async () => {
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } } };
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  assert.equal((await fetch(server.url, { method: "POST", headers, body: JSON.stringify(init) })).status, 401);
  assert.equal((await fetch(server.url, { method: "POST", headers: { ...headers, authorization: "Bearer nope" }, body: JSON.stringify(init) })).status, 401);
  const unknown = await fetch(server.url, { method: "POST", headers: { ...headers, authorization: `Bearer ${server.token}`, "mcp-session-id": "gone" }, body: "{}" });
  assert.equal(unknown.status, 404);
});

test("lists every contract tool", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "app_click", "app_navigate", "app_snapshot", "app_type", "compare_actions", "get_action", "get_event", "get_logs",
    "list_actions", "list_files", "list_requests", "list_routes", "load_skill", "plan", "propose_patch", "propose_skill_update", "read_file", "remember", "report_findings", "run_scenario",
    "save_request", "search_code", "search_events", "send_request",
  ]);
  assert.ok(tools.every((t) => t.description && t.inputSchema.type === "object"));
});

test("several clients and reconnects get their own sessions", async () => {
  const a = await connect();
  const b = await connect();
  assert.equal((await a.listTools()).tools.length, 24);
  await a.close();
  assert.equal((await b.listTools()).tools.length, 24);
  await b.close();
  const c = await connect();
  assert.equal((await c.listTools()).tools.length, 24);
  await c.close();
});

test("recordings tools", async () => {
  const list = await call("list_actions");
  assert.match(list.text, new RegExp(`^Action ${AFTER_ID}`)); // newest first
  assert.match((await call("list_actions", { status: "error" })).text, /^Action 1111111111111111 .*error/);
  assert.doesNotMatch((await call("list_actions", { status: "error" })).text, /warnings:/); // clean trips show nothing extra

  // #37: warning kinds on the line, and the flagged / flag filters.
  assert.match((await call("list_actions", { flagged: true })).text, new RegExp(`^Action ${AFTER_ID} .*warnings: swallowed_error`));
  assert.match((await call("list_actions", { flag: "swallowed_error" })).text, new RegExp(`^Action ${AFTER_ID}`));
  assert.match((await call("list_actions", { flagged: true, status: "error" })).text, /No Actions match the given filters/);
  assert.match((await call("list_actions", { flag: "slow" })).text, /No Actions match the given filters/);

  // #37: get_action's Flags: block is covered, not just the list line.
  const flaggedView = await call("get_action", { actionId: AFTER_ID });
  assert.match(flaggedView.text, /Flags:/);
  assert.match(flaggedView.text, /swallowed_error: A step inside failed but the server still replied 201/);

  const got = await call("get_action", { actionId: ROOT_ID });
  assert.match(got.text, /Action 1111111111111111/);
  assert.match(got.text, /INSERT INTO todos/);
  assert.match(got.text, /server\/todos\.controller\.ts:14/);
  assert.equal((await call("get_action", { actionId: "nope" })).isError, true);

  const e = await call("get_event", { eventId: ROOT_ID.slice(0, 12) + "dddd" });
  assert.match(e.text, /NOT NULL constraint failed/);
  assert.match(e.text, /In action 1111111111111111/);

  const s = await call("search_events", { query: "insert", kind: "db_query" });
  assert.match(s.text, /db_query INSERT INTO todos .* action 1111111111111111/);
  assert.match((await call("search_events", { query: "zzz" })).text, /No events/);

  assert.match((await call("get_logs", { actionId: ROOT_ID })).text, /\[info\] server: creating todo .*server\/todos\.controller\.ts:16/);
  assert.match((await call("get_logs")).text, /creating todo/);

  const cmp = await call("compare_actions", { beforeId: ROOT_ID, afterId: AFTER_ID });
  assert.equal(cmp.isError, false);
  assert.ok(cmp.text.length > 0);
});

test("app tools resolve names through a fresh snapshot", async () => {
  const snap = await call("app_snapshot");
  assert.match(snap.text, /\[e2\] button "Add Todo"/);

  const byName = await call("app_click", { name: "add todo" });
  assert.equal(byName.isError, false);
  assert.match(byName.text, /Clicked \[e2\] button "Add Todo"/);
  assert.match(byName.text, /INSERT INTO todos/);
  assert.equal(calls.clicks.at(-1), "e2");

  const missing = await call("app_click", { name: "Delete todo" });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /No element named "Delete todo"/);
  assert.match(missing.text, /Close matches:\n\[e2\] button "Add Todo"/);

  assert.match((await call("app_click", { ref: "e3" })).text, /Nothing was recorded/);
  assert.equal((await call("app_click", {})).isError, true);

  const typed = await call("app_type", { name: "What needs doing?", text: "buy milk", submit: true });
  assert.match(typed.text, /Typed into \[e1\] textbox .*and submitted/);
  assert.match(typed.text, /Action 1111111111111111/);

  assert.match((await call("app_navigate", { url: "/todos" })).text, /Action 2222222222222222/);
  assert.equal((await call("app_navigate", { url: "https://example.com" })).isError, true);
});

test("run_scenario reports each step and an overall result", async () => {
  const fail = await call("run_scenario", {
    steps: [
      { action: "type", name: "What needs doing?", text: "buy milk" },
      { action: "click", name: "Add Todo" },
      { action: "wait", ms: 1 },
    ],
  });
  assert.match(fail.text, /Step 1: Typed into/);
  assert.match(fail.text, /Step 2: Clicked .*\nAction 1111111111111111/);
  assert.match(fail.text, /Result: FAIL/);
  assert.match(fail.text, /NOT NULL constraint failed: todos\.user_id \(server\/todos\.repo\.ts:9\)/);

  assert.match((await call("run_scenario", { steps: [{ action: "navigate", url: "/" }] })).text, /Result: PASS/);
  const broken = await call("run_scenario", { steps: [{ action: "click", name: "Nope" }, { action: "click", name: "Add Todo" }] });
  assert.match(broken.text, /Step 1: could not run.*\n[\s\S]*FAIL \(stopped early\)/);
  assert.doesNotMatch(broken.text, /Step 2/);
});

test("api tools and the approval gate", async () => {
  assert.match((await call("list_routes")).text, /POST \/api\/todos {2}handler server\/todos\.controller\.ts:14/);
  assert.match((await call("list_routes", { query: "get" })).text, /^GET \/api\/todos$/);

  calls.approvals.length = 0;
  calls.sent.length = 0;
  const get = await call("send_request", { method: "get", url: "/api/todos" });
  assert.equal(calls.approvals.length, 0);
  assert.match(get.text, /^HTTP 500 Internal Server Error \(12ms\)/);
  assert.match(get.text, /…\[truncated\]/);
  assert.match(get.text, /Action 1111111111111111/);

  approve = false;
  const denied = await call("send_request", { method: "POST", url: "/api/todos", body: "{}", reason: "reproduce" });
  assert.equal(denied.isError, true);
  assert.match(denied.text, /declined/);
  assert.equal(calls.approvals.length, 1);
  assert.equal(calls.approvals[0]!.kind, "request");
  assert.equal(calls.approvals[0]!.reason, "reproduce");
  assert.equal(calls.sent.length, 1); // only the GET

  approve = true;
  assert.equal((await call("send_request", { method: "DELETE", url: "/api/todos/1" })).isError, false);
  assert.equal(calls.sent.length, 2);
  assert.equal((await call("send_request", { method: "GET", url: "http://evil.example/x" })).isError, true);
  assert.equal(calls.sent.length, 2);
});

test("AP: outside the app asks first, save_request writes through the host", async () => {
  const outside: HttpRequestSpec[] = [];
  const saved: { name: string; url: string; folder?: string }[] = [];
  host.api = {
    send: async (spec, checks) => (outside.push(spec), { response: { status: 200, statusText: "OK", headers: {}, body: "{}", durationMs: 3 }, ...(checks?.length ? { assertions: checks.map((c) => ({ ...c, ok: c.op === "eq", actual: "200" })) } : {}) }),
    save: async (req, folder) => (saved.push({ name: req.name, url: req.url, ...(folder ? { folder } : {}) }), "Shrike/x.bru"),
    list: async () => [{ collection: "Shrike", path: "x.bru", method: "GET", name: "x" }],
  };
  try {
    calls.approvals.length = 0;
    approve = false;
    assert.equal((await call("send_request", { method: "GET", url: "https://api.example.com/v1" })).isError, true);
    assert.equal(outside.length, 0);
    assert.match(calls.approvals[0]!.title, /outside your app/);
    approve = true;
    assert.match((await call("send_request", { method: "GET", url: "https://api.example.com/v1" })).text, /^HTTP 200 OK/);
    assert.equal(outside.length, 1);

    const checked = await call("send_request", { method: "GET", url: "/api/todos", assertions: ["res.status eq 200", { expr: "res.body.id", op: "isNumber" }] });
    assert.match(checked.text, /Assertions: 1 of 2 passed\nPASS res\.status eq 200\nFAIL res\.body\.id isNumber \(got 200\)/);
    assert.equal(outside.length, 2); // assertions go through the API client, even for the app's own address
    assert.equal((await call("send_request", { method: "GET", url: "/api/todos", assertions: ["nope"] })).isError, true);

    calls.approvals.length = 0;
    assert.match((await call("save_request", { name: "List todos", method: "get", url: "{{baseUrl}}/api/todos", folder: "todos" })).text, /Saved GET List todos as Shrike\/x\.bru/);
    assert.equal(calls.approvals.length, 0);
    assert.deepEqual(saved[0], { name: "List todos", url: "{{baseUrl}}/api/todos", folder: "todos" });
    approve = false;
    assert.equal((await call("save_request", { name: "Prod", method: "GET", url: "https://prod.example.com/x" })).isError, true);
    assert.equal(saved.length, 1);
    assert.equal((await call("save_request", { name: "Up", method: "GET", url: "/x", folder: "../up" })).isError, true);
    assert.match((await call("list_requests")).text, /GET x {2}\(Shrike: x\.bru\)/);
  } finally {
    approve = true;
    delete host.api;
  }
});

test("code tools refuse paths outside the project or into secrets", async () => {
  const r = await call("read_file", { path: "server/todos.controller.ts", startLine: 14, endLine: 16 });
  assert.equal(r.text, "server/todos.controller.ts lines 14-16\n14| line 14\n15| line 15\n16| line 16\n(30 lines in total; pass startLine 17 to read more)");
  assert.match((await call("read_file", { path: "./server/todos.controller.ts" })).text, /lines 1-30\n 1\| line 1/);

  for (const p of ["../../etc/passwd", "/etc/passwd", ".env", ".env.local", "node_modules/x/index.js", ".git/config", "etc-link/hosts", "server/../../x"]) {
    const res = await call("read_file", { path: p });
    assert.equal(res.isError, true, p);
    assert.match(res.text, /outside the project|off limits/, p);
  }
  assert.equal((await call("read_file", { path: "server/missing.ts" })).isError, true);

  const sc = await call("search_code", { query: "insertTodo" });
  assert.match(sc.text, /server\/todos\.controller\.ts:18: insertTodo/);
  assert.doesNotMatch(sc.text, /\.env/);

  const lf = await call("list_files");
  assert.equal(lf.text, "server/todos.controller.ts\nsrc/App.tsx");
  assert.equal((await call("list_files", { glob: "*.tsx" })).text, "src/App.tsx");
  assert.equal((await call("list_files", { glob: "server/**" })).text, "server/todos.controller.ts");
});

test("propose_patch and report_findings go through the host", async () => {
  const files = [{ path: "server/todos.controller.ts", edits: [{ oldText: "req.body.user", newText: "req.body.userId" }] }];
  const ok = await call("propose_patch", { files, rationale: "Read the field the frontend sends." });
  assert.match(ok.text, /Patch p1 applied.*run_scenario/);
  assert.deepEqual(calls.patches.at(-1), { files, rationale: "Read the field the frontend sends.", from: "Shrike agent" });

  patchDecision = "rejected";
  assert.match((await call("propose_patch", { files, rationale: "x" })).text, /Patch p1 rejected/);

  const n = calls.patches.length;
  assert.equal((await call("propose_patch", { files: [{ path: ".env", edits: [{ oldText: "a", newText: "b" }] }], rationale: "x" })).isError, true);
  assert.equal((await call("propose_patch", { files: [{ path: "pnpm-lock.yaml", edits: [{ oldText: "a", newText: "b" }] }], rationale: "x" })).isError, true);
  assert.equal(calls.patches.length, n);

  const findings = [{ confidence: "observed", claim: "The server read req.body.user", file: "server/todos.controller.ts", line: 18 }];
  assert.match((await call("report_findings", { findings, summary: "Wrong field name." })).text, /Reported 1 finding/);
  assert.deepEqual(calls.findings.at(-1), findings);
  assert.equal((await call("report_findings", { findings: [{ confidence: "sure", claim: "x" }], summary: "x" })).isError, true);
});

test("plan, load_skill and remember", async () => {
  const p = await call("plan", { checks: ["check what the page sent", "check what the server saved"], stationLabels: ["createTodo()"] });
  assert.equal(p.isError, false);
  assert.match(p.text, /Plan noted: 2 checks/);
  assert.equal((await call("plan", { checks: [] })).isError, true);

  const sk = await call("load_skill", { skill: "Bad-Value" });
  assert.match(sk.text, /^Playbook: Bad value\nUse when: A value is wrong\nDone when: the fix is applied and the failing trip passes again\n\n# Bad value/);
  const missing = await call("load_skill", { skill: "nope" });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /Available: bad-value\.$/); // broken.md has no front matter

  const r = await call("remember", { text: " userId must be a number ", file: "./server/todos.controller.ts", line: 18 });
  assert.equal(r.text, "Remembered: userId must be a number (server/todos.controller.ts:18)");
  assert.deepEqual(calls.notes.at(-1), { id: "m1", createdAt: 1, by: "agent", text: "userId must be a number", file: "server/todos.controller.ts", line: 18 });
  assert.equal((await call("remember", { text: "x", file: ".env" })).isError, true);
  assert.equal(calls.notes.length, 1);
});

test("load_skill reads every source through the skills host; propose_skill_update hands the change to the host as a draft", async () => {
  const docs: SkillDoc[] = [
    { id: "bad-value", name: "Bad value", when: "A value is wrong", body: "1. Follow the value.", source: "builtin" },
    { id: "navigate-xyne-spaces", name: "navigate-xyne-spaces", when: "Use when asked to click through", body: "## 1. Attach", source: "claude", readOnly: true },
  ];
  const used: string[] = [];
  const proposed: { skillId: string; reason: string; after: string }[] = [];
  const s2 = await startMcpServer(host, { skills: { list: async () => docs, used: (id) => void used.push(id), propose: async (p) => (proposed.push(p), "Suggested.") } });
  const c = new Client({ name: "t", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(s2.url), { requestInit: { headers: { Authorization: `Bearer ${s2.token}`, [INTERNAL_HEADER]: "1" } } }));
  const run = async (name: string, args: Record<string, unknown>) => {
    const r = await c.callTool({ name, arguments: args });
    return { text: (r.content as { text: string }[]).map((x) => x.text).join("\n"), isError: r.isError === true };
  };
  try {
    assert.match((await run("load_skill", { skill: "Navigate-Xyne-Spaces" })).text, /^Playbook: navigate-xyne-spaces\nUse when: Use when asked to click through\nDone when: .+\n\n## 1\. Attach$/);
    assert.deepEqual(used, ["navigate-xyne-spaces"]);
    assert.match((await run("load_skill", { skill: "nope" })).text, /Available: bad-value, navigate-xyne-spaces\./);

    const ok = await run("propose_skill_update", { skillId: "BAD-VALUE", reason: "  Learned:   check the port first ", after: " 1. Check the port.\n2. Follow the value. " });
    assert.deepEqual(ok, { text: "Suggested.", isError: false });
    assert.deepEqual(proposed, [{ skillId: "bad-value", reason: "Learned: check the port first", after: "1. Check the port.\n2. Follow the value." }]);
    assert.equal((await run("propose_skill_update", { skillId: "bad-value", reason: "x", after: "1. Follow the value." })).isError, true); // no change
    assert.equal((await run("propose_skill_update", { skillId: "nope", reason: "x", after: "y" })).isError, true);
    assert.equal((await run("propose_skill_update", { skillId: "bad-value", reason: "x".repeat(201), after: "y" })).isError, true);
    assert.equal(proposed.length, 1);
  } finally {
    await c.close();
    await s2.close();
  }
  // Without a skills host it says so instead of failing silently.
  assert.match((await call("propose_skill_update", { skillId: "bad-value", reason: "x", after: "y" })).text, /aren't available/);
});

test("parseSkill reads name and when from the front matter", () => {
  assert.deepEqual(parseSkill("cache", "---\r\nname: Cache\r\nwhen: Stale data\r\n---\r\nBody"), { id: "cache", name: "Cache", when: "Stale data", body: "Body" });
  assert.equal(parseSkill("x", "---\nname: X\n---\nno when"), null);
});

test("propose_patch rejected with diff comments asks for a revision", async () => {
  patchDecision = "rejected";
  feedback = "server/todos.controller.ts:18: keep the Number() cast";
  const files = [{ path: "server/todos.controller.ts", edits: [{ oldText: "a", newText: "b" }] }];
  const r = await call("propose_patch", { files, rationale: "x" });
  assert.match(r.text, /rejected by the user with comments on the diff:\n<comments>\nserver\/todos\.controller\.ts:18: keep the Number\(\) cast\n<\/comments>\n.*revised/);
  feedback = undefined;
});

test("watched-by: external clients' reads are reported with their name, Shrike's own are not", async () => {
  calls.watches.length = 0;
  await call("get_action", { actionId: ROOT_ID });
  assert.deepEqual(calls.watches, []); // the default test client is internal

  const ext = await connect("Cursor", false);
  try {
    const read = async (name: string, args: Record<string, unknown>) => ext.callTool({ name, arguments: args });
    await read("list_actions", { status: "error" });
    await read("get_action", { actionId: AFTER_ID });
    await read("get_event", { eventId: ROOT_ID.slice(0, 12) + "dddd" });
    await read("compare_actions", { beforeId: ROOT_ID, afterId: AFTER_ID });
    await read("get_action", { actionId: "nope" });
    await read("list_routes", {});
    assert.deepEqual(calls.watches, [["Cursor", [ROOT_ID]], ["Cursor", [AFTER_ID]], ["Cursor", [ROOT_ID]], ["Cursor", [ROOT_ID, AFTER_ID]]]);
  } finally {
    await ext.close();
  }
});

test("self_review (RL5): no results returns the checklist, results go to the host redacted", async () => {
  const got: unknown[] = [];
  const s = await startMcpServer({ ...host, selfReview: async (r) => (got.push(r), r ? "Saved." : "Review lessons for acme/todo-app: …") }, { skillsDir: path.join(root, "skills") });
  const c = new Client({ name: "rl", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(s.url), { requestInit: { headers: { Authorization: `Bearer ${s.token}`, [INTERNAL_HEADER]: "1" } } }));
  const text = async (args: Record<string, unknown>) => ((await c.callTool({ name: "self_review", arguments: args })).content as { text: string }[])[0]!.text;
  assert.match(await text({}), /^Review lessons for acme\/todo-app/);
  assert.equal(await text({ results: [{ lesson: "missing-loading-state", found: true, fixed: true, where: "web/a.tsx:4 key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" }] }), "Saved.");
  assert.equal(got[0], undefined);
  const r = (got[1] as { lesson: string; where: string }[])[0]!;
  assert.equal(r.lesson, "missing-loading-state");
  assert.doesNotMatch(r.where, /abcdefghijklmnopqrstuvwxyz/);
  await c.close();
  await s.close();
});

test("an outside client's patch names it; Shrike's own says Shrike agent", async () => {
  patchDecision = "applied";
  const ext = await connect("Cursor", false);
  try {
    await ext.callTool({ name: "propose_patch", arguments: { files: [{ path: "server/todos.controller.ts", edits: [{ oldText: "a", newText: "b" }] }], rationale: "x" } });
    assert.equal((calls.patches.at(-1) as { from: string }).from, "Cursor");
  } finally {
    await ext.close();
  }
});

test("a saved port and token are reused; a taken port falls back; rotating cuts the old token", async () => {
  const first = await startMcpServer(host);
  const port = Number(new URL(first.url).port);
  const token = first.token;
  await first.close();

  const again = await startMcpServer(host, { port, token });
  assert.equal(again.url, `http://127.0.0.1:${port}/mcp`);
  assert.equal(again.token, token);
  const taken = await startMcpServer(host, { port, token });
  assert.notEqual(taken.url, again.url, "the port is in use, so a random one");
  assert.equal(taken.movedFrom, port, "and it says so");
  assert.equal(again.movedFrom, undefined);
  assert.equal(taken.token, token);
  await taken.close();
  await again.close();

  const seen: string[] = [];
  const live = await startMcpServer(host, { token, onClient: (n) => seen.push(n) });
  const c = new Client({ name: "claude-code", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(live.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  await c.listTools();
  assert.ok(seen.length >= 2 && seen.every((n) => n === "claude-code"), seen.join());
  // A Shrike agent run in flight uses the internal token: a token reset must not cut it off.
  const run = new Client({ name: "run", version: "0" });
  await run.connect(new StreamableHTTPClientTransport(new URL(live.url), { requestInit: { headers: { Authorization: `Bearer ${live.internalToken}`, [INTERNAL_HEADER]: "1" } } }));

  const fresh = await live.rotateToken();
  assert.ok((await run.listTools()).tools.length > 0, "the live run keeps working");
  await assert.rejects(c.listTools(), "the outside client is cut off");
  assert.notEqual(live.internalToken, fresh);
  assert.notEqual(fresh, token);
  assert.equal(live.token, fresh);
  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } } };
  const post = (t: string) => fetch(live.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${t}` }, body: JSON.stringify(init) });
  assert.equal((await post(token)).status, 401);
  assert.equal((await post(fresh)).status, 200);
  await c.close().catch(() => {});
  await run.close();
  await live.close();
});
