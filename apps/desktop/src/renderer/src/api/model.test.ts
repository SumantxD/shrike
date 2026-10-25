import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest } from "@shrike/schema";
import { blankReq, bulkParse, bulkText, cookiesOf, defaultResponseName, findMatches, fromApi, fromCapture, fromRoute, hiddenSecret, isKnown, makeScope, paramsFromUrl, pathOf, pathParams, row, scrubReq, segments, stepMatch, toApi, urlWithParams } from "./model.ts";

test("{{vars}} split into highlightable segments; the scope says which are known", () => {
  assert.deepEqual(segments("{{baseUrl}}/todos/{{ id }}?x=1"), [{ text: "{{baseUrl}}", name: "baseUrl" }, { text: "/todos/" }, { text: "{{ id }}", name: "id" }, { text: "?x=1" }]);
  assert.deepEqual(segments("plain"), [{ text: "plain" }]);
  const scope = makeScope({ env: [row("token", "t"), { ...row("off", "x"), on: false }], vars: [row("token", "mine")], runtime: { uid: "7" } });
  assert.deepEqual(scope, { token: "mine", uid: "7" });
  assert.ok(isKnown("$randomUUID", scope));
  assert.ok(!isKnown("off", scope));
});

test("params and URL stay in sync both ways; switched-off rows survive URL edits", () => {
  const p1 = paramsFromUrl("/todos?page=2&q=milk", []);
  assert.deepEqual(p1.map((r) => [r.name, r.value, r.on]), [["page", "2", true], ["q", "milk", true]]);
  const off = p1.map((r, i) => (i === 1 ? { ...r, on: false } : r));
  assert.equal(urlWithParams("/todos?page=2&q=milk", off), "/todos?page=2");
  const p2 = paramsFromUrl("/todos?page=3", off);
  assert.deepEqual(p2.map((r) => [r.name, r.value, r.on]), [["page", "3", true], ["q", "milk", false]]);
  assert.equal(p2[0]!.id, p1[0]!.id, "ids kept so React keeps focus");
  assert.deepEqual(pathParams("http://localhost:3001/users/:id/posts/:postId?x=:no"), ["id", "postId"]);
});

test("bulk edit round-trips, // switches a row off", () => {
  const rows = bulkParse("page: 2\n// q: milk\n\nflag");
  assert.deepEqual(rows.map((r) => [r.name, r.value, r.on]), [["page", "2", true], ["q", "milk", false], ["flag", "", true]]);
  assert.equal(bulkText(rows), "page: 2\n//q: milk\nflag: ");
  assert.equal(bulkParse("page: 9", rows)[0]!.id, rows[0]!.id);
});

test("main's ApiRequest round-trips through the editor model", () => {
  const a: ApiRequest = {
    path: "users/Create user.bru", name: "Create user", seq: 2, method: "POST", url: "{{baseUrl}}/users/:id?a=1",
    params: [{ name: "a", value: "1", enabled: true }, { name: "b", value: "2", enabled: false }],
    pathParams: [{ name: "id", value: "9", enabled: true }],
    headers: [{ name: "x-one", value: "1", enabled: false }],
    body: { type: "multipart", fields: [{ name: "n", value: "1", enabled: true }, { name: "f", value: "/tmp/a.txt", enabled: true, file: true }] },
    auth: { type: "apikey", key: "k", value: "v", placement: "query" },
    vars: { pre: [{ name: "x", value: "1", enabled: true }], post: [{ name: "token", value: "res.body.token", enabled: true }] },
    assertions: [{ expr: "res.status", op: "eq", value: "201", enabled: true }],
    scripts: { post: "bru.setVar('a', 1)" }, settings: { timeoutMs: 5000 }, docs: "Makes a user",
  };
  const r = fromApi(a);
  assert.deepEqual(r.params.map((p) => [p.name, p.on]), [["a", true], ["b", false]]);
  assert.equal(r.body.form[1]!.file, "/tmp/a.txt");
  assert.equal(r.post[0]!.selector, "res.body.token");
  assert.deepEqual(toApi(r), a);
  for (const body of [{ type: "none" }, { type: "json", data: "{}" }, { type: "form-urlencoded", fields: [{ name: "a", value: "b", enabled: true }] }, { type: "graphql", query: "{ me }", variables: "{}" }] as ApiRequest["body"][])
    assert.deepEqual(toApi(fromApi({ ...a, body })).body, body);
});

