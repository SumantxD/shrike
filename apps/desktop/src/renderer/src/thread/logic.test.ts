import { test } from "node:test";
import assert from "node:assert/strict";
import type { DebugEvent } from "@shrike/schema";
import { blockEnd, codeRange, codeTarget, inlineChips, isGuess, offsets, plannedLanes, resendDiff, resendOrder, resendSpec, testStep, tripText, visibleRange } from "./logic.ts";
import * as curl from "./logic.ts"; // the Copy as cURL exports, read off the namespace so a missing one fails its own test, not the whole file
import type { ActionView } from "@shrike/schema";
import { buildTrip, lanesFor } from "../lib/thread-layout.ts";
import { curlSignup, ordersLoad, payNow } from "./fixtures.ts";

const ev = (p: Partial<DebugEvent>): DebugEvent => ({ id: "e", traceId: "t", origin: "server", kind: "function", name: "f()", startMs: 0, status: "ok", ...p });
const at = (file: string, line: number) => ({ file, line, precision: "exact" as const });

const controller = [
  'import type { Request, Response } from "express";',
  "",
  "export async function createTodo(req: Request, res: Response) {",
  "  const { title } = req.body;",
  '  console.log("creating todo", { title });',
  '  if (!title) return res.status(400).json({ error: "Title is required" });',
  "  const todo = insertTodo({ title, userId: req.body.user });",
  "  res.status(201).json(withOwner(todo));",
  "}",
  "",
  "export function other() {}",
];

test("a failing call dives into its caller at the call site, with the bad args and the log inline", () => {
  const createTodo = ev({ name: "createTodo()", source: at("server/c.ts", 3), args: ["req { POST }", "res"] });
  const insertTodo = ev({ name: "insertTodo()", status: "error", source: at("server/db.ts", 33), callSite: at("server/c.ts", 7), args: ["{ title: 'buy milk', userId: undefined }"], error: { message: "NOT NULL" } });
  const log = ev({ kind: "log", log: { level: "info", message: "creating todo { title: 'buy milk' }" }, source: at("server/c.ts", 5) });
  const t = codeTarget(insertTodo, createTodo)!;
  assert.deepEqual(t, { file: "server/c.ts", live: 7, def: 3, error: true });
  assert.deepEqual(codeRange(controller, t), { start: 3, end: 9 });
  const chips = inlineChips([createTodo, log, insertTodo], insertTodo, "server/c.ts", 3, 9);
  assert.deepEqual(chips.get(7), [{ text: "insertTodo({ title: 'buy milk', userId: undefined })", error: true }]);
  assert.equal(chips.get(5)?.[0]?.text, "creating todo { title: 'buy milk' }");
});

test("braces in strings don't end the block; other stations get ±4 lines", () => {
  assert.equal(blockEnd(['function a() {', '  const s = "}";', "  return s;", "}"], 1), 4);
  assert.equal(blockEnd(["export function one() { return 1; }"], 1), 1);
  const q = ev({ kind: "db_query", status: "error", source: at("server/db.ts", 20), error: { message: "NOT NULL constraint failed" } });
  const t = codeTarget(q)!;
  assert.deepEqual(codeRange(new Array(40).fill(""), t), { start: 16, end: 24 });
  assert.deepEqual(inlineChips([q], q, "server/db.ts", 16, 24).get(20), [{ text: "✕ NOT NULL constraint failed", error: true }]);
  assert.equal(codeTarget(ev({ kind: "http_request" })), null);
});

test("windowing finds the blocks on screen", () => {
  const tops = offsets([100, 100, 100, 100, 100]);
  assert.equal(tops[5], 500);
  assert.deepEqual(visibleRange(tops, 150, 100, 0), [1, 2]);
  assert.deepEqual(visibleRange(tops, 0, 1000, 1), [0, 4]);
  assert.deepEqual(visibleRange([0], 0, 100), [0, -1]);
});

