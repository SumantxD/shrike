import { test } from "node:test";
import assert from "node:assert/strict";
import type { ActionView, DebugEvent, TimelineNode } from "@shrike/schema";
import { buildTrip } from "../lib/thread-layout.ts";
import {
  agentSection, failingLocation, fileChip, fuzzyScore, goalWithContext, issueMarkdown, issueTitle, linearVariant, logChip, matchStation, parseInline, parseMarkdown,
  chosenFinding, parseSlash, pickChip, pointQuestion, previousSameLabel, probeCap, rankFindings, sameAction, rankQuick, resolveKey, sentence, sharpen, shortTitle, slashMatches, stationChip,
} from "./logic.ts";

let n = 0;
const ev = (p: Partial<DebugEvent>): DebugEvent => ({ id: (++n).toString(16).padStart(16, "0"), traceId: "t".repeat(32), origin: "server", kind: "function", name: "f()", startMs: n, status: "ok", ...p });
const node = (event: DebugEvent, children: TimelineNode[] = []): TimelineNode => ({ event, children });
const src = (file: string, line: number) => ({ file, line, precision: "exact" as const });

const root = ev({ kind: "user_action", origin: "browser", name: 'Clicked "Add Todo"', trigger: "click", source: src("src/TodoForm.tsx", 31) });
const insert = ev({ startMs: 60, kind: "db_query", origin: "db", name: "INSERT", db: { system: "sqlite", statement: "INSERT INTO todos" }, status: "error", error: { message: "NOT NULL" }, source: src("server/db.ts", 19) });
const insertTodo = ev({ startMs: 50, name: "insertTodo()", status: "error", args: ["{ userId: undefined }"], source: src("server/db.ts", 17), callSite: src("server/todos.controller.ts", 18) });
const createTodo = ev({ startMs: 30, name: "createTodo()", status: "error", source: src("server/todos.controller.ts", 14) });
const req = ev({ startMs: 10, kind: "http_request", origin: "browser", name: "POST /api/todos", http: { method: "POST", url: "/api/todos", status: 500 }, status: "error", source: src("src/api.ts", 12) });
const view: ActionView = {
  id: root.id, traceId: root.traceId, trigger: "click", label: root.name, startMs: 0, durationMs: 48, status: "error", complete: true,
  tree: [node(req, [node(createTodo, [node(insertTodo, [node(insert)])])])], root,
  summary: { headline: "", steps: [], stats: { files: 0, functions: 0, requests: 0, queries: 0, logs: 0, errors: 0, totalMs: 48 } }, flags: [],
};
const trip = buildTrip(view);
const idx = (label: string) => trip.stations.findIndex((s) => s.label === label);

test("findings land on the right station: call line, then definition, then event id", () => {
  assert.equal(matchStation(trip, view, { confidence: "observed", claim: "", file: "server/todos.controller.ts", line: 18 }), idx("insertTodo()"));
  assert.equal(matchStation(trip, view, { confidence: "likely", claim: "", file: "/abs/server/db.ts", line: 19 }), idx("INSERT INTO todos"));
  assert.equal(matchStation(trip, view, { confidence: "likely", claim: "", eventId: createTodo.id }), idx("createTodo()"));
  assert.equal(matchStation(trip, view, { confidence: "possible", claim: "", file: "src/Other.tsx", line: 3 }), -1);
});

test("a finding on createTodo's own line sharpens to the insertTodo call that got userId: undefined", () => {
  const f = { confidence: "observed" as const, claim: "", file: "server/todos.controller.ts", line: 14 };
  assert.equal(sharpen(trip, view, matchStation(trip, view, f), f), idx("insertTodo()"));
  const byId = { confidence: "observed" as const, claim: "", eventId: createTodo.id };
  assert.equal(sharpen(trip, view, matchStation(trip, view, byId), byId), idx("insertTodo()"));
  const db = { confidence: "likely" as const, claim: "", file: "server/db.ts", line: 19 };
  assert.equal(sharpen(trip, view, idx("INSERT INTO todos"), db), idx("INSERT INTO todos"));
});

