// #66: a HAR file becomes trips, through the store, with secrets and foreign pii redacted.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DebugEvent, TimelineNode } from "@shrike/schema";
import { harMessages, IMPORTED_LABEL, MAX_HAR_BYTES, parseHar } from "./har.ts";
import { Store } from "./store.ts";

// A HAR saved from Chrome DevTools on fixtures/todo-app, plus a foreign API call carrying real secrets.
const entry = (over: Record<string, unknown> = {}) => ({
  startedDateTime: "2026-10-26T10:00:00.000Z",
  time: 12,
  request: { method: "GET", url: "http://localhost:5173/", headers: [] },
  response: { status: 200, headers: [], content: { mimeType: "text/html", text: "<html/>" } },
  ...over,
});
const har = (entries: unknown[]) => JSON.stringify({ log: { version: "1.2", creator: { name: "Chrome", version: "1" }, entries } });

const TODO_HAR = har([
  entry(),
  entry({ startedDateTime: "2026-10-26T10:00:00.100Z", time: 4, request: { method: "GET", url: "http://localhost:5173/src/main.tsx", headers: [] }, response: { status: 200, headers: [], content: { text: "js" } } }),
  entry({
    startedDateTime: "2026-10-26T10:00:00.200Z",
    time: 48,
    request: {
      method: "POST",
      url: "http://localhost:3001/api/todos",
      headers: [{ name: "Content-Type", value: "application/json" }],
      postData: { mimeType: "application/json", text: JSON.stringify({ title: "Buy milk", userId: 1 }) },
    },
    response: { status: 500, headers: [], content: { text: JSON.stringify({ error: "NOT NULL constraint failed: todos.user_id" }) } },
  }),
  entry({
    startedDateTime: "2026-10-26T10:00:00.300Z",
    time: 20,
    request: { method: "GET", url: "http://localhost:3001/api/todos", headers: [] },
    response: { status: 200, headers: [], content: { text: JSON.stringify([{ id: 1, title: "Buy milk" }]) } },
  }),
  // A Supabase call: the database lane, not the network lane.
  entry({
    startedDateTime: "2026-10-26T10:00:00.400Z",
    time: 60,
    request: {
      method: "GET",
      url: "https://abcdefghijklmnopqrst.supabase.co/rest/v1/notes?select=*",
      headers: [
        { name: "apikey", value: "sb-secret-key" },
        { name: "Authorization", value: "Bearer sb-jwt-token" },
      ],
    },
    response: { status: 200, headers: [{ name: "Content-Range", value: "0-1/2" }], content: { text: JSON.stringify([{ id: 1 }]) } },
  }),
  // Foreign data: real secrets and a real email in the body.
  entry({
    startedDateTime: "2026-10-26T10:00:00.500Z",
    time: 30,
    request: {
      method: "POST",
      url: "https://api.example.com/v1/notes",
      headers: [
        { name: "Cookie", value: "session=abc123" },
        { name: "Authorization", value: "Bearer live-token-xyz" },
      ],
      postData: { mimeType: "application/json", text: JSON.stringify({ owner: "ann@shop.com", note: "hi" }) },
    },
    response: { status: 201, headers: [{ name: "Set-Cookie", value: "session=def456; Path=/" }], content: { text: "{}" } },
  }),
  // The next burst, five seconds later: a second trip.
  entry({ startedDateTime: "2026-10-26T10:00:05.000Z", time: 15, request: { method: "GET", url: "http://localhost:3001/api/todos", headers: [] }, response: { status: 200, headers: [], content: { text: "[]" } } }),
]);

const flat = (nodes: TimelineNode[]): DebugEvent[] => nodes.flatMap((n) => [n.event, ...flat(n.children)]);

test("groups by 1s gaps under an 'Imported, no clicks' root, with right methods, statuses and timings", () => {
  const out = parseHar(TODO_HAR);
  assert.equal(out.trips.length, 2);
  assert.equal(out.entries, 7);
  const [first, second] = out.trips;
  assert.equal(first![0]!.name, IMPORTED_LABEL);
  assert.equal(first![0]!.kind, "user_action");
  assert.equal(first!.length, 7); // root + 6 entries
  assert.equal(second!.length, 2); // root + 1 entry
  const names = first!.slice(1).map((e) => e.name);
  assert.deepEqual(names, ["GET /", "GET /src/main.tsx", "POST /api/todos", "GET /api/todos", "SELECT * FROM notes", "POST https://api.example.com/v1/notes"]);
  assert.equal(first!.find((e) => e.name === "POST /api/todos")!.status, "error");
  assert.equal(first!.find((e) => e.name === "POST /api/todos")!.http!.status, 500);
  assert.equal(first!.find((e) => e.name === "POST /api/todos")!.durationMs, 48);
  assert.equal(first![0]!.status, "error"); // the trip inherits the 500
});