test("lanes-from-plan: a planned page lane reads DASHBOARD :5173, not PAGE; guessed ghost lanes are marked, the caller never", () => {
  const expected = [{ id: "client:http://localhost:5173", kind: "client" as const, name: "DASHBOARD", detail: "localhost:5173" }, { id: "service:backend", kind: "service" as const, name: "BACKEND", detail: "localhost:3001" }];
  const defs = lanesFor([], expected);
  assert.equal(defs[0]!.label, "PAGE");
  const planned = plannedLanes(defs, expected, false);
  assert.deepEqual([planned[0]!.label, planned[0]!.detail], ["DASHBOARD", "localhost:5173"]);
  assert.equal(planned[1], defs[1]);
  assert.equal(plannedLanes(defs, expected, true), defs);
  assert.equal(isGuess({ ghost: true, kind: "service" }, true), true);
  assert.equal(isGuess({ ghost: true, kind: "caller" }, true), false);
  assert.equal(isGuess({ ghost: true, kind: "service" }, false), false);
  assert.equal(isGuess({ ghost: false, kind: "service" }, true), false);
});

test("AP: edit and resend takes the page's own write, compare says what changed, save as test pins the status", () => {
  const trip = (id: string, status: "ok" | "error", body: string, code: number, origin: DebugEvent["origin"] = "browser") =>
    ({
      id, status, label: id,
      root: ev({ id, kind: "user_action", origin, ...(origin === "explorer" ? { caller: { kind: "explorer" as const, label: "Create todo" } } : {}) }),
      tree: [
        { event: ev({ id: `${id}p`, origin, kind: "http_request", startMs: 1, http: { method: "POST", url: "/api/todos", status: code, reqHeaders: { "Content-Type": "application/json", traceparent: "00-a-b-01", authorization: "[redacted:authorization]" }, reqBody: body } }), children: [
          { event: ev({ id: `${id}s`, origin: "server", kind: "http_request", startMs: 2, http: { method: "POST", url: "/api/todos", status: code, reqHeaders: { host: "x" } } }), children: [] },
        ] },
        { event: ev({ id: `${id}g`, origin, kind: "http_request", startMs: 3, http: { method: "GET", url: "/api/todos", status: 200 } }), children: [] },
      ],
    }) as unknown as ActionView;
  const broke = trip("a", "error", '{"title":"buy milk","userId":1}', 500);
  assert.deepEqual(resendSpec(broke), { method: "POST", url: "http://x/api/todos", headers: { "Content-Type": "application/json", authorization: "[redacted:authorization]" }, body: '{"title":"buy milk","userId":1}' });
  assert.deepEqual(resendSpec(broke, 3), { method: "GET", url: "http://x/api/todos" }, "a station picks its own request; a page fetch gets the host the server saw");
  const curl = { id: "c", status: "ok", label: "c", root: ev({ id: "c", kind: "user_action", origin: "server" }), tree: [{ event: ev({ id: "cs", origin: "server", kind: "http_request", http: { method: "GET", url: "/api/todos?x=1", status: 200, reqHeaders: { Host: "localhost:3001" } } }), children: [] }] } as unknown as ActionView;
  assert.equal(resendSpec(curl)?.url, "http://localhost:3001/api/todos?x=1", "a curl trip's server-side request gets its host back");
  const fixed = trip("b", "ok", '{"title":"buy milk","user":1}', 201, "explorer");
  assert.deepEqual(resendDiff(broke, fixed), ["body.userId: 1 → missing", "body.user: missing → 1", "Answered 500, now 201.", "It works now."]);
  assert.deepEqual(testStep(fixed)?.assert, [{ expr: "res.status", op: "eq", value: "201", enabled: true }]);
  assert.equal(testStep(fixed)?.request?.name, "Create todo");
  assert.deepEqual(resendOrder(["a", "x", "b", "c"], (id) => ({ b: "a", c: "a" })[id]), ["a", "b", "c", "x"]);
  assert.deepEqual(resendOrder(["a", "b"], (id) => ({ a: "b", b: "a" })[id]), ["a", "b"], "a forged loop still shows every trip");
});