test("ranking prefers findings on the thread, then confidence", () => {
  const off = { confidence: "observed" as const, claim: "off", file: "x.ts", line: 1 };
  const on = { confidence: "likely" as const, claim: "on", file: "server/db.ts", line: 19 };
  assert.equal(rankFindings([off, on], trip, view)[0]!.claim, "on");
});

test("FOUND IT keeps the finding the walk landed on after the probe is gone (a branch run, Not now)", () => {
  const off = { confidence: "observed" as const, claim: "off", file: "x.ts", line: 1 };
  const on = { confidence: "likely" as const, claim: "on", file: "server/db.ts", line: 19 };
  const step = { id: "s1", runId: "r", kind: "findings", text: "", at: 0, findings: [off, on] } as unknown as Parameters<typeof chosenFinding>[0];
  const landed = chosenFinding(step, {}, trip, view)!;
  assert.equal(landed.claim, "on");
  assert.equal(chosenFinding(step, {}, undefined, undefined)!.claim, "off", "without the trip the ranking alone would swap it");
  assert.equal(chosenFinding(step, { s1: landed }, undefined, undefined)!.claim, "on");
});

test("probe stops before the snap", () => {
  assert.equal(probeCap(trip), idx("INSERT INTO todos") - 1);
});

test("keys: never fire while typing, Enter views a new trip when offered", () => {
  const k = (key: string, o: Partial<{ meta: boolean; typing: boolean }> = {}) => resolveKey({ key, meta: false, ctrl: false, alt: false, typing: false, ...o }, { newTrip: false, approval: true });
  assert.equal(k("t", { typing: true }), null);
  assert.equal(k("Escape", { typing: true }), "escape");
  assert.equal(k("Enter", { meta: true, typing: true }), "apply");
  assert.equal(k("!"), "next-failure");
  assert.equal(k("`"), "terminal");
  assert.equal(k("f"), "trip-list");
  assert.equal(k("F"), "trip-list");
  assert.equal(k("f", { typing: true }), null);
  assert.equal(resolveKey({ key: "Enter", meta: false, ctrl: false, alt: false, typing: false }, { newTrip: true, approval: false }), "view-new-trip");
});

test("captions: first sentence by default, whole summary when asked, no markdown", () => {
  assert.equal(sentence("**Fixed** and verified. Adding a todo works."), "Fixed and verified.");
  assert.equal(sentence("Fixed and verified.\n Adding a `todo` works.", 140, true), "Fixed and verified. Adding a todo works.");
});

test("keys: X points, ⌘P quick-opens even while typing, plain P still toggles the app", () => {
  const k = (key: string, o: Partial<{ meta: boolean; typing: boolean }> = {}) => resolveKey({ key, meta: false, ctrl: false, alt: false, typing: false, ...o }, { newTrip: false, approval: false });
  assert.equal(k("x"), "point");
  assert.equal(k("x", { typing: true }), null);
  assert.equal(k("p", { meta: true, typing: true }), "quick-open");
  assert.equal(k("p"), "app");
});

test("slash palette: filters by prefix, closes on a space, parses known commands only", () => {
  assert.equal(slashMatches("hello"), null);
  assert.equal(slashMatches("/")?.length, 9);
  assert.deepEqual(slashMatches("/re")?.map((c) => c.id), ["replay", "record"]);
  assert.deepEqual(slashMatches("/zzz"), []);
  assert.equal(slashMatches("/fix the form"), null);
  assert.deepEqual(parseSlash("/fix the form"), { id: "fix", rest: "the form", entry: { id: "fix", hint: "Ask the agent to fix this trip" } });
  assert.equal(parseSlash(" /Issue ")?.rest, "");
  assert.equal(parseSlash("/nope"), null);
  assert.equal(parseSlash("why /fix"), null);
});