test("requests from what the app did: a captured call and a scanner route", () => {
  const c = fromCapture({ method: "post", url: "/api/todos?x=1", reqHeaders: { host: "h", traceparent: "t", "content-type": "application/json", authorization: "Bearer [redacted:token]" }, reqBody: '{"title":"a"}' });
  assert.deepEqual(c.headers.map((h) => h.name), ["content-type"]);
  assert.deepEqual(c.auth, { type: "bearer", token: "[redacted:token]" });
  assert.equal(c.body.mode, "json");
  const seen = [{ method: "PATCH", url: "http://localhost:3001/api/todos/42", reqBody: '{"done":true}' }];
  const r = fromRoute({ method: "patch", path: "/api/todos/:id" }, seen);
  assert.equal(r.url, "/api/todos/:id");
  assert.deepEqual(r.pathVals, { id: "42" });
  assert.equal(JSON.parse(r.body.text).done, true);
  assert.deepEqual(fromRoute({ method: "GET", path: "/api/todos/:id" }, seen).pathVals, { id: "" });
});

test("response helpers: copy paths and cookies", () => {
  assert.equal(pathOf(["items", 0, "id"]), "res.body.items[0].id");
  assert.equal(pathOf(["a-b"]), 'res.body["a-b"]');
  assert.deepEqual(cookiesOf({ "set-cookie": "sid=1; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT, theme=dark" }).map((c) => [c.name, c.value]), [["sid", "1"], ["theme", "dark"]]);
});

test("tabs kept between restarts hide secret values but keep {{vars}}; a hidden one can't be saved", () => {
  const r = blankReq({ headers: [row("Authorization", "Bearer abc"), row("X-Api-Key", "{{key}}"), row("Accept", "*/*")], auth: { type: "bearer", token: "abc" }, vars: [{ ...row("pw", "hunter2"), secret: true }] });
  const s = scrubReq(r);
  assert.deepEqual(s.headers.map((h) => h.value), ["[redacted:authorization]", "{{key}}", "*/*"]);
  assert.equal(s.auth.token, "[redacted:token]");
  assert.equal(s.vars[0]!.value, "[redacted:pw]");
  assert.ok(!JSON.stringify(s).includes("abc") && !JSON.stringify(s).includes("hunter2"));
  assert.ok(hiddenSecret(s) && !hiddenSecret(r));
});

test("find matches in text: case-insensitive, non-overlapping, wrap-around navigation", () => {
  const text = "Buy milk, buy Milk, BUY MILK!";
  assert.deepEqual(findMatches(text, "buy milk"), [0, 10, 20]);
  assert.deepEqual(findMatches(text, "MILK"), [4, 14, 24]);
  assert.deepEqual(findMatches(text, "coffee"), []);
  assert.deepEqual(findMatches("", "milk"), []);
  assert.deepEqual(findMatches(text, ""), []);
  assert.deepEqual(findMatches("aaaa", "aa"), [0, 2]);

  assert.equal(stepMatch(0, 3, "next"), 1);
  assert.equal(stepMatch(2, 3, "next"), 0);
  assert.equal(stepMatch(0, 3, "prev"), 2);
  assert.equal(stepMatch(2, 3, "prev"), 1);
  assert.equal(stepMatch(0, 0, "next"), 0);
});

test("saved response names: URL last part plus an extension from the content type", () => {
  assert.equal(defaultResponseName("http://127.0.0.1:3000/todos", "application/json; charset=utf-8"), "todos.json");
  assert.equal(defaultResponseName("http://127.0.0.1:3000/logo.png", "image/png"), "logo.png");
  assert.equal(defaultResponseName("http://127.0.0.1:3000/bin", "application/octet-stream"), "bin");
  assert.equal(defaultResponseName("http://127.0.0.1:3000/", undefined), "response.txt");
  assert.equal(defaultResponseName("http://127.0.0.1:3000/", "application/json"), "response.json");
  assert.equal(defaultResponseName("http://127.0.0.1:3000/todos?page=2", "text/plain"), "todos.txt");
});