test("Copy as cURL: the API client's quoting, a ' in the body, hidden values copied as their placeholder, GET has no -X", () => {
  const post = { method: "POST", url: "http://x/api/todos", headers: { "Content-Type": "application/json", authorization: "[redacted:authorization]" }, body: `{"title":"it's"}` };
  assert.equal(curl.curlOf(post), "curl -X POST http://x/api/todos \\\n  -H 'Content-Type: application/json' \\\n  -H 'authorization: [redacted:authorization]' \\\n  --data-raw '{\"title\":\"it'\\''s\"}'");
  assert.equal(curl.curlOf({ method: "GET", url: "http://x/api/todos" }), "curl http://x/api/todos");
});

test("Copy as cURL: a live trip is masked before it is copied, and only an HTTP station shows the button", () => {
  const base = curlSignup(0);
  const node = base.tree[0]!;
  const http = node.event;
  const live: ActionView = { ...base, root: { ...base.root, live: true }, tree: [{ ...node, event: { ...http, http: { ...http.http!, reqBody: `{"email":"maya@example.com"}` } } }, ...base.tree.slice(1)] };
  const text = curl.curlText(live) ?? "";
  assert.match(text, /\[\w+#\d+\]/, "a live trip's body is masked before it is copied");
  assert.ok(!text.includes("maya@example.com"), "the real value never reaches the clipboard");
  assert.equal(curl.curlText(base), curl.curlOf(resendSpec(base)!), "a trip that is not live copies as recorded");
  assert.equal(curl.curlText({ ...base, tree: [] }), undefined, "a trip with no request has nothing to copy");
  assert.equal(curl.hasRequest(http), true);
  assert.equal(curl.hasRequest(node.children?.[0]?.event), false, "a function station shows no Copy as cURL");
  assert.equal(curl.hasRequest(undefined), false);
});

test("Copy as cURL: each outcome has its own toast, and the clipboard is written only when there is a request", async () => {
  const base = curlSignup(0);
  const written: string[] = [];
  const ok = await curl.copyAsCurl(base, 0, undefined, async (t) => void written.push(t));
  assert.deepEqual(ok, { ok: true, message: "Copied the request as cURL." });
  assert.equal(written[0], curl.curlOf(resendSpec(base, 0)!), "the clipboard gets the curl text");

  const none = await curl.copyAsCurl({ ...base, tree: [] }, undefined, undefined, async (t) => void written.push(t));
  assert.deepEqual(none, { ok: false, message: "This step has no request to copy." });

  const denied = await curl.copyAsCurl(base, 0, undefined, async () => {
    throw new Error("NotAllowedError");
  });
  assert.deepEqual(denied, { ok: false, message: "Couldn't copy to the clipboard." });

  // a view that cannot be read at all (null) throws inside curlText, which must not reach the clipboard
  let wrote = false;
  const unread = await curl.copyAsCurl(null as unknown as ActionView, 0, undefined, async () => void (wrote = true));
  assert.deepEqual(unread, { ok: false, message: "Couldn't read this request." });
  assert.equal(wrote, false, "an unreadable request never reaches the clipboard");
  assert.equal(written.length, 1, "only the copy with a request wrote to the clipboard");
});

test("tripText: a trip as a few plain lines, with the break marked (#82)", () => {
  const trip = buildTrip(payNow(1_700_000_000_000));
  const lines = tripText(trip).split("\n");
  assert.equal(lines[0], `Clicked "Pay now": BROKE (${trip.ms}ms)`);
  assert.equal(lines[1], trip.returned);
  assert.equal(lines.length - 2, trip.stations.length, "one numbered line per station");
  assert.ok(lines.every((l, i) => i < 2 || /^\d+\. /.test(l)));
  const broken = lines.findIndex((l) => l.includes("<- broke here"));
  assert.ok(broken > 1, "exactly one station is marked as the break");
  assert.equal(lines.filter((l) => l.includes("<- broke here")).length, 1);
  assert.match(lines[broken]!, /^13\. createCharge\(\)/, "the station that got the bad value is marked");
  assert.ok(lines[broken]!.includes("{ amount: 30, currency: 'usd' }"), "the value chip rides along");
  assert.ok(!tripText(buildTrip(ordersLoad(1_700_000_000_000, true))).includes("<- broke here"), "a trip that worked marks no break");
});
