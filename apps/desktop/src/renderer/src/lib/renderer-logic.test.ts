import { test } from "node:test";
import assert from "node:assert/strict";
import { lineDiff } from "./hud.ts";
import { parseAnsi } from "./ansi.ts";
import { focusIndex, type PlayStep } from "./steps.ts";
import { clockTime, relativeTime, statusWords } from "./format.ts";
import { keys } from "./platform.ts";

test("line diff of the killer fix", () => {
  const before = "a\nb\n  insertTodo({ title, userId: req.body.user });\nd\ne";
  const after = "a\nb\n  insertTodo({ title, userId: req.body.userId });\nd\ne";
  assert.deepEqual(lineDiff(before, after), [
    { kind: "ctx", text: "b", line: 2 },
    { kind: "del", text: "  insertTodo({ title, userId: req.body.user });", line: 3 },
    { kind: "add", text: "  insertTodo({ title, userId: req.body.userId });", line: 3 },
    { kind: "ctx", text: "d", line: 4 },
  ]);
  assert.deepEqual(lineDiff("x", "x"), []);
  assert.deepEqual(lineDiff("a\nb", "a\nb\nc").map((l) => l.kind), ["ctx", "add"]);
});

test("ansi and status words", () => {
  assert.deepEqual(parseAnsi("a\u001b[31mred\u001b[0m b\r\nx\rY"), [{ text: "a" }, { text: "red", color: "var(--fail)" }, { text: " b\nY" }]);
  assert.equal(statusWords(500), "Server error (500)");
  assert.equal(statusWords(404), "Not found (404)");
});

test("lands on the deepest failing function under the first failure", () => {
  const st = (kind: PlayStep["event"]["kind"], depth: number, status: PlayStep["status"]): PlayStep =>
    ({ id: "", index: 0, event: { kind, status }, depth, realm: "server", caption: "", status, startMs: 0, durationMs: 0 }) as unknown as PlayStep;
  // click, fetch, server got it, createTodo ✕, log, insertTodo ✕, db ✕, handleError, log
  const steps = [st("user_action", 0, "error"), st("http_request", 1, "error"), st("http_request", 2, "error"), st("function", 3, "error"), st("log", 4, "ok"), st("function", 4, "error"), st("db_query", 5, "error"), st("function", 3, "ok"), st("log", 4, "ok")];
  assert.equal(focusIndex(steps), 5);
  assert.equal(focusIndex([st("user_action", 0, "ok"), st("function", 1, "ok")]), 1);
  assert.equal(focusIndex([st("user_action", 0, "error"), st("db_query", 1, "error")]), 1);
});

test("shortcut labels read Ctrl and Alt off macOS", () => {
  assert.equal(keys("⌘⇧G", true), "⌘⇧G");
  assert.equal(keys("Close the dock (⌘⇧G)", false), "Close the dock (Ctrl+Shift+G)");
  assert.equal(keys("⌘↵ approve", false), "Ctrl+Enter approve");
  assert.equal(keys("⌃⌥ Space", false), "Ctrl+Alt+Space");
  assert.equal(keys("⌥ `", false), "Alt+`");
  assert.equal(keys("⌘", false), "Ctrl");
});

test("relativeTime reads out like a person would", () => {
  const now = Date.parse("2026-10-22T09:00:00Z");
  assert.equal(relativeTime(now - 2_000, now), "just now");
  assert.equal(relativeTime(now - 12_000, now), "12s ago");
  assert.equal(relativeTime(now - 4 * 60_000, now), "4m ago");
  // past an hour it falls back to the clock time (used as the <time> tooltip)
  const old = now - 2 * 3_600_000;
  assert.equal(relativeTime(old, now), clockTime(old));
});