test("fuzzy: file names and word starts beat scattered letters, max 8, misses drop out", () => {
  assert.equal(fuzzyScore("xyz", "server/db.ts"), null);
  const items = ["src/components/ControllerPanel.tsx", "server/todos.controller.ts", "server/db.ts", "docs/contributing.md"].map((label) => ({ label }));
  assert.equal(rankQuick("todcon", items)[0]!.label, "server/todos.controller.ts");
  assert.equal(rankQuick("db", items)[0]!.label, "server/db.ts");
  assert.equal(rankQuick("controller", items)[0]!.label, "server/todos.controller.ts");
  const log = { label: "Download the React DevTools for a better development experience", exact: true };
  assert.deepEqual(rankQuick("todc", [log]), [], "a log line needs the words as typed");
  assert.equal(rankQuick("react dev", [log]).length, 1);
  const many = Array.from({ length: 20 }, (_, i) => ({ label: `file${i}.ts` }));
  assert.equal(rankQuick("file", many).length, 8);
  assert.equal(rankQuick("", many)[0]!.label, "file0.ts");
});

test("context chips: short label, one plain line for the agent", () => {
  const pick = { selector: "#pay", text: "Pay now", role: "button", rect: { x: 0, y: 0, width: 10, height: 10, viewportWidth: 100, viewportHeight: 100 }, source: src("src/Checkout.tsx", 22) };
  assert.equal(pickChip(pick).label, "Button 'Pay now' · Checkout.tsx:22");
  assert.match(pickChip(pick).line, /^Context: the button "Pay now" I pointed at in my app \(selector #pay\), rendered at src\/Checkout.tsx:22$/);
  assert.equal(pointQuestion(pick, false), "What happens when I click Pay now?");
  assert.equal(pointQuestion(pick, true), "Why doesn't this work?");
  const st = trip.stations[idx("insertTodo()")]!;
  const c = stationChip(st, insertTodo);
  assert.equal(c.line, "Context: insertTodo() at todos.controller.ts:18 with { userId: undefined }");
  assert.equal(c.label, "insertTodo() · todos.controller.ts:18");
  const lg = ev({ kind: "log", name: "creating", log: { level: "info", message: "creating todo { title: 'buy milk' }" }, source: src("server/todos.controller.ts", 16) });
  assert.equal(logChip(lg).line, `Context: the log line "creating todo { title: 'buy milk' }" at todos.controller.ts:16`);
  assert.equal(fileChip("server/db.ts", 19).label, "db.ts:19");
  assert.equal(goalWithContext(" Why? ", [fileChip("server/db.ts")]), "Why?\nContext: the file server/db.ts");
  assert.equal(goalWithContext("", [fileChip("a.ts")]), "Context: the file a.ts");
});

test("compare finds the previous trip with the same label", () => {
  const byId = { a: { ...view, id: "a", label: "x" }, b: { ...view, id: "b", label: "y" }, c: { ...view, id: "c", label: "x" } };
  assert.equal(previousSameLabel(["a", "b", "c"], byId, "c"), "a");
  assert.equal(previousSameLabel(["a", "b", "c"], byId, "a"), undefined);
});

test("the agent's re-run after Apply matches the broken click, even when it records as the form's submit", () => {
  assert.ok(sameAction('Clicked "Add Todo"', 'Submitted "Add Todo"'));
  assert.ok(sameAction('Submitted "Add Todo"', 'Clicked "Add Todo"'));
  assert.ok(sameAction("Submitted form", "Submitted form"));
  assert.ok(!sameAction('Clicked "Add Todo"', 'Clicked "Delete"'));
  assert.ok(!sameAction('Ticked "Done"', 'Clicked "Done"'));
  assert.ok(!sameAction("Clicked button", "Submitted form"));
});

test("issue markdown: title, steps, expected vs actual, excerpt, agent diff; Linear gets a short title", () => {
  const v: ActionView = { ...view, summary: { ...view.summary, headline: 'You clicked "Add Todo". The server returned an error (500).', steps: [
    { ok: true, text: "Your app sent the new todo to the server (POST /api/todos)", eventId: req.id },
    { ok: false, text: "insertTodo() got userId: undefined", eventId: insertTodo.id, source: src("server/todos.controller.ts", 18) },
    { ok: false, text: "The database couldn't save the todo: NOT NULL constraint failed", eventId: insert.id },
  ] } };
  assert.equal(issueTitle(v), `Clicked "Add Todo" fails: The database couldn't save the todo: NOT NULL constraint failed`);
  assert.equal(shortTitle(issueTitle(v)), `Clicked "Add Todo" fails`);
  const defined = { ...v, summary: { ...v.summary, steps: v.summary.steps.map((s) => (s.eventId === insertTodo.id ? { ...s, source: src("server/db.ts", 17) } : s)) } };
  assert.deepEqual(failingLocation(defined), src("server/todos.controller.ts", 18), "a failing call breaks where it was called");
  const patch = { id: "p", status: "applied" as const, rationale: "Read userId.", files: [{ path: "server/todos.controller.ts", before: "a\nuser\nc", after: "a\nuserId\nc" }] };
  const md = issueMarkdown({ view: v, appUrl: "http://localhost:5173/", pagePath: "/", excerpt: { file: "server/todos.controller.ts", line: 18, start: 17, lines: ["x", "y", "z"] }, agent: { summary: "Wrong field.", findings: [{ confidence: "observed", claim: "Reads req.body.user", file: "server/todos.controller.ts", line: 18 }], patch }, clipName: "c.webm" });
  assert.match(md, /^# Clicked "Add Todo" fails: /);
  assert.match(md, /1\. Open http:\/\/localhost:5173\/\n2\. Click "Add Todo"\n3\. The page sends `POST \/api\/todos`/);
  assert.match(md, /## Expected\n\nClick "Add Todo" works without an error\./);
  assert.match(md, /## Actual\n\nThe database couldn't save the todo: NOT NULL constraint failed\./);
  assert.match(md, /```ts\n  17 \| x\n> 18 \| y\n  19 \| z\n```/);
  assert.match(md, /- \(observed\) Reads req.body.user \(`server\/todos.controller.ts:18`\)/);
  assert.match(md, /```diff\n--- a\/server\/todos.controller.ts\n\+\+\+ b\/server\/todos.controller.ts\n a\n-user\n\+userId\n c\n```/);
  assert.match(md, /`c.webm` shows the trip/);
  assert.doesNotMatch(md, /—/);
  assert.match(linearVariant(md), /^# Clicked "Add Todo" fails\n/);
  assert.equal(agentSection({ findings: [] }), "");
  const curl = issueMarkdown({ view: { ...v, trigger: "explorer", root: { ...v.root, origin: "explorer" } }, appUrl: "http://localhost:3001" });
  assert.match(curl, /1\. Run `curl -X POST 'http:\/\/localhost:3001\/api\/todos'`/);
});

test("markdown: blocks and inline marks", () => {
  const b = parseMarkdown("# Title\n\nSome **bold** text\nwraps.\n\n- one\n- two\n\n1. a\n\n```ts\nconst x = 1;\n```\n> quoted\n---\n");
  assert.deepEqual(b.map((x) => x.t), ["h", "p", "ul", "ol", "code", "quote", "hr"]);
  assert.deepEqual(b[1], { t: "p", text: "Some **bold** text wraps." });
  assert.deepEqual(b[2], { t: "ul", items: ["one", "two"] });
  assert.deepEqual(b[4], { t: "code", lang: "ts", text: "const x = 1;" });
  assert.deepEqual(parseInline("a `b` **c** *d* [e](http://x) ![f](img.png)").map((x) => x.t), ["text", "code", "text", "b", "text", "i", "text", "a", "text", "img"]);
});

// ---------- sdlc: slash merge, hidden moves, plan first, tidy up ----------

import { commandName, fuel, hiddenMoves, mergeSlash, planFirstDefault, SLASH, tidySummary, type MoveInput } from "./logic.ts";
import type { SdlcState } from "@shrike/schema";

test("slash palette lists built-ins, then saved commands, then skills; built-ins are never shadowed", () => {
  const list = mergeSlash(
    [{ id: "bad-value", name: "Bad value", when: "A value is wrong somewhere" }, { id: "fix", name: "Fix", when: "dup" }, { id: "xyne-ci-check", name: "xyne-ci-check", when: "Run the checks CI runs" }],
    [{ name: "Why slow", prompt: "Why is this trip slow? Point at the step." }],
  );
  assert.deepEqual(list.map((e) => `${e.kind}:${e.id}`).slice(SLASH.length), ["command:why-slow", "skill:bad-value", "skill:xyne-ci-check"]);
  assert.equal(list.filter((e) => e.id === "fix").length, 1);
  assert.deepEqual(slashMatches("/x", list)?.map((e) => e.id), ["xyne-ci-check"]);
  assert.equal(list.find((e) => e.id === "why-slow")?.prompt, "Why is this trip slow? Point at the step.");
  const p = parseSlash("/why-slow on checkout", list);
  assert.equal(p?.entry.kind, "command");
  assert.equal(p?.rest, "on checkout");
  assert.equal(parseSlash("/bad-value", list)?.entry.kind, "skill");
  assert.equal(slashMatches("/", [...list, ...list.map((e) => ({ ...e, id: `${e.id}2` }))])?.length, 9);
});

const stages = (s: string): SdlcState["stages"] => {
  const [spot, understand, fix, prove, review, ship, watch] = s.split(" ") as SdlcState["stages"]["spot"][];
  return { spot: spot!, understand: understand!, fix: fix!, prove: prove!, review: review!, ship: ship!, watch: watch! };
};
const sd = (st: string, more: Partial<SdlcState> = {}): SdlcState => ({ actionId: "a", stages: stages(st), detail: {}, ...more });
const moves = (st: string, more: Partial<MoveInput> = {}, max = 9) =>
  hiddenMoves({ sdlc: sd(st), checkpoints: [], flows: [], findings: [], reviewing: false, agentBusy: false, race: null, hasPr: false, ...more }, max).map((m) => m.id);
const cp = { id: "c1", patchId: "p1", label: "Read userId", files: [], createdAt: 1, current: true };

test("hidden moves show up at the right moment, and only then", () => {
  assert.deepEqual(moves("idle idle idle idle idle idle idle", {}, 9), []);
  assert.deepEqual(moves("done active idle idle idle idle idle"), ["find-cause"], "at Understand: one button to find the cause");
  assert.deepEqual(moves("done active idle idle idle idle idle", { agentBusy: true }), []);
  assert.deepEqual(moves("done done done failed idle idle idle", { checkpoints: [cp] }), ["rewind"], "a red re-run after a fix");
  assert.deepEqual(moves("done done done failed idle idle idle"), [], "nothing to rewind to");
  const two = [{ confidence: "likely" as const, claim: "a", file: "x.ts" }, { confidence: "likely" as const, claim: "b", file: "y.ts" }];
  assert.deepEqual(moves("done done active idle idle idle idle", { findings: two }), ["try-both"]);
  assert.deepEqual(moves("done done active idle idle idle idle", { findings: two, agentBusy: true }), []);
  assert.deepEqual(moves("done done active idle idle idle idle", { findings: two.slice(0, 1) }), []);
  assert.deepEqual(moves("done done active idle idle idle idle", { pendingPatchId: "p9" }), []); // the patch card has it
  const flow = { id: "f", name: "Add", steps: [] };
  assert.deepEqual(moves("done done done done active idle idle", { checkpoints: [cp], flows: [flow] }), ["review-fix", "save-skill", "keep-watching"], "Review leads; no test script, no Run the tests");
  assert.deepEqual(moves("done done done done active idle idle", { checkpoints: [cp], sdlc: sd("done done done done active idle idle", { hasTests: true }) }), ["review-fix", "run-tests", "save-skill", "record-flow"]);
  assert.deepEqual(moves("done done done done active idle idle", { checkpoints: [cp], sdlc: sd("done done done done active idle idle", { hasTests: true, tests: "All 3 tests passed." }) }).includes("run-tests"), false, "gone once it ran");
  assert.deepEqual(moves("done done done done active idle idle", { checkpoints: [cp], reviewing: true }).at(-1), "record-flow", "no flows: offer to record one");
  assert.deepEqual(moves("done done done done done active idle", { checkpoints: [cp], flows: [flow] }), ["ship", "save-skill", "keep-watching"]);
  assert.deepEqual(moves("done done done done done active idle", { checkpoints: [cp], hasPr: true }, 1).map(String), ["ship"], "an open PR: see it");
  assert.deepEqual(moves("done done done done done done active", { checkpoints: [cp] }), ["record-flow", "save-skill"], "Watch leads at Watch");
  // a fix that only lives in a race worktree: the race card has the one button
  const green = { id: "r", actionId: "a", candidates: [{ worktree: "try-sender-1", approach: "x", state: "green" as const, patchId: "p" }] };
  assert.deepEqual(moves("done skipped done done active idle idle", { race: green }), []);
  assert.deepEqual(moves("done skipped done done active idle idle", { race: { ...green, adopted: "try-sender-1" } }), ["save-skill", "record-flow"], "brought over: now it's in your code");
  const red = { ...green, kind: "sandbox" as const, candidates: [{ ...green.candidates[0]!, state: "red" as const }] };
  assert.deepEqual(moves("done skipped done failed idle idle idle", { race: red }), ["find-cause"], "a failed sandbox isn't a dead end");
  assert.equal(fuel({ runId: "r", inputTokens: 0, outputTokens: 0, contextTokens: 170_000, contextLimit: 200_000 }) > 0.8, true, "Tidy up shows above 80%");
  assert.equal(fuel(null), 0);
  assert.equal(moves("done done done done active idle idle", { checkpoints: [cp] }, 2).length, 2, "one focal point: at most two");
});

test("K, S and W summon the skills, ship and flows sheets; never while typing or with ⌘", () => {
  const k = (key: string, more: Partial<Parameters<typeof resolveKey>[0]> = {}) => resolveKey({ key, meta: false, ctrl: false, alt: false, typing: false, ...more }, { newTrip: false, approval: false });
  assert.deepEqual(["k", "S", "w"].map((x) => k(x)), ["skills", "ship", "flows"]);
  assert.equal(k("s", { typing: true }), null);
  assert.equal(k("k", { meta: true }), "ask");
});

test("Plan first defaults on for multi-file asks; tidy-up summary and command names", () => {
  assert.equal(planFirstDefault("why does add todo fail?", []), false);
  assert.equal(planFirstDefault("rename userId to ownerId everywhere", []), true);
  assert.equal(planFirstDefault("fix api.ts and db.ts", []), true);
  assert.equal(planFirstDefault("look", [fileChip("src/a.ts"), fileChip("src/b.ts")]), true);
  const steps = [
    { id: "1", runId: "r", kind: "message" as const, text: "Reading the handler.", createdAt: 1 },
    { id: "2", runId: "r", kind: "findings" as const, text: "Found it", summary: "The server reads the wrong field.", findings: [{ confidence: "observed" as const, claim: "req.body.user is undefined", file: "server/todos.controller.ts", line: 18 }], createdAt: 2 },
  ];
  const t = tidySummary("Why does add todo fail?", steps);
  assert.match(t, /^Continue this task in a fresh session: Why does add todo fail\?/);
  assert.match(t, /What you found so far: The server reads the wrong field\.\n- \(observed\) req\.body\.user is undefined server\/todos\.controller\.ts:18/);
  assert.match(t, /- Reading the handler\./);
  assert.equal(commandName("Why is checkout slow?"), "why-is-checkout");
  assert.equal(commandName("   "), "my-command");
});
