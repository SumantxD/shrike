import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ActionView, Flow, ProjectInfo, ShrikeDriver, ShrikeHost } from "@shrike/schema";
import { INTERNAL_HEADER, startMcpServer } from "../src/index.ts";

const DRIVE = ["open_project", "run_app", "stop_app", "list_trips", "focus_trip", "list_flows", "record_flow", "run_flow", "open_file", "ask_agent"];

test("B5: outside clients can drive Shrike; Shrike's own brain never sees these tools", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shrike-drive-"));
  await fs.writeFile(path.join(root, "app.ts"), "x");
  const did: string[] = [];
  const flows: Flow[] = [{ id: "add-a-todo", name: "Add a todo", steps: [{ type: "click", name: "Add Todo" }], lastRun: { at: 1, ok: false, actionIds: ["t1"] } }];
  const trip = { id: "t1", label: 'Clicked "Add Todo"', status: "error", durationMs: 12, startMs: 5, summary: { steps: [{ ok: true, text: "POST /api/todos", eventId: "e1" }, { ok: false, text: "createTodo threw", eventId: "e2", source: { file: "server/todos.controller.ts", line: 18, precision: "exact" } }] } } as unknown as ActionView;
  const trip2 = { id: "t2", label: "Opened the settings page", status: "ok", durationMs: 3, startMs: 9, summary: { steps: [] } } as unknown as ActionView;
  const drive: ShrikeDriver = {
    openProject: async (r) => (did.push(`open ${r}`), { root: r, name: "todo-app", frontend: "vite-react", backend: "express", routes: [{ method: "GET", path: "/" }] } as ProjectInfo),
    run: async () => (did.push("run"), { state: "running", url: "http://localhost:5173" }),
    stop: async () => (did.push("stop"), { state: "stopped" }),
    focusTrip: (id) => void did.push(`focus ${id}`),
    openFile: (p, line) => void did.push(`file ${p}:${line}`),
    listFlows: async () => flows,
    startFlowRecording: async () => void did.push("record"),
    stopFlowRecording: async (name) => (did.push(`save ${name}`), { id: "checkout", name, steps: [{ type: "click", name: "Pay" }] }),
    runFlow: async (id) => (did.push(`replay ${id}`), { ok: true, actionIds: ["t2", "t3"] }),
    askAgent: async (goal) => (did.push(`ask ${goal}`), { runId: "r1", status: "done", summary: "userId was undefined." }),
  };
  const host = { projectRoot: () => root, listActions: () => [trip, trip2], getAction: (id: string) => (id === "t1" ? trip : id === "t2" ? trip2 : undefined), drive } as unknown as ShrikeHost;
  const server = await startMcpServer(host);
  const connect = async (internal: boolean) => {
    const c = new Client({ name: internal ? "shrike" : "Claude Code", version: "0" });
    const headers: Record<string, string> = { Authorization: `Bearer ${server.token}`, ...(internal ? { [INTERNAL_HEADER]: "1" } : {}) };
    await c.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }));
    return c;
  };
  const inside = await connect(true);
  const outside = await connect(false);
  try {
    const names = async (c: Client) => (await c.listTools()).tools.map((t) => t.name);
    assert.deepEqual((await names(inside)).filter((n) => DRIVE.includes(n)), [], "never offered to the in-app brain");
    assert.deepEqual((await names(outside)).filter((n) => DRIVE.includes(n)).sort(), [...DRIVE].sort());

    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await outside.callTool({ name, arguments: args });
      return { text: (r.content as { text: string }[]).map((c) => c.text).join("\n"), isError: r.isError === true };
    };
    assert.match((await call("open_project", { path: root })).text, /Opened todo-app .*vite-react.*1 routes/);
    assert.equal((await call("open_project", { path: "relative/dir" })).isError, true);
    assert.match((await call("run_app")).text, /running at http:\/\/localhost:5173/);
    assert.match((await call("list_trips")).text, /^t2 {2}Opened the settings page {2}worked {2}3ms\nt1 {2}Clicked "Add Todo" {2}broke {2}12ms {2}at server\/todos\.controller\.ts:18$/);
    assert.match((await call("list_trips", { status: "worked" })).text, /^t2 {2}Opened the settings page {2}worked {2}3ms$/);
    assert.match((await call("list_trips", { match: "add todo" })).text, /^t1 {2}Clicked "Add Todo" {2}broke {2}12ms {2}at server\/todos\.controller\.ts:18$/);
    assert.match((await call("list_trips", { status: "slow" })).text, /^No slow trips\.$/);
    assert.match((await call("list_trips", { status: "broke", match: "/api/todos" })).text, /^No broken trips match \/api\/todos\.$/);
    assert.equal((await call("list_trips", { status: "nope" })).isError, true, "unknown status is refused by zod");
    assert.equal((await call("list_trips", { match: "x".repeat(201) })).isError, true, "match over 200 chars is refused by zod");
    assert.match((await call("focus_trip", { tripId: "t1" })).text, /Showing/);
    assert.equal((await call("focus_trip", { tripId: "nope" })).isError, true);
    assert.match((await call("list_flows")).text, /add-a-todo {2}"Add a todo" {2}1 steps {2}last run failed/);
    assert.match((await call("record_flow", { action: "start" })).text, /Recording/);
    assert.match((await call("record_flow", { action: "stop", name: "Checkout" })).text, /Saved checkout/);
    assert.match((await call("run_flow", { flow: "add a todo" })).text, /^Flow "Add a todo" passed\. Trips: t2, t3$/);
    assert.match((await call("run_flow", { flow: "missing" })).text, /Saved flows: add-a-todo/);
    assert.match((await call("open_file", { path: "app.ts", line: 3 })).text, /app\.ts:3/);
    assert.equal((await call("open_file", { path: "../../etc/passwd" })).isError, true);
    assert.match((await call("ask_agent", { goal: "why did it break?" })).text, /r1 done\.\nuserId was undefined/);
    assert.match((await call("stop_app")).text, /stopped/);
    assert.deepEqual(did, [`open ${root}`, "run", "focus t1", "record", "save Checkout", "replay add-a-todo", "file app.ts:3", "ask why did it break?", "stop"]);
  } finally {
    await inside.close();
    await outside.close();
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("#53: a live site is read-only, with one card per path or scenario, and personal data masked", async () => {
  let lv = ["https://demo.example.com"];
  const asked: { title: string; reason: string }[] = [];
  const did: string[] = [];
  const host = {
    projectRoot: () => os.tmpdir(),
    listActions: () => [],
    liveOrigins: () => lv,
    requestApproval: async (r: { title: string; reason: string }) => (asked.push(r), true),
    sendRequest: async (s: { method: string; url: string }) => (did.push(`${s.method} ${s.url}`), { response: { status: 200, statusText: "OK", headers: {}, body: "ok", durationMs: 1 }, actionId: "" }),
    appSnapshot: async () => ({ url: "https://demo.example.com/orders", title: "Orders", elements: [{ ref: "e1", role: "button", name: "Delete" }, { ref: "e2", role: "textbox", name: "Note" }], text: "Ordered by ada@example.com, call +44 20 7946 0958" }),
    appClick: async (ref: string) => (did.push(`click ${ref}`), { actionId: null }),
    appType: async (ref: string) => (did.push(`type ${ref}`), { actionId: null }),
    appNavigate: async (url: string) => (did.push(`open ${url}`), { actionId: null }),
  } as unknown as ShrikeHost;
  const server = await startMcpServer(host);
  const c = new Client({ name: "shrike", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { Authorization: `Bearer ${server.token}`, [INTERNAL_HEADER]: "1" } } }));
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await c.callTool({ name, arguments: args });
    return { text: (r.content as { text: string }[]).map((x) => x.text).join("\n"), isError: r.isError === true };
  };
  try {
    assert.equal((await call("send_request", { method: "GET", url: "https://demo.example.com/api/x" })).isError, false);
    await call("send_request", { method: "GET", url: "https://demo.example.com/api/x?page=2" });
    assert.equal(asked.length, 1, "a GET asks once per path");
    const post = await call("send_request", { method: "POST", url: "https://demo.example.com/api/x", body: "{}" });
    assert.equal(post.isError, true);
    assert.match(post.text, /This is your live site\. Shrike won't change live data/);
    assert.equal(asked.length, 1, "a data-changing request is refused with no card");
    await call("send_request", { method: "GET", url: "/api/y" });
    assert.equal(did.at(-1), "GET https://demo.example.com/api/y", "a relative path goes to the live origin");
    assert.equal((await call("send_request", { method: "GET", url: "https://www.demo.example.com/" })).isError, true, "www. is a different origin unless listed");

    asked.length = 0;
    await call("app_navigate", { url: "/settings" });
    assert.equal(asked.length, 0, "same-origin pages open without asking");
    await call("app_navigate", { url: "/logout" });
    await call("app_navigate", { url: "/logout" });
    assert.equal(asked.length, 1, "a state-looking path asks once");
    assert.equal((await call("app_navigate", { url: "https://evil.example/" })).isError, true);

    asked.length = 0;
    await call("app_click", { name: "Delete" });
    assert.match(asked[0]!.title, /Click .*Delete.* on your live site\?/);
    asked.length = 0;
    const steps = [{ action: "click", name: "Delete" }, { action: "type", name: "Note", text: "hi" }, { action: "navigate", url: "/settings" }, { action: "wait", ms: 1 }];
    assert.match((await call("run_scenario", { steps })).text, /PASS/);
    assert.equal(asked.length, 1, "one card for the whole scenario");
    assert.equal(asked[0]!.reason.split("\n").length, 4, "listing every step");
    host.requestApproval = async () => false;
    assert.match((await call("run_scenario", { steps })).text, /declined this scenario/);

    assert.match((await call("app_snapshot")).text, /Ordered by \[email#1\], call \[phone#1\]/, "#51: phone numbers too");
    lv = [];
    assert.match((await call("app_snapshot")).text, /Ordered by ada@example\.com/, "a local project shows the real address");
  } finally {
    await c.close();
    await server.close();
  }
});

test("#52: live trips reach the agent with values masked; local trips keep theirs", async () => {
  const ev = (id: string) => ({ id, traceId: "t".repeat(32), origin: "browser", kind: "http_request", name: "GET /rest/v1/orders", startMs: 1, status: "ok", http: { method: "GET", url: "/rest/v1/orders", resBody: '[{"id":7,"name":"Ada Lovelace","plan":"Team plan","status":"pending"}]' }, ...(id === "live" ? { live: true } : {}) });
  const host = {
    projectRoot: () => os.tmpdir(),
    listActions: () => [],
    getEvent: ev,
    liveOrigins: () => ["https://demo.example.com"],
    redactKeep: () => ["plan"],
    requestApproval: async () => true,
    sendRequest: async () => ({ response: { status: 200, statusText: "OK", headers: {}, body: '{"name":"Grace Hopper","status":"paid"}', durationMs: 1 }, actionId: "" }),
  } as unknown as ShrikeHost;
  const server = await startMcpServer(host);
  const c = new Client({ name: "shrike", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { Authorization: `Bearer ${server.token}`, [INTERNAL_HEADER]: "1" } } }));
  const call = async (name: string, args: Record<string, unknown>) => ((await c.callTool({ name, arguments: args })).content as { text: string }[]).map((x) => x.text).join("\n");
  try {
    const live = await call("get_event", { eventId: "live" });
    assert.doesNotMatch(live, /Ada/);
    assert.match(live, /\[text#1\].*Team plan.*pending/);
    assert.match(await call("get_event", { eventId: "local" }), /Ada Lovelace/, "a local trip in the same project keeps its values");
    assert.match(await call("send_request", { method: "GET", url: "/api/me" }), /"name":"\[text#2\]","status":"paid"/);
  } finally {
    await c.close();
    await server.close();
  }
});
