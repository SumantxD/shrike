import { test } from "node:test";
import assert from "node:assert/strict";
import type { DebugEvent } from "@shrike/schema";
import { blockEnd, codeRange, codeTarget, inlineChips, isGuess, offsets, plannedLanes, resendDiff, resendOrder, resendSpec, testStep, tripText, visibleRange } from "./logic.ts";
import type { ActionView } from "@shrike/schema";
import { buildTrip, lanesFor } from "../lib/thread-layout.ts";
import { ordersLoad, payNow } from "./fixtures.ts";

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