test("keeps request and response bodies, and decodes base64 content (Firefox/Safari shape)", () => {
  const out = parseHar(
    har([
      entry({
        request: { method: "POST", url: "http://localhost:3001/api/todos", headers: [], postData: { text: '{"title":"x"}' } },
        response: { status: 200, headers: [], content: { encoding: "base64", text: Buffer.from('{"ok":true}').toString("base64") } },
      }),
    ]),
  );
  const ev = out.trips[0]![1]!;
  assert.equal(ev.http!.reqBody, '{"title":"x"}');
  assert.equal(ev.http!.resBody, '{"ok":true}');
});

test("drops dev-server calls and Firestore back channels, counts unusable entries as skipped", () => {
  const out = parseHar(
    har([
      entry({ request: { method: "GET", url: "http://localhost:5173/__vite_ping", headers: [] } }),
      entry({ request: { method: "GET", url: "https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?TYPE=init", headers: [] } }),
      entry({ request: { method: "GET", url: "not a url", headers: [] } }),
      entry({ startedDateTime: "garbage", request: { method: "GET", url: "http://localhost:3001/api/todos", headers: [] } }),
      entry({ request: { method: "GET", url: "http://localhost:3001/api/todos", headers: [] }, _webSocketMessages: [{ type: "send", data: "hi" }] }),
    ]),
  );
  assert.equal(out.trips.length, 1);
  assert.equal(out.trips[0]!.length, 2); // root + the one real entry
  assert.equal(out.skipped, 2);
  assert.equal(out.webSockets, 1);
});

test("invalid, empty and huge files throw a plain message and never crash", () => {
  for (const [text, msg] of [
    ["", "That file is empty."],
    ["not json", "That doesn't look like a HAR file."],
    [JSON.stringify({ log: { entries: "nope" } }), "That doesn't look like a HAR file."],
    [JSON.stringify({ nope: true }), "That doesn't look like a HAR file."],
  ] as const) {
    assert.throws(() => parseHar(text), { message: msg });
  }
  assert.throws(() => parseHar("x".repeat(MAX_HAR_BYTES + 1)), { message: "That HAR file is over 50 MB, so I can't import it." });
});

test("through the store: secrets redacted, foreign emails masked, localhost values left alone, Supabase on the database lane", () => {
  const store = new Store({ projectRoot: () => "/proj", onUpdate: () => {} });
  for (const m of harMessages(TODO_HAR)) store.handle(m);
  const actions = store.listActions();
  assert.equal(actions.length, 2);
  assert.equal(actions[0]!.label, IMPORTED_LABEL);
  const events = flat(actions[0]!.tree);

  const foreign = events.find((e) => e.name === "POST https://api.example.com/v1/notes")!;
  assert.equal(foreign.http!.reqHeaders!["cookie"], "[redacted:cookie]");
  assert.equal(foreign.http!.reqHeaders!["authorization"], "[redacted:authorization]");
  assert.equal(foreign.http!.resHeaders!["set-cookie"], "[redacted:set-cookie]");
  assert.match(foreign.http!.reqBody!, /\[email#1\]/);
  assert.doesNotMatch(foreign.http!.reqBody!, /ann@shop\.com/);

  const supabase = events.find((e) => e.kind === "db_query")!;
  assert.equal(supabase.place!.id, "data:supabase:abcdefghijklmnopqrst.supabase.co");
  assert.equal(supabase.db!.statement, "SELECT * FROM notes");
  assert.equal(supabase.http!.reqHeaders!["apikey"], "[redacted:apikey]");

  // The same trip's localhost entries are local dev traffic: no pii masking.
  const local = events.find((e) => e.name === "POST /api/todos")!;
  assert.equal(local.http!.reqBody, JSON.stringify({ title: "Buy milk", userId: 1 }));
});

test("a Supabase call recognised by its apikey header, not just its hostname, also lands on the database lane", () => {
  const out = parseHar(
    har([
      entry({
        request: {
          method: "GET",
          url: "https://db.example.com/rest/v1/notes?select=*",
          headers: [{ name: "apikey", value: "k" }],
        },
        response: { status: 200, headers: [], content: { text: "[]" } },
      }),
    ]),
  );
  const ev = out.trips[0]![1]!;
  assert.equal(ev.kind, "db_query");
  assert.equal(ev.place!.id, "data:supabase:db.example.com");
});

test("a burst past the per-trip cap becomes several whole trips in the store, nothing dropped", () => {
  const many = Array.from({ length: 12_000 }, (_, i) => entry({ startedDateTime: new Date(Date.UTC(2026, 9, 26, 10) + (i % 500)).toISOString(), request: { method: "GET", url: `http://localhost:3001/api/todos/${i}`, headers: [] } }));
  const store = new Store({ projectRoot: () => "/proj", onUpdate: () => {} });
  for (const m of harMessages(har(many))) store.handle(m);
  const actions = store.listActions();
  assert.equal(actions.length, 3);
  assert.ok(actions.every((a) => a.label === IMPORTED_LABEL));
  assert.equal(actions.reduce((n, a) => n + flat(a.tree).length, 0), 12_000);
});
